import type { ComponentType } from "react";
import { DemoUnits } from "./DemoUnits";
import { KairukuSession } from "./KairukuSession";
import { KaiserBilling } from "./KaiserBilling";
import { PriceInformation } from "./PriceInformation";
import { PriceQuote } from "./PriceQuote";

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
		id: "price-quote",
		name: "Price Quote Generator",
		tagline: "Hospital + prices → a PDF quote in the ABYRX template",
		icon: "📄",
		status: "active",
		component: PriceQuote,
	},
	{
		id: "price-information",
		name: "Price Information",
		tagline: "Facility code → approved products & prices, across the health system",
		icon: "💲",
		status: "active",
		component: PriceInformation,
	},
	{
		id: "kairuku-session",
		name: "Kairuku Session",
		tagline: "Log in to Kairuku once — future tools reuse the session",
		icon: "🔐",
		status: "active",
		component: KairukuSession,
	},
	{
		id: "demo-units",
		name: "Demo Units",
		tagline: "Shipping sheet photo → demo unit entries in Kairuku",
		icon: "📦",
		status: "active",
		component: DemoUnits,
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
