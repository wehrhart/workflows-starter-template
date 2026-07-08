import { DurableObject } from "cloudflare:workers";
import type { ProcessResult } from "./lib/types";

/** Ordered pipeline steps for one bill-sheet batch. Kept in sync with the UI. */
export const PIPELINE_STEPS = [
	"read bill sheets",
	"resolve & map",
	"add to master sheet",
] as const;

interface BatchResult {
	/** Rows added by this batch. */
	addedRows: number;
	addedMissing: number;
	/** Running totals in the master sheet after this batch. */
	totalRows: number;
	totalMissing: number;
	files: ProcessResult["files"];
}

/**
 * WorkflowStatusDO - tracks per-batch step status, the final result summary, and
 * broadcasts both to connected WebSocket clients (hibernation API).
 */
export class WorkflowStatusDO extends DurableObject {
	private stepStatuses: Map<string, string>;
	private currentStep: string | null;
	private workflowStatus: "running" | "completed" | "error";
	private errorMessage: string | null;
	private result: BatchResult | null;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);

		this.stepStatuses = new Map();
		this.currentStep = null;
		this.workflowStatus = "running";
		this.errorMessage = null;
		this.result = null;

		ctx.blockConcurrencyWhile(async () => {
			const stored =
				await ctx.storage.get<Record<string, string>>("stepStatuses");
			if (stored) {
				this.stepStatuses = new Map(Object.entries(stored));
			} else {
				PIPELINE_STEPS.forEach((s) => this.stepStatuses.set(s, "pending"));
			}
			this.currentStep = (await ctx.storage.get<string | null>("currentStep")) ?? null;
			this.workflowStatus =
				(await ctx.storage.get<"running" | "completed" | "error">(
					"workflowStatus",
				)) ?? "running";
			this.errorMessage = (await ctx.storage.get<string | null>("errorMessage")) ?? null;
			this.result = (await ctx.storage.get<BatchResult | null>("result")) ?? null;
		});
	}

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("Upgrade") === "websocket") {
			const pair = new WebSocketPair();
			const [client, server] = Object.values(pair);
			this.ctx.acceptWebSocket(server);
			server.send(JSON.stringify(this.getStateMessage()));
			return new Response(null, { status: 101, webSocket: client });
		}
		return new Response("Expected WebSocket", { status: 400 });
	}

	/** RPC: update a single step's status. */
	async updateStep(stepName: string, status: string): Promise<void> {
		this.stepStatuses.set(stepName, status);
		if (status === "running" || status === "waiting") {
			this.currentStep = stepName;
		}
		if (this.workflowStatus !== "error") {
			const allCompleted = Array.from(this.stepStatuses.values()).every(
				(s) => s === "completed",
			);
			if (allCompleted) {
				this.workflowStatus = "completed";
				this.currentStep = null;
			}
		}
		await this.persist();
		this.broadcast(this.getStateMessage());
	}

	/** RPC: store the final result summary for the batch. */
	async setResult(result: BatchResult): Promise<void> {
		this.result = result;
		await this.ctx.storage.put("result", result);
		this.broadcast(this.getStateMessage());
	}

	/** RPC: mark the batch as errored. */
	async setError(message: string): Promise<void> {
		this.workflowStatus = "error";
		this.errorMessage = message;
		this.currentStep = null;
		await this.persist();
		this.broadcast(this.getStateMessage());
	}

	async webSocketMessage(ws: WebSocket, _message: string): Promise<void> {
		ws.send(JSON.stringify(this.getStateMessage()));
	}

	async webSocketClose(
		ws: WebSocket,
		code: number,
		reason: string,
		_wasClean: boolean,
	): Promise<void> {
		ws.close(code, reason);
	}

	private async persist(): Promise<void> {
		await this.ctx.storage.put(
			"stepStatuses",
			Object.fromEntries(this.stepStatuses),
		);
		await this.ctx.storage.put("currentStep", this.currentStep);
		await this.ctx.storage.put("workflowStatus", this.workflowStatus);
		await this.ctx.storage.put("errorMessage", this.errorMessage);
	}

	private broadcast(message: object): void {
		const json = JSON.stringify(message);
		for (const socket of this.ctx.getWebSockets()) {
			try {
				socket.send(json);
			} catch {
				// ignore disconnected sockets
			}
		}
	}

	private getStateMessage(): object {
		return {
			type: "workflow_update",
			currentStep: this.currentStep,
			stepStatuses: Object.fromEntries(this.stepStatuses),
			workflowStatus: this.workflowStatus,
			errorMessage: this.errorMessage,
			result: this.result,
			timestamp: Date.now(),
		};
	}
}
