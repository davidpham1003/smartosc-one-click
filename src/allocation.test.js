import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compareWorkLogs, hasWorkLogs, mismatchMessage } from "./allocation.js";

const overview = JSON.parse(readFileSync(new URL("../timesheet-overview.json", import.meta.url), "utf8"));

function day(iso) {
  return overview.find((item) => item.date === iso);
}

test("2026-10-05 worklogs match allocation", () => {
  const sample = day("2026-10-05");
  assert.equal(hasWorkLogs(sample), true);
  const compared = compareWorkLogs(sample);
  assert.equal(compared.match, true);
  assert.deepEqual(compared.mismatches, []);
});

test("null workLogs still needs the next API step", () => {
  for (const iso of ["2026-10-04", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"]) {
    assert.equal(hasWorkLogs(day(iso)), false);
  }
});

test("hour mismatch names the project, allocated hours, and logged hours", () => {
  const sample = structuredClone(day("2026-10-05"));
  sample.workLogs.detail["1774"].hours = 4;
  const compared = compareWorkLogs(sample);
  assert.equal(compared.match, false);
  assert.equal(compared.mismatches.length, 1);
  assert.equal(compared.mismatches[0].code, "CBA_2603_DS");
  assert.equal(compared.mismatches[0].allocated, 6);
  assert.equal(compared.mismatches[0].logged, 4);
  assert.equal(
    mismatchMessage(compared.mismatches[0]),
    "Số giờ chưa khớp: Cebu Pacific - Soc 9 - Ibs Ktlo Squad (CBA_2603_DS) được allocate 6 giờ, đã log work 4 giờ.",
  );
});

test("a project with allocation and no worklog is logged as 0", () => {
  const sample = structuredClone(day("2026-10-05"));
  delete sample.workLogs.detail["1535"];
  const compared = compareWorkLogs(sample);
  const missing = compared.mismatches.find((item) => item.code === "CBA_2501_DS");
  assert.ok(missing);
  assert.equal(missing.allocated, 2);
  assert.equal(missing.logged, 0);
  assert.match(mismatchMessage(missing), /Cebu: Backend - Mobile Application Managed Service \(CBA_2501_DS\) được allocate 2 giờ, đã log work 0 giờ/);
});
