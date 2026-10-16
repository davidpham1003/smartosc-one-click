/**
 * Which side panel to show for the active tab.
 * timesheet → SRA log work (type logwork). people → attendance (type log-attendance).
 */

export function detectSurface(url, entries = []) {
  if (!url || typeof url !== "string") return "other";
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "other";
  }
  const match = (entries || []).find((entry) => entry && entry.origin === parsed.origin);
  if (!match) return "other";
  if (match.surface === "timesheet") {
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    if (path === "/time-sheet") return "timesheet";
    return "other";
  }
  return match.surface;
}

export function timesheetHref(entries = []) {
  const work = (entries || []).find((entry) => entry && entry.surface === "timesheet");
  return work ? `${work.origin}/time-sheet` : "https://sra.smartosc.com/time-sheet";
}

export function loginMessage(entries = []) {
  return `Đăng nhập tại ${timesheetHref(entries)} để tiếp tục log work.`;
}

export function unsupportedMessage(entries = []) {
  const attendance = [
    ...new Set(
      (entries || [])
        .filter((entry) => entry && entry.surface === "people")
        .map((entry) => {
          try {
            return new URL(entry.origin).host;
          } catch {
            return "";
          }
        })
        .filter(Boolean),
    ),
  ];
  const attendanceText = attendance.length > 0 ? attendance.join(", ") : "trang chấm công";
  return `Mở ${timesheetHref(entries)} để log work, hoặc ${attendanceText} để xem và log chấm công.`;
}
