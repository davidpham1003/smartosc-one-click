import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  applyRequestStatus,
  earliestFullCheckout,
  indexRequestStatus,
  monthOffset,
  readReportHeading,
  requestStatusKey,
  summarizeAttendance,
} from "./attendanceSummary.js";

const view = JSON.parse(readFileSync(new URL("../json-res/attendanceView.json", import.meta.url), "utf8"));
const filo = JSON.parse(readFileSync(new URL("../json-res/attendanceViewCustom.json", import.meta.url), "utf8"));
const sep = JSON.parse(readFileSync(new URL("../json-res/attendanceViewSep.json", import.meta.url), "utf8"));
const report = JSON.parse(readFileSync(new URL("../json-res/attendanceReportAction.json", import.meta.url), "utf8"));
const requests = JSON.parse(
  readFileSync(new URL("../json-res/attendanceViewRequestStatus.json", import.meta.url), "utf8"),
);

function dates(rows) {
  return rows.map((row) => row.date);
}

test("October 2026 sample splits the month by net hours", () => {
  const summary = summarizeAttendance(view);
  assert.deepEqual(dates(summary.full), ["2026-10-02", "2026-10-13"]);
  assert.deepEqual(dates(summary.mid), ["2026-10-01", "2026-10-06", "2026-10-07"]);
  assert.deepEqual(dates(summary.short), []);
  assert.deepEqual(dates(summary.absent), ["2026-10-05", "2026-10-08", "2026-10-09", "2026-10-12"]);
  assert.deepEqual(dates(summary.today), ["2026-10-14"]);
  assert.equal(summary.today[0].checkIn, "08:57");
  assert.equal(summary.today[0].checkOut, "");
  const firstShort = summary.mid[0];
  assert.equal(firstShort.date, "2026-10-01");
  assert.equal(firstShort.checkIn, "08:49");
  assert.equal(firstShort.checkOut, "16:57");
  assert.equal(firstShort.hours, "06:53");
});

test("custom filo period skips weekends and future days", () => {
  const summary = summarizeAttendance(filo, "2026-10-14");
  assert.ok(dates(summary.full).includes("2026-09-30"));
  assert.ok(dates(summary.full).includes("2026-10-02"));
  assert.ok(dates(summary.full).includes("2026-10-13"));
  assert.ok(dates(summary.mid).includes("2026-10-01"));
  assert.equal(summary.mid.find((row) => row.date === "2026-10-01").hours, "06:53");
  assert.equal(summary.mid.find((row) => row.date === "2026-10-01").checkIn, "08:49");
  assert.equal(summary.mid.find((row) => row.date === "2026-10-01").checkOut, "16:57");
  assert.ok(dates(summary.absent).includes("2026-09-22"));
  assert.ok(dates(summary.absent).includes("2026-10-05"));
  assert.deepEqual(dates(summary.today), ["2026-10-14"]);
  assert.equal(summary.today[0].checkIn, "08:57");
  assert.equal(summary.today[0].checkOut, "");
  const listed = ["full", "mid", "short", "absent", "today"].flatMap((key) => dates(summary[key]));
  for (const weekend of ["2026-10-03", "2026-10-04", "2026-10-10", "2026-10-11"]) {
    assert.equal(listed.includes(weekend), false);
  }
  assert.equal(listed.includes("2026-10-16"), false);
  assert.equal(listed.includes("2026-10-20"), false);
});

test("September sample lists holiday and paid leave separately", () => {
  const summary = summarizeAttendance(sep, "2026-10-14");
  assert.deepEqual(dates(summary.holiday), ["2026-09-01", "2026-09-02"]);
  assert.deepEqual(dates(summary.paidLeave), ["2026-08-31"]);
  const listed = ["full", "mid", "short", "absent", "today"].flatMap((key) => dates(summary[key]));
  assert.equal(listed.includes("2026-09-01"), false);
  assert.equal(listed.includes("2026-09-02"), false);
  assert.equal(listed.includes("2026-08-31"), false);
});

test("hour boundaries and statuses", () => {
  const summary = summarizeAttendance({
    dayList: {
      0: { attDate: "2026-10-01", status: "Present", tHrs: "08:00" },
      1: { attDate: "2026-10-02", status: "Present", tHrs: "07:59" },
      2: { attDate: "2026-10-03", status: "Present", tHrs: "06:00" },
      3: { attDate: "2026-10-04", status: "Present", tHrs: "05:59" },
      4: { attDate: "2026-10-05", status: "Absent", tHrs: "00:00" },
      5: { attDate: "2026-10-06", status: "Weekend", tHrs: "00:00" },
      "5b": { attDate: "2026-10-10", status: "Holiday", tHrs: "00:00" },
      6: { attDate: "2026-10-07", status: "", tHrs: "00:00", futureAbsentDay: 1 },
      7: { attDate: "2026-10-08", status: "Present", tHrs: "00:00", isToday: true, filo: { ftime: "09:01" } },
      8: { attDate: "2026-10-09", status: "Present", tHrs: "08:10", isToday: true },
    },
  });
  assert.deepEqual(dates(summary.full), ["2026-10-01", "2026-10-09"]);
  assert.deepEqual(dates(summary.mid), ["2026-10-02", "2026-10-03"]);
  assert.deepEqual(dates(summary.short), ["2026-10-04"]);
  assert.deepEqual(dates(summary.absent), ["2026-10-05"]);
  assert.deepEqual(dates(summary.today), ["2026-10-08"]);
  const listed = ["full", "mid", "short", "absent", "today"].flatMap((key) => dates(summary[key]));
  assert.equal(listed.includes("2026-10-06"), false);
  assert.equal(listed.includes("2026-10-10"), false);
});

