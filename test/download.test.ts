import { env, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { UploadRow } from "../worker/lib/types";

describe("ledger HTTP endpoints", () => {
	it("GET /api/ledger returns JSON and /download returns a real .xlsm", async () => {
		const stub = env.LEDGER.get(env.LEDGER.idFromName("default"));
		await stub.clear();
		const row: UploadRow = {
			A: "10702",
			B: "12345678",
			C: "07/06/2026",
			D: "James Jackman",
			I: "OS-MON-1001",
			J: "MONTAGE 5cc",
			K: 2,
			L: "EA",
			M: 2896,
		};
		await stub.append({
			uploadRows: [row],
			missingRows: [],
			files: [
				{
					sourceFile: "a.pdf",
					caseId: "12345678",
					locationId: "10702",
					locationName: "NW Sunnyside Med Center OR",
					lineItems: 1,
					routed: "upload",
				},
			],
		});

		// GET /api/ledger -> JSON summary (not the SPA's HTML)
		const summary = await SELF.fetch("https://app/api/ledger");
		expect(summary.headers.get("content-type") ?? "").toContain("application/json");
		const body = (await summary.json()) as { totalRows: number };
		expect(body.totalRows).toBe(1);

		// GET /api/ledger/download -> a macro-enabled workbook (zip; starts with "PK")
		const dl = await SELF.fetch("https://app/api/ledger/download");
		expect(dl.status).toBe(200);
		expect(dl.headers.get("content-type") ?? "").toContain("macroEnabled");
		expect(dl.headers.get("content-disposition") ?? "").toContain(".xlsm");
		const bytes = new Uint8Array(await dl.arrayBuffer());
		expect(bytes[0]).toBe(0x50); // 'P'
		expect(bytes[1]).toBe(0x4b); // 'K'  -> valid Office Open XML zip

		await stub.clear();
	});
});
