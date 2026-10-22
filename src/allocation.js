/**
 * Compare a timesheet day's allocation with its worklogs.
 * Allocated lines use `code`. Worklog lines use `done` (the same project code).
 */

const HOURS_EPSILON = 0.001;

export function hasWorkLogs(day) {
  return day != null && day.workLogs != null;
}

function roundHours(value) {
  const number = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(number)) return null;
  return Math.round(number * 1000) / 1000;
}

function formatHours(value) {
  const number = roundHours(value);
  if (number == null) return "0";
  return String(number);
}

function sameHours(left, right) {
  return Math.abs(left - right) <= HOURS_EPSILON;
}

function projectCode(item, keys) {
  if (!item || typeof item !== "object") return "";
  for (const key of keys) {
    if (item[key] == null) continue;
    const code = String(item[key]).trim();
    if (code) return code;
  }
  return "";
}

function projectName(item) {
  if (!item || typeof item.name !== "string") return "";
  return item.name.trim();
}

function addHours(map, code, name, hours) {
  const amount = roundHours(hours);
  if (!code || amount == null || amount === 0) return;
  const current = map.get(code);
  if (!current) {
    map.set(code, { name, hours: amount });
    return;
  }
  current.hours = roundHours(current.hours + amount);
  if (!current.name && name) current.name = name;
}

function entriesOf(detail) {
  if (Array.isArray(detail)) return detail;
  if (detail && typeof detail === "object") return Object.values(detail);
  return [];
}

function collectAllocated(allocated) {
  const map = new Map();
  const details = allocated && Array.isArray(allocated.detail) ? allocated.detail : [];
  for (const item of details) {
    addHours(map, projectCode(item, ["code"]), projectName(item), item && item.hours);
  }
  return map;
}

function collectLogged(workLogs) {
  const map = new Map();
  const details = entriesOf(workLogs && workLogs.detail);
  for (const item of details) {
    addHours(map, projectCode(item, ["done", "code"]), projectName(item), item && item.hours);
  }
  return map;
}

export function compareWorkLogs(day) {
  const allocated = collectAllocated(day && day.allocated);
  const logged = collectLogged(day && day.workLogs);
  const mismatches = [];
  const seen = new Set();

  for (const [code, alloc] of allocated) {
    seen.add(code);
    const log = logged.get(code);
    const loggedHours = log ? log.hours : 0;
    if (sameHours(alloc.hours, loggedHours)) continue;
    mismatches.push({
      code,
      name: alloc.name || (log && log.name) || "",
      allocated: alloc.hours,
      logged: loggedHours,
    });
  }

  for (const [code, log] of logged) {
    if (seen.has(code)) continue;
    mismatches.push({
      code,
      name: log.name || "",
      allocated: 0,
      logged: log.hours,
    });
  }

  return { match: mismatches.length === 0, mismatches };
}

function projectLabel(item) {
  const name = typeof item.name === "string" ? item.name.trim() : "";
  const code = item.code ? String(item.code).trim() : "";
  if (name && code) return `${name} (${code})`;
  return name || code || "Project";
}

export function mismatchMessage(item) {
  return `Số giờ chưa khớp: ${projectLabel(item)} được allocate ${formatHours(item.allocated)} giờ, đã log work ${formatHours(item.logged)} giờ.`;
}

function dayDate(day) {
  if (!day || typeof day.date !== "string") return "";
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(day.date.trim());
  return match ? match[1] : "";
}

function allocationKey(projects) {
  return projects.map((item) => `${item.code}:${item.hours}`).join("|");
}

export function summarizeAllocations(days) {
  const byKey = new Map();
  for (const day of Array.isArray(days) ? days : []) {
    const date = dayDate(day);
    const allocated = collectAllocated(day && day.allocated);
    if (!date || allocated.size === 0) continue;
    const projects = [...allocated.entries()]
      .map(([code, item]) => ({
        code,
        name: item.name || "",
        hours: item.hours,
      }))
      .sort((a, b) => b.hours - a.hours || a.code.localeCompare(b.code));
    const key = allocationKey(projects);
    const existing = byKey.get(key);
    if (existing) {
      existing.dates.push(date);
      continue;
    }
    const totalHours = projects.reduce((sum, item) => sum + item.hours, 0);
    byKey.set(key, {
      projects,
      totalHours: roundHours(totalHours) ?? 0,
      dates: [date],
    });
  }
  const groups = [...byKey.values()];
  for (const group of groups) group.dates.sort((a, b) => a.localeCompare(b));
  groups.sort((a, b) => a.dates[0].localeCompare(b.dates[0]));
  return { groups };
}
