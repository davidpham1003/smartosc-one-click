import assert from "node:assert/strict";
import test from "node:test";
import {
  attendancePeriod,
  defaultAttendanceMonth,
  buildAttendanceLog,
  buildAttendanceLogs,
  interpretAttendanceLogResponse,
  requestStatusQueries,
  selectDaysToLog,
} from "./attendance.js";

test("log response treats explicit error bodies as failure", () => {
  assert.equal(interpretAttendanceLogResponse({ status: 0 }).ok, false);
  assert.equal(interpretAttendanceLogResponse({ status: "error", msg: "Denied" }).ok, false);
  assert.equal(interpretAttendanceLogResponse({ error: "Invalid CSRF Token" }).ok, false);
  assert.equal(interpretAttendanceLogResponse({ success: false }).ok, false);
  assert.equal(interpretAttendanceLogResponse({ NODATA: "true" }).ok, false);
  assert.equal(interpretAttendanceLogResponse(null).ok, false);
});

test("log response treats a returned object as created", () => {
  assert.equal(interpretAttendanceLogResponse({}).ok, true);
  assert.equal(interpretAttendanceLogResponse({ status: 1 }).ok, true);
  assert.equal(interpretAttendanceLogResponse({ status: -1 }).ok, true);
  assert.equal(interpretAttendanceLogResponse({ Status: "Success" }).ok, true);
  assert.equal(interpretAttendanceLogResponse({ code: 0 }).ok, true);
  assert.equal(interpretAttendanceLogResponse({ pkId: "412762000345519790", msg: "success" }).ok, true);
});

test("request status queries cover each calendar month using the previous month plus navigate=1", () => {
  assert.deepEqual(requestStatusQueries(attendancePeriod("2026-10")), [
    { sDate: "01-Aug-2026", eDate: "31-Aug-2026", navigate: "1" },
    { sDate: "01-Sep-2026", eDate: "30-Sep-2026", navigate: "1" },
  ]);
  assert.deepEqual(requestStatusQueries(attendancePeriod("2026-01")), [
    { sDate: "01-Nov-2025", eDate: "30-Nov-2025", navigate: "1" },
    { sDate: "01-Dec-2025", eDate: "31-Dec-2025", navigate: "1" },
  ]);
  assert.deepEqual(requestStatusQueries(null), []);
});

test("from the 21st the default attendance month is next month", () => {
  assert.equal(defaultAttendanceMonth("2026-10-20"), "2026-10");
  assert.equal(defaultAttendanceMonth("2026-10-21"), "2026-11");
  assert.equal(defaultAttendanceMonth("2026-10-22"), "2026-11");
  assert.equal(defaultAttendanceMonth("2026-12-21"), "2027-01");
  assert.equal(defaultAttendanceMonth(""), "");
});

test("attendance period runs from the 21st through the 20th", () => {
  assert.deepEqual(attendancePeriod("2026-10"), {
    fromDate: "21-Sep-2026",
    toDate: "20-Oct-2026",
    fromIso: "2026-09-21",
    toIso: "2026-10-20",
  });
  assert.equal(attendancePeriod("2026-01").fromDate, "21-Dec-2025");
  assert.equal(attendancePeriod("2026-13"), null);
});

test("log payload uses 09:00-18:15 and the Zoho day format", () => {
  const log = buildAttendanceLog({
    isoDate: "2026-10-12",
    erecno: "412762000208872805",
    desc: "WFH",
  });
  assert.equal(log.fdate, "12-Oct-2026");
  assert.equal(log.erecno, "412762000208872805");
  assert.deepEqual(JSON.parse(log.dataObj), {
    "12-Oct-2026": {
      fromDate: "12-Oct-2026",
      toDate: "12-Oct-2026",
      reasonanddesc: { desc: "WFH" },
      ftime: 540,
      ttime: 1095,
    },
  });
});

test("single-digit days stay zero padded", () => {
  const log = buildAttendanceLog({ isoDate: "2026-10-05", erecno: "1", desc: "Attendance" });
  assert.equal(log.fdate, "05-Oct-2026");
  assert.equal(JSON.parse(log.dataObj)["05-Oct-2026"].reasonanddesc.desc, "Attendance");
});

test("log all keeps at most five 6-8 hour days and logs the earliest extras", () => {
  const mid = ["2026-10-01", "2026-10-02", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-13"].map(
    (date) => ({ date }),
  );
  const selected = selectDaysToLog({
    absent: [{ date: "2026-09-22" }],
    short: [{ date: "2026-09-23" }],
    mid,
  }).map((row) => row.date);
  assert.deepEqual(selected, ["2026-09-22", "2026-09-23", "2026-10-01", "2026-10-02"]);
});

test("five or fewer 6-8 hour days are left unlogged", () => {
  const selected = selectDaysToLog({
    absent: [],
    short: [{ date: "2026-10-05" }],
    mid: ["2026-10-01", "2026-10-06", "2026-10-07"].map((date) => ({ date })),
  }).map((row) => row.date);
  assert.deepEqual(selected, ["2026-10-05"]);
});

test("bulk log uses the first and last day with 09:00-18:15", () => {
  const log = buildAttendanceLogs({
    isoDates: ["2026-10-01", "2026-09-22", "2026-09-21"],
    erecno: "412762000208872805",
  });
  assert.equal(log.fdate, "21-Sep-2026");
  assert.equal(log.tdate, "01-Oct-2026");
  const data = JSON.parse(log.dataObj);
  assert.deepEqual(Object.keys(data), ["21-Sep-2026", "22-Sep-2026", "01-Oct-2026"]);
  assert.deepEqual(data["22-Sep-2026"], {
    fromDate: "22-Sep-2026",
    toDate: "22-Sep-2026",
    ftime: 540,
    ttime: 1095,
  });
});

test("missing employee id is not a payload", () => {
  assert.equal(buildAttendanceLog({ isoDate: "2026-10-12", erecno: "  ", desc: "WFH" }), null);
});
