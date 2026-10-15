/**
 * Which side panel to show for the active tab.
 * timesheet → existing SRA log work. people → Zoho People month summary.
 */

export function detectSurface(url) {
  if (!url || typeof url !== "string") return "other";
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "other";
  }
  if (parsed.origin === "https://sra.smartosc.com") {
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    if (path === "/time-sheet") return "timesheet";
  }
  if (parsed.origin === "https://people.zoho.com") return "people";
  return "other";
}
