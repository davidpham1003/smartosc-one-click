import assert from "node:assert/strict";
import test from "node:test";
import { detectSurface, loginMessage, timesheetHref, unsupportedMessage } from "./surface.js";
import { FALLBACK_WHITELIST, parseWhitelist } from "./whitelist.js";

const whitelist = parseWhitelist(FALLBACK_WHITELIST);

test("timesheet keeps the log work surface", () => {
  assert.equal(detectSurface("https://sra.smartosc.com/time-sheet", whitelist), "timesheet");
  assert.equal(detectSurface("https://sra.smartosc.com/time-sheet/", whitelist), "timesheet");
  assert.equal(detectSurface("https://sra.smartosc.com/time-sheet?month=2026-10", whitelist), "timesheet");
});

test("Zoho People uses the attendance surface", () => {
  assert.equal(detectSurface("https://people.zoho.com/hrportal1524046581683/zp", whitelist), "people");
  assert.equal(detectSurface("https://people.zoho.com/", whitelist), "people");
});

test("people.smartosc.com uses the attendance surface", () => {
  assert.equal(detectSurface("https://people.smartosc.com/", whitelist), "people");
  assert.equal(detectSurface("https://people.smartosc.com/hrportal123/zp", whitelist), "people");
});

test("other pages stay off both tools", () => {
  assert.equal(detectSurface("https://sra.smartosc.com/", whitelist), "other");
  assert.equal(detectSurface("https://example.com/time-sheet", whitelist), "other");
  assert.equal(detectSurface("", whitelist), "other");
  assert.equal(detectSurface(null, whitelist), "other");
});

test("copy uses whitelist hosts", () => {
  assert.equal(timesheetHref(whitelist), "https://sra.smartosc.com/time-sheet");
  assert.equal(
    loginMessage(whitelist),
    "Đăng nhập tại https://sra.smartosc.com/time-sheet để tiếp tục log work.",
  );
  assert.equal(
    unsupportedMessage(whitelist),
    "Mở https://sra.smartosc.com/time-sheet để log work, hoặc people.zoho.com, people.smartosc.com để xem và log chấm công.",
  );
});
