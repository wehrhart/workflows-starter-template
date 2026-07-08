import { DurableObject } from "cloudflare:workers";
import type { UploadRow, MissingRow, ProcessResult } from "./lib/types";

export interface LedgerSnapshot {
	uploadRows: UploadRow[];
	missingRows: MissingRow[];
	files: ProcessResult["files"];
	updatedAt: number;
}

interface AppendBatch {
	uploadRows: UploadRow[];
	missingRows: MissingRow[];
	files: ProcessResult["files"];
}

/**
 * LedgerDO — the running "master sheet". Bill sheets processed over time append
 * their rows here; the master .xlsm is rebuilt from this on download. A single
 * instance (idFromName("default")) holds the current, not-yet-uploaded batch.
 * A Durable Object serializes the appends so concurrent uploads can't clobber
 * each other.
 */
export class LedgerDO extends DurableObject {
	/** Append a processed batch's rows; returns the new full snapshot. */
	async append(batch: AppendBatch): Promise<LedgerSnapshot> {
		const s = await this.snapshot();
		s.uploadRows.push(...batch.uploadRows);
		s.missingRows.push(...batch.missingRows);
		s.files.push(...batch.files);
		s.updatedAt = Date.now();
		await this.ctx.storage.put("uploadRows", s.uploadRows);
		await this.ctx.storage.put("missingRows", s.missingRows);
		await this.ctx.storage.put("files", s.files);
		await this.ctx.storage.put("updatedAt", s.updatedAt);
		return s;
	}

	async snapshot(): Promise<LedgerSnapshot> {
		return {
			uploadRows: (await this.ctx.storage.get<UploadRow[]>("uploadRows")) ?? [],
			missingRows:
				(await this.ctx.storage.get<MissingRow[]>("missingRows")) ?? [],
			files:
				(await this.ctx.storage.get<ProcessResult["files"]>("files")) ?? [],
			updatedAt: (await this.ctx.storage.get<number>("updatedAt")) ?? 0,
		};
	}

	/** Wipe the master sheet — call after uploading to Kaiser. */
	async clear(): Promise<void> {
		await this.ctx.storage.deleteAll();
	}
}
