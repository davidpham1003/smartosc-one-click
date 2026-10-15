/**
 * Bucket attendance by net hours.
 * getAttFiloInfo uses regDetails (21st of the previous month through the 20th).
 * The older getAttList dayList shape is still accepted.
 * Weekends, holidays, and days that have not happened stay out of every bucket.
 */

const FULL_MINUTES = 8 * 60;
const MID_MINUTES = 6 * 60;
// 09:00–18:15 nets 8h, so lunch is 12:00–13:15.
const LUNCH_START_MINUTES = 12 * 60;
const LUNCH_END_MINUTES = 13 * 60 + 15;
const ZOHO_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthOffset(selected, today) {
  const selectedMatch = /^(\d{4})-(\d{2})$/.exec(selected || "");
  const todayMatch = /^(\d{4})-(\d{2})$/.exec(today || "");
  if (!selectedMatch || !todayMatch) return null;
  const selectedIndex = Number(selectedMatch[1]) * 12 + Number(selectedMatch[2]);
  const todayIndex = Number(todayMatch[1]) * 12 + Number(todayMatch[2]);
  return selectedIndex - todayIndex;
}

function clockMinutes(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,3}):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function isWeekendOrHoliday(status) {
  if (status === "Weekend") return true;
  return /holiday/i.test(status);
}

function workedMinutes(day) {
  const fromClock = clockMinutes(day.tHrs);
  if (fromClock != null) return fromClock;
  const seconds = Number(day.tsecs);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds / 60);
  return 0;
}

function dayRecord(day, minutes) {
  const filo = day.filo && typeof day.filo === "object" ? day.filo : {};
  const checkIn = typeof filo.ftime === "string" ? filo.ftime : "";
  const rawOut = typeof filo.ttime === "string" ? filo.ttime : "";
  return {
    date: day.attDate,
    hours: typeof day.tHrs === "string" ? day.tHrs : "",
    minutes,
    checkIn,
    checkOut: rawOut && rawOut !== checkIn ? rawOut : "",
  };
}

function emptyBuckets() {
  return { full: [], mid: [], short: [], absent: [], today: [], holiday: [], paidLeave: [] };
}

function formatMinutes(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function earliestFullCheckout(checkIn) {
  const start = clockMinutes(checkIn);
  if (start == null) return "";
  const remainingLunch = Math.max(0, LUNCH_END_MINUTES - Math.max(start, LUNCH_START_MINUTES));
  return formatMinutes(start + FULL_MINUTES + remainingLunch);
}

function zohoKeyToIso(key) {
  const match = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(key || "");
  if (!match) return "";
  const month = ZOHO_MONTHS.indexOf(match[2]) + 1;
  if (month < 1) return "";
  return `${match[3]}-${String(month).padStart(2, "0")}-${match[1]}`;
}

function summarizeFilo(regDetails, today) {
  const buckets = emptyBuckets();
  const entries = Object.entries(regDetails)
    .map(([key, day]) => ({ iso: zohoKeyToIso(key), day }))
    .filter((entry) => entry.iso && entry.day && typeof entry.day === "object" && !Array.isArray(entry.day))
    .sort((a, b) => a.iso.localeCompare(b.iso));

  for (const { iso, day } of entries) {
    const seconds = Number(day.totalhrs);
    const minutes = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds / 60) : 0;
    const checkIn = typeof day.fromdate === "string" ? day.fromdate : "";
    const rawOut = typeof day.todate === "string" ? day.todate : "";
    const record = {
      date: iso,
      hours: minutes > 0 ? formatMinutes(minutes) : "00:00",
      minutes,
      checkIn,
      checkOut: rawOut && rawOut !== checkIn ? rawOut : "",
    };
    if (day.isHoliday === true) {
      buckets.holiday.push(record);
      continue;
    }
    if (day.isPaidLeave === true) {
      buckets.paidLeave.push(record);
      continue;
    }
    if (day.isWeekend === true) continue;
    const hasPunch = Boolean(checkIn) || minutes > 0;
    if (!hasPunch && day.isAbsent !== true) continue;
    if (today && iso > today) continue;
    if (today && iso === today && minutes === 0) {
      buckets.today.push(record);
      continue;
    }
    if (day.isAbsent === true && minutes === 0) {
      buckets.absent.push(record);
      continue;
    }
    if (minutes >= FULL_MINUTES) buckets.full.push(record);
    else if (minutes >= MID_MINUTES) buckets.mid.push(record);
    else buckets.short.push(record);
  }
  return buckets;
}

