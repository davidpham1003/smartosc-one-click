import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  earliestFullCheckout,
  findTodayRecord,
  formatCountdown,
  remainingMsUntilCheckout,
  shouldShowEarliestCheckout,
  summarizeAttendance,
} from "./attendanceSummary.js";

const viewAction = JSON.parse(readFileSync(new URL("../res/viewAction.json", import.meta.url), "utf8"));

test("viewAction today keeps check-in 13:30 while still in", () => {
  const summary = summarizeAttendance(viewAction, "2026-10-16");
  assert.equal(summary.today.length, 1);
  assert.equal(summary.today[0].date, "2026-10-16");
  assert.equal(summary.today[0].checkIn, "13:30");
  assert.equal(summary.today[0].checkOut, "");
  assert.equal(earliestFullCheckout(summary.today[0].checkIn), "21:30");
});

test("earliest checkout stays visible after punch-out until 8h", () => {
  const summary = {
    today: [],
    full: [{ date: "2026-10-22", checkIn: "08:57", checkOut: "18:12", minutes: 480 }],
    mid: [{ date: "2026-10-21", checkIn: "09:00", checkOut: "16:00", minutes: 360 }],
    short: [],
    absent: [],
  };
  const stillShort = findTodayRecord(summary, "2026-10-21");
  assert.equal(stillShort.checkOut, "16:00");
  assert.equal(shouldShowEarliestCheckout(stillShort, new Date("2026-10-21T16:30:00+07:00")), true);
  assert.equal(shouldShowEarliestCheckout(stillShort, new Date("2026-10-21T22:00:00+07:00")), true);
  const done = findTodayRecord(summary, "2026-10-22");
  assert.equal(shouldShowEarliestCheckout(done, new Date("2026-10-22T19:00:00+07:00")), false);
});

test("countdown reaches earliest 8h checkout", () => {
  const now = new Date("2026-10-16T14:00:00+07:00");
  assert.equal(formatCountdown(remainingMsUntilCheckout("13:30", now)), "07:30:00");
  assert.equal(formatCountdown(remainingMsUntilCheckout("13:30", new Date("2026-10-16T21:30:00+07:00"))), "00:00:00");
  assert.equal(formatCountdown(remainingMsUntilCheckout("13:30", new Date("2026-10-16T21:31:00+07:00"))), "00:00:00");
  assert.equal(formatCountdown(-1000), "00:00:00");
  assert.equal(remainingMsUntilCheckout(""), null);
});
