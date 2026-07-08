/**
 * Shared front-end types for the Abyrx Bill Sheets tool.
 */

export type StepStatus =
	| "pending"
	| "running"
	| "waiting"
	| "completed"
	| "error";
export type WorkflowStatus = "idle" | "running" | "completed" | "error";

export interface StepDefinition {
	name: string;
	description: string;
}

/** Per-file outcome reported by the worker. */
export interface FileSummary {
	sourceFile: string;
	caseId: string | null;
	locationId: string | null;
	locationName: string | null;
	lineItems: number;
	routed: "upload" | "missing-case-id";
	note?: string;
}

/** Final batch result summary. */
export interface BatchResult {
	downloadReady: boolean;
	fileName: string;
	uploadRows: number;
	missingRows: number;
	files: FileSummary[];
}

export interface WorkflowState {
	instanceId: string | null;
	currentStep: string | null;
	stepStatuses: Record<string, StepStatus>;
	workflowStatus: WorkflowStatus;
	errorMessage: string | null;
	result: BatchResult | null;
	wsConnected: boolean;
}

export interface WorkflowUpdateMessage {
	type: "workflow_update";
	currentStep: string | null;
	stepStatuses: Record<string, StepStatus>;
	workflowStatus: "running" | "completed" | "error";
	errorMessage: string | null;
	result: BatchResult | null;
	timestamp: number;
}

/** The pipeline steps, in order. Mirrors PIPELINE_STEPS in the worker. */
export const PIPELINE_STEPS: StepDefinition[] = [
	{
		name: "read bill sheets",
		description: "Workers AI reads each PDF into structured fields",
	},
	{
		name: "resolve & map",
		description:
			"Match Surgery Location, combine products, split missing Case IDs",
	},
	{
		name: "build spreadsheet",
		description: "Fill the Bill-Only .xlsm upload template",
	},
];
