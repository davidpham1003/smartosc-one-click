import assert from "node:assert/strict";
import test from "node:test";
import { detectSurface } from "./surface.js";

test("timesheet keeps the log work surface", () => {
  assert.equal(detectSurface("https://sra.smartosc.com/time-sheet"), "timesheet");
  assert.equal(detectSurface("https://sra.smartosc.com/time-sheet/"), "timesheet");
  assert.equal(detectSurface("https://sra.smartosc.com/time-sheet?month=2026-10"), "timesheet");
});

test("Zoho People uses the attendance surface", () => {
  assert.equal(detectSurface("https://people.zoho.com/hrportal1524046581683/zp"), "people");
  assert.equal(detectSurface("https://people.zoho.com/"), "people");
});

test("other pages stay off both tools", () => {
  assert.equal(detectSurface("https://sra.smartosc.com/"), "other");
  assert.equal(detectSurface("https://example.com/time-sheet"), "other");
  assert.equal(detectSurface(""), "other");
  assert.equal(detectSurface(null), "other");
});
