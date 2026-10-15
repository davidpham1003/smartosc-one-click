/**
 * Calendar rules for a monthly worklog run.
 * A day lands in at most one skip bucket: after today, else Saturday/Sunday, else days off, else holiday.
 */

const YEAR_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function parseYearMonth(value) {
  if (typeof value !== "string" || !YEAR_MONTH.test(value)) {
    throw new Error("Tháng không hợp lệ");
  }
  const [year, month] = value.split("-").map(Number);
  return { year, month };
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isWeekendDate(isoDate) {
  const parsed = canonicalDate(isoDate);
  if (!parsed) return false;
  const [year, month, day] = parsed.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

export function canonicalDate(value) {
  if (typeof value !== "string") return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return "";
  if (day > daysInMonth(year, month)) return "";
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function clampToToday(isoDate, today) {
  const iso = canonicalDate(isoDate);
  const limit = canonicalDate(today);
  if (!iso) return "";
  if (!limit) return iso;
  return iso > limit ? limit : iso;
}

export function monthBounds(yearMonth) {
  const { year, month } = parseYearMonth(yearMonth);
  const last = daysInMonth(year, month);
  const dates = [];
  for (let day = 1; day <= last; day += 1) {
    dates.push(
      `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    );
  }
  return {
    yearMonth: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`,
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    dates,
  };
}

function uniqueDates(values) {
  const seen = new Set();
  const dates = [];
  for (const value of values) {
    const iso = canonicalDate(value);
    if (!iso || seen.has(iso)) continue;
    seen.add(iso);
    dates.push(iso);
  }
  return dates;
}

export function classifyMonthDays({ yearMonth, daysOff = [], holidayDates = [], today = "" }) {
  const bounds = monthBounds(yearMonth);
  const inMonth = new Set(bounds.dates);
  const todayIso = canonicalDate(today);
  const offDates = uniqueDates(daysOff);
  const holidays = uniqueDates(holidayDates);
  const offInMonth = new Set(offDates.filter((iso) => inMonth.has(iso)));
  const holidayInMonth = new Set(holidays.filter((iso) => inMonth.has(iso)));

  const skipped = { weekend: [], daysOff: [], holiday: [], future: [] };
  const eligible = [];

  for (const iso of bounds.dates) {
    if (todayIso && iso > todayIso) skipped.future.push(iso);
    else if (isWeekendDate(iso)) skipped.weekend.push(iso);
    else if (offInMonth.has(iso)) skipped.daysOff.push(iso);
    else if (holidayInMonth.has(iso)) skipped.holiday.push(iso);
    else eligible.push(iso);
  }

  return {
    ...bounds,
    today: todayIso,
    eligible,
    skipped,
    ignoredDaysOff: offDates.filter((iso) => !inMonth.has(iso)),
    counts: {
      weekend: skipped.weekend.length,
      daysOff: skipped.daysOff.length,
      holiday: skipped.holiday.length,
      future: skipped.future.length,
      eligible: eligible.length,
    },
  };
}
