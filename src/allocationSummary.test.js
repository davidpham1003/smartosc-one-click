import assert from "node:assert/strict";
import test from "node:test";
import { summarizeAllocations } from "./allocation.js";

test("same daily allocation is shown once with its dates", () => {
  const summary = summarizeAllocations([
    {
      date: "2026-10-01",
      allocated: {
        detail: [
          { code: "CBA_2603_DS", name: "Cebu Pacific", hours: 6 },
          { code: "CBA_2501_DS", name: "Cebu Backend", hours: 2 },
        ],
      },
    },
    {
      date: "2026-10-05",
      allocated: {
        detail: [
          { code: "CBA_2501_DS", name: "Cebu Backend", hours: 2 },
          { code: "CBA_2603_DS", name: "Cebu Pacific", hours: 6 },
        ],
      },
    },
    {
      date: "2026-10-02",
      allocated: {
        detail: [{ code: "CBA_2603_DS", name: "Cebu Pacific", hours: 4 }],
      },
    },
  ]);
  assert.equal(summary.groups.length, 2);
  assert.deepEqual(summary.groups[0].dates, ["2026-10-01", "2026-10-05"]);
  assert.equal(summary.groups[0].projects[0].code, "CBA_2603_DS");
  assert.equal(summary.groups[0].projects[0].hours, 6);
  assert.equal(summary.groups[0].projects[1].hours, 2);
  assert.deepEqual(summary.groups[1].dates, ["2026-10-02"]);
  assert.equal(summary.groups[1].projects[0].hours, 4);
});

test("empty days have no allocations", () => {
  assert.deepEqual(summarizeAllocations([]), { groups: [] });
  assert.deepEqual(summarizeAllocations([{ date: "2026-10-01", allocated: { detail: [] } }]), { groups: [] });
});
