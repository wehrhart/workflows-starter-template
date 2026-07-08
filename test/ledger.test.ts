import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { UploadRow, MissingRow } from "../worker/lib/types";
import type { ProcessResult } from "../worker/lib/types";

function batch(caseId: string) {
	const uploadRows: UploadRow[] = [
		{ A: "10702", B: caseId, I: "OS-MON-1001", J: "MONTAGE 5cc", K: 2, L: "EA", M: 2896 },
	];
	const missingRows: MissingRow[] = [];
	const files: ProcessResult["files"] = [
		{
			sourceFile: `${caseId}.pdf`,
			caseId,
			locationId: "10702",
			locationName: "NW Sunnyside Med Center OR",
			lineItems: 1,
			routed: "upload",
		},
	];
	return { uploadRows, missingRows, files };
}

describe("LedgerDO (running master sheet)", () => {
	it("accumulates rows across batches and clears", async () => {
		const stub = env.LEDGER.get(env.LEDGER.idFromName(`t-${Date.now()}`));

		let snap = await stub.snapshot();
		expect(snap.uploadRows.length).toBe(0);

		const s1 = await stub.append(batch("11111111"));
		expect(s1.uploadRows.length).toBe(1);

		const s2 = await stub.append(batch("22222222"));
		expect(s2.uploadRows.length).toBe(2); // accumulated, not replaced
		expect(s2.files.length).toBe(2);

		snap = await stub.snapshot();
		expect(snap.uploadRows.length).toBe(2);
		expect(snap.uploadRows[0].B).toBe("11111111");
		expect(snap.uploadRows[1].B).toBe("22222222");

		await stub.clear();
		snap = await stub.snapshot();
		expect(snap.uploadRows.length).toBe(0);
		expect(snap.files.length).toBe(0);
	});
});
