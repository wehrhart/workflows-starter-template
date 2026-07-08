import type { ComponentType } from "react";
import { KaiserBilling } from "./KaiserBilling";

export interface ToolDef {
	id: string;
	name: string;
	/** One-line description shown on the card and under the sidebar entry. */
	tagline: string;
	/** Emoji icon (kept simple; swap for an SVG later if you like). */
	icon: string;
	status: "active" | "soon";
	component?: ComponentType;
}

/**
 * The tool catalog for the workspace. Add a new entry (with a component) to
 * surface another internal tool — the dashboard and sidebar pick it up
 * automatically.
 */
export const TOOLS: ToolDef[] = [
	{
		id: "kaiser-billing",
		name: "Kaiser Billing",
		tagline: "Bill sheet PDFs → ready-to-upload Bill-Only spreadsheet",
		icon: "🧾",
		status: "active",
		component: KaiserBilling,
	},
	{
		id: "coming-soon",
		name: "Next tool",
		tagline: "Another workflow can live here",
		icon: "➕",
		status: "soon",
	},
];

export function getTool(id: string | null): ToolDef | undefined {
	return TOOLS.find((t) => t.id === id);
}