export function summarizeAttendance(view, today) {
  if (view && view.regDetails && typeof view.regDetails === "object") {
    return summarizeFilo(view.regDetails, today || "");
  }
  const buckets = emptyBuckets();
  const dayList = view && view.dayList;
  if (!dayList || typeof dayList !== "object") return buckets;

  const days = Object.values(dayList)
    .filter((day) => day && typeof day === "object" && typeof day.attDate === "string")
    .sort((a, b) => a.attDate.localeCompare(b.attDate));

  for (const day of days) {
    const status = typeof day.status === "string" ? day.status : "";
    if (day.futureAbsentDay || status === "" || isWeekendOrHoliday(status)) continue;
    if (status === "Absent") {
      buckets.absent.push(dayRecord(day, workedMinutes(day)));
      continue;
    }
    const minutes = workedMinutes(day);
    if (day.isToday === true && minutes === 0) {
      buckets.today.push(dayRecord(day, minutes));
      continue;
    }
    const record = dayRecord(day, minutes);
    if (minutes >= FULL_MINUTES) buckets.full.push(record);
    else if (minutes >= MID_MINUTES) buckets.mid.push(record);
    else buckets.short.push(record);
  }

  return buckets;
}

const REQUEST_STATUS_LABELS = { pending: "Chờ duyệt", approved: "Đã duyệt", rejected: "Từ chối" };
const REQUEST_STATUS_RANK = { rejected: 0, pending: 1, approved: 2 };

export function requestStatusKey(text, code) {
  const value = typeof text === "string" ? text.toLowerCase() : "";
  if (/reject|cancel|denied|withdraw/.test(value)) return "rejected";
  if (/waiting|pending|await/.test(value)) return "pending";
  if (/approv|accept/.test(value)) return "approved";
  if (code === -1 || code === "-1") return "pending";
  return "pending";
}

/**
 * Index getMyRequest responses by ISO date. Accepts one response or an array of them
 * (one per calendar month) and de-duplicates by regDetailsId.
 */
export function indexRequestStatus(responses) {
  const byDate = new Map();
  const seen = new Set();
  const payloads = Array.isArray(responses) ? responses : [responses];
  for (const payload of payloads) {
    const list = payload && Array.isArray(payload.list) ? payload.list : [];
    for (const record of list) {
      if (!record || typeof record !== "object") continue;
      const details = Array.isArray(record.regDetails) ? record.regDetails : [];
      for (const detail of details) {
        if (!detail || typeof detail !== "object") continue;
        const iso = zohoKeyToIso(detail.originday);
        if (!iso) continue;
        const id = detail.regDetailsId ? String(detail.regDetailsId) : `${record.recordId || ""}:${iso}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const status = requestStatusKey(
          detail.indApprovalStatus || record.approvalStatus,
          detail.status ?? record.status,
        );
        const entry = {
          status,
          label: REQUEST_STATUS_LABELS[status],
          from: typeof detail.new_intime === "string" ? detail.new_intime : "",
          to: typeof detail.new_outtime === "string" ? detail.new_outtime : "",
          desc: typeof detail.desc_notEnc === "string" ? detail.desc_notEnc : typeof detail.desc === "string" ? detail.desc : "",
          recordId: record.recordId == null ? "" : String(record.recordId),
        };
        const existing = byDate.get(iso);
        if (!existing || REQUEST_STATUS_RANK[entry.status] > REQUEST_STATUS_RANK[existing.status]) {
          byDate.set(iso, entry);
        }
      }
    }
  }
  return byDate;
}

/**
 * Attach `request` to every bucket row and count requests inside the period.
 * Returns { pending, approved, rejected, dates: { pending: [...], ... } }.
 */
export function applyRequestStatus(summary, statusByDate, period) {
  const counts = { pending: 0, approved: 0, rejected: 0, dates: { pending: [], approved: [], rejected: [] } };
  if (summary && typeof summary === "object") {
    for (const rows of Object.values(summary)) {
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const request = statusByDate instanceof Map ? statusByDate.get(row.date) : null;
        row.request = request || null;
      }
    }
  }
  if (!(statusByDate instanceof Map)) return counts;
  const fromIso = period && period.fromIso ? period.fromIso : "";
  const toIso = period && period.toIso ? period.toIso : "";
  for (const [date, request] of [...statusByDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (fromIso && date < fromIso) continue;
    if (toIso && date > toIso) continue;
    counts[request.status] += 1;
    counts.dates[request.status].push(date);
  }
  return counts;
}

export function readReportHeading(report) {
  const details = report && report.monthDetails;
  if (!details || typeof details !== "object") return null;
  const monthIndex = Number(details.currMonthVal);
  return {
    name: typeof details.name === "string" ? details.name : "",
    workingHrs: typeof details.workingHrs === "string" ? details.workingHrs : "",
    presentCount: Number.isFinite(Number(details.present_count)) ? Number(details.present_count) : null,
    absentCount: Number.isFinite(Number(details.absent_count)) ? Number(details.absent_count) : null,
    weekendCount: Number.isFinite(Number(details.weekend_count)) ? Number(details.weekend_count) : null,
    year: Number.isFinite(Number(details.year)) ? Number(details.year) : null,
    month: Number.isFinite(monthIndex) ? monthIndex + 1 : null,
  };
}