test("request status sample indexes every logged day as pending", () => {
  const byDate = indexRequestStatus(requests);
  assert.deepEqual(
    [...byDate.keys()].sort(),
    [
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-12",
    ],
  );
  const wfh = byDate.get("2026-10-12");
  assert.equal(wfh.status, "pending");
  assert.equal(wfh.label, "Chờ duyệt");
  assert.equal(wfh.from, "09:00");
  assert.equal(wfh.to, "18:15");
  assert.equal(wfh.desc, "WFH");
  // the same response passed twice (one call per month) is not double counted
  assert.equal(indexRequestStatus([requests, requests]).size, 10);
});

test("request status text maps to pending, approved, rejected", () => {
  assert.equal(requestStatusKey("Waiting for approval", -1), "pending");
  assert.equal(requestStatusKey("Pending", 0), "pending");
  assert.equal(requestStatusKey("Approved", 1), "approved");
  assert.equal(requestStatusKey("Rejected", 2), "rejected");
  assert.equal(requestStatusKey("Cancelled", 3), "rejected");
  assert.equal(requestStatusKey("", -1), "pending");
});

test("approved beats pending beats rejected when a day has several requests", () => {
  const byDate = indexRequestStatus({
    list: [
      { recordId: "1", regDetails: [{ regDetailsId: "a", originday: "05-Oct-2026", indApprovalStatus: "Rejected" }] },
      { recordId: "2", regDetails: [{ regDetailsId: "b", originday: "05-Oct-2026", indApprovalStatus: "Waiting for approval" }] },
      { recordId: "3", regDetails: [{ regDetailsId: "c", originday: "06-Oct-2026", indApprovalStatus: "Approved" }] },
      { recordId: "4", regDetails: [{ regDetailsId: "d", originday: "06-Oct-2026", indApprovalStatus: "Waiting for approval" }] },
    ],
  });
  assert.equal(byDate.get("2026-10-05").status, "pending");
  assert.equal(byDate.get("2026-10-06").status, "approved");
});

test("request status attaches to bucket rows and counts inside the period", () => {
  const summary = summarizeAttendance(filo, "2026-10-14");
  const period = { fromIso: "2026-09-21", toIso: "2026-10-20" };
  const counts = applyRequestStatus(summary, indexRequestStatus(requests), period);
  assert.equal(counts.pending, 10);
  assert.equal(counts.approved, 0);
  assert.equal(counts.rejected, 0);
  assert.equal(counts.dates.pending[0], "2026-09-21");
  const absent = summary.absent.find((row) => row.date === "2026-09-22");
  assert.equal(absent.request.status, "pending");
  const mid = summary.mid.find((row) => row.date === "2026-10-01");
  assert.equal(mid.request.label, "Chờ duyệt");
  const full = summary.full.find((row) => row.date === "2026-09-30");
  assert.equal(full.request.status, "pending");
  const untouched = summary.full.find((row) => row.date === "2026-10-02");
  assert.equal(untouched.request, null);
});

test("requests outside the period are not counted", () => {
  const summary = summarizeAttendance(filo, "2026-10-14");
  const counts = applyRequestStatus(summary, indexRequestStatus(requests), {
    fromIso: "2026-10-01",
    toIso: "2026-10-31",
  });
  assert.equal(counts.pending, 2);
  assert.deepEqual(counts.dates.pending, ["2026-10-01", "2026-10-12"]);
});

test("report heading uses the month totals", () => {
  const heading = readReportHeading(report);
  assert.equal(heading.name, "Phạm Quang Lương");
  assert.equal(heading.workingHrs, "37:42");
  assert.equal(heading.presentCount, 6);
  assert.equal(heading.absentCount, 4);
  assert.equal(heading.year, 2026);
  assert.equal(heading.month, 10);
});

test("earliest checkout adds 8h plus remaining lunch", () => {
  assert.equal(earliestFullCheckout("08:57"), "18:12");
  assert.equal(earliestFullCheckout("09:00"), "18:15");
  assert.equal(earliestFullCheckout("08:49"), "18:04");
  assert.equal(earliestFullCheckout("12:30"), "21:15");
  assert.equal(earliestFullCheckout("14:00"), "22:00");
  assert.equal(earliestFullCheckout(""), "");
  assert.equal(earliestFullCheckout("bad"), "");
});

test("month offset is relative to the current month", () => {
  assert.equal(monthOffset("2026-10", "2026-10"), 0);
  assert.equal(monthOffset("2026-09", "2026-10"), -1);
  assert.equal(monthOffset("2026-11", "2026-10"), 1);
  assert.equal(monthOffset("2025-12", "2026-01"), -1);
  assert.equal(monthOffset("bad", "2026-10"), null);
});
