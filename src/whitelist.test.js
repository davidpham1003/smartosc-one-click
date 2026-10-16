import assert from "node:assert/strict";
import test from "node:test";
import { FALLBACK_WHITELIST, normalizeOrigin, parseWhitelist, typeToSurface } from "./whitelist.js";

test("normalizes stored domains to origin", () => {
  assert.equal(normalizeOrigin("https://sra.smartosc.com/"), "https://sra.smartosc.com");
  assert.equal(normalizeOrigin("https://people.zoho.com/"), "https://people.zoho.com");
  assert.equal(normalizeOrigin("https://people.smartosc.com/"), "https://people.smartosc.com");
  assert.equal(normalizeOrigin("people.smartosc.com"), "https://people.smartosc.com");
});

test("maps whitelist types to surfaces", () => {
  assert.equal(typeToSurface("logwork"), "timesheet");
  assert.equal(typeToSurface("log-attendance"), "people");
  assert.equal(typeToSurface("unknown"), "other");
});

test("parses the three known whitelist rows", () => {
  const entries = parseWhitelist(FALLBACK_WHITELIST);
  assert.deepEqual(
    entries.map((entry) => [entry.origin, entry.surface]),
    [
      ["https://sra.smartosc.com", "timesheet"],
      ["https://people.zoho.com", "people"],
      ["https://people.smartosc.com", "people"],
    ],
  );
});
