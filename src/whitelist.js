import { FALLBACK_ACCOUNT_ROWS, parseAllowedAccounts } from "./access.js";
import { SUPABASE_ANON_KEY, SUPABASE_URL, WHITELIST_ACCOUNT_TABLE, WHITELIST_TABLE } from "./config.js";

export const FALLBACK_WHITELIST = [
  { domain: "https://sra.smartosc.com/", type: "logwork" },
  { domain: "https://people.zoho.com/", type: "log-attendance" },
  { domain: "https://people.smartosc.com/", type: "log-attendance" },
];

let cached = null;
let inflight = null;
let cachedAccounts = null;
let inflightAccounts = null;

export function normalizeOrigin(value) {
  if (!value || typeof value !== "string") return "";
  const trimmed = value.trim();
  const candidates = [trimmed, trimmed.includes("://") ? "" : `https://${trimmed}`].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      return parsed.origin;
    } catch {
      // try the next candidate
    }
  }
  return "";
}

export function typeToSurface(type) {
  const normalized = String(type || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (normalized === "logwork" || normalized === "log-work") return "timesheet";
  if (normalized === "log-attendance" || normalized === "logattendance") return "people";
  return "other";
}

export function parseWhitelist(rows) {
  const entries = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const origin = normalizeOrigin(row && row.domain);
    const surface = typeToSurface(row && row.type);
    if (!origin || surface === "other" || seen.has(origin)) continue;
    seen.add(origin);
    entries.push({
      origin,
      surface,
      domain: row.domain,
      type: row.type,
    });
  }
  return entries;
}

async function fetchWhitelistRows() {
  return fetchTableRows(WHITELIST_TABLE, "domain,type");
}

export async function loadWhitelist({ force = false } = {}) {
  if (!force && cached) return cached;
  if (!force && inflight) return inflight;
  inflight = fetchWhitelistRows()
    .then((rows) => {
      const entries = parseWhitelist(rows);
      cached = entries.length > 0 ? entries : parseWhitelist(FALLBACK_WHITELIST);
      return cached;
    })
    .catch((error) => {
      console.warn("Không lấy được whitelist từ Supabase, dùng danh sách mặc định.", error);
      cached = parseWhitelist(FALLBACK_WHITELIST);
      return cached;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

async function fetchTableRows(table, select) {
  const url = `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/${encodeURIComponent(table)}?select=${select}`;
  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${table} HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error(`${table} không phải danh sách.`);
  return rows;
}

export async function loadAllowedAccounts({ force = false } = {}) {
  if (!force && cachedAccounts) return cachedAccounts;
  if (!force && inflightAccounts) return inflightAccounts;
  inflightAccounts = fetchTableRows(WHITELIST_ACCOUNT_TABLE, "account")
    .then((rows) => {
      cachedAccounts = parseAllowedAccounts(rows);
      return cachedAccounts;
    })
    .catch((error) => {
      console.warn("Không lấy được whitelist-account từ Supabase, dùng danh sách mặc định.", error);
      cachedAccounts = parseAllowedAccounts(FALLBACK_ACCOUNT_ROWS);
      return cachedAccounts;
    })
    .finally(() => {
      inflightAccounts = null;
    });
  return inflightAccounts;
}

export function resetWhitelistCache() {
  cached = null;
  inflight = null;
  cachedAccounts = null;
  inflightAccounts = null;
}
