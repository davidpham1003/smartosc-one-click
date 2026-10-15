import assert from "node:assert/strict";
import test from "node:test";
import { classifyMonthDays, clampToToday, isWeekendDate, monthBounds } from "./dates.js";

test("October 2026 skips Saturday and Sunday and keeps weekday bounds", () => {
  const result = classifyMonthDays({
    yearMonth: "2026-10",
    daysOff: [],
    holidayDates: [],
  });

  assert.equal(result.startDate, "2026-10-01");
  assert.equal(result.endDate, "2026-10-31");
  assert.equal(result.dates.length, 31);
  assert.deepEqual(result.skipped.weekend, [
    "2026-10-03",
    "2026-10-04",
    "2026-10-10",
    "2026-10-11",
    "2026-10-17",
    "2026-10-18",
    "2026-10-24",
    "2026-10-25",
    "2026-10-31",
  ]);
  assert.equal(result.counts.weekend, 9);
  assert.equal(result.counts.eligible, 22);
  assert.equal(result.eligible[0], "2026-10-01");
  assert.equal(result.eligible.at(-1), "2026-10-30");
  assert.equal(isWeekendDate("2026-10-02"), false);
  assert.equal(isWeekendDate("2026-10-03"), true);
  assert.equal(isWeekendDate("2026-10-04"), true);
  assert.equal(isWeekendDate("2026-10-05"), false);
});

test("days off are skipped once, and a weekend stays in the weekend bucket", () => {
  const result = classifyMonthDays({
    yearMonth: "2026-10",
    daysOff: ["2026-10-05", "2026-10-03", "2026-10-05", " 2026-10-06 "],
    holidayDates: [],
  });

  assert.deepEqual(result.skipped.daysOff, ["2026-10-05", "2026-10-06"]);
  assert.ok(result.skipped.weekend.includes("2026-10-03"));
  assert.equal(result.skipped.weekend.includes("2026-10-05"), false);
  assert.equal(result.eligible.includes("2026-10-05"), false);
  assert.equal(result.eligible.includes("2026-10-06"), false);
});

test("weekday holidays are skipped and weekend holidays stay weekends", () => {
  const result = classifyMonthDays({
    yearMonth: "2026-10",
    daysOff: [],
    holidayDates: ["2026-10-01", "2026-10-04T00:00:00.000Z", "2026-10-02"],
  });

  assert.deepEqual(result.skipped.holiday, ["2026-10-01", "2026-10-02"]);
  assert.ok(result.skipped.weekend.includes("2026-10-04"));
  assert.equal(result.eligible.includes("2026-10-01"), false);
  assert.equal(result.counts.holiday, 2);
});

test("days off win over a holiday on the same weekday", () => {
  const result = classifyMonthDays({
    yearMonth: "2026-10",
    daysOff: ["2026-10-01"],
    holidayDates: ["2026-10-01"],
  });

  assert.deepEqual(result.skipped.daysOff, ["2026-10-01"]);
  assert.deepEqual(result.skipped.holiday, []);
});

test("month boundaries: 28, 29, 30, and 31 day months", () => {
  const feb2026 = monthBounds("2026-02");
  assert.equal(feb2026.startDate, "2026-02-01");
  assert.equal(feb2026.endDate, "2026-02-28");
  assert.equal(feb2026.dates.length, 28);
  assert.equal(feb2026.dates[0], "2026-02-01");
  assert.equal(feb2026.dates.at(-1), "2026-02-28");

  const feb2024 = monthBounds("2024-02");
  assert.equal(feb2024.endDate, "2024-02-29");
  assert.equal(feb2024.dates.length, 29);

  assert.equal(monthBounds("2026-04").endDate, "2026-04-30");
  assert.equal(monthBounds("2026-04").dates.length, 30);
  assert.equal(monthBounds("2026-01").endDate, "2026-01-31");
  assert.equal(monthBounds("2026-12").startDate, "2026-12-01");
  assert.equal(monthBounds("2026-12").endDate, "2026-12-31");
});

test("February edges: first Sunday, last Saturday, leap day, invalid and outside dates", () => {
  const result = classifyMonthDays({
    yearMonth: "2026-02",
    daysOff: ["2026-02-30", "2026-02-02", "2026-01-15", "", "2026-02-01", "2026-02-02"],
    holidayDates: ["2026-02-03", "not-a-date", "2026-02-01", "2026-02-29"],
  });

  assert.deepEqual(result.skipped.weekend, [
    "2026-02-01",
    "2026-02-07",
    "2026-02-08",
    "2026-02-14",
    "2026-02-15",
    "2026-02-21",
    "2026-02-22",
    "2026-02-28",
  ]);
  assert.deepEqual(result.skipped.daysOff, ["2026-02-02"]);
  assert.deepEqual(result.skipped.holiday, ["2026-02-03"]);
  assert.deepEqual(result.ignoredDaysOff, ["2026-01-15"]);
  assert.equal(
    result.counts.weekend +
      result.counts.daysOff +
      result.counts.holiday +
      result.counts.future +
      result.counts.eligible,
    28,
  );
  assert.equal(result.eligible.includes("2026-02-02"), false);
  assert.equal(result.eligible.includes("2026-02-03"), false);
  assert.equal(result.eligible[0], "2026-02-04");

  const leap = classifyMonthDays({
    yearMonth: "2024-02",
    daysOff: [],
    holidayDates: ["2024-02-29"],
  });
  assert.equal(leap.endDate, "2024-02-29");
  assert.ok(leap.skipped.holiday.includes("2024-02-29"));
  assert.equal(leap.dates.at(-1), "2024-02-29");
});

test("days after today stay out of the API range", () => {
  const result = classifyMonthDays({
    yearMonth: "2026-10",
    daysOff: ["2026-10-14"],
    holidayDates: ["2026-10-12"],
    today: "2026-10-13",
  });

  assert.equal(result.eligible.includes("2026-10-13"), true);
  assert.equal(result.eligible.includes("2026-10-14"), false);
  assert.ok(result.skipped.future.includes("2026-10-14"));
  assert.ok(result.skipped.future.includes("2026-10-31"));
  assert.equal(result.skipped.future.includes("2026-10-11"), false);
  assert.ok(result.skipped.weekend.includes("2026-10-11"));
  assert.ok(result.skipped.holiday.includes("2026-10-12"));
  assert.equal(result.skipped.daysOff.includes("2026-10-14"), false);
  assert.equal(
    result.counts.weekend +
      result.counts.daysOff +
      result.counts.holiday +
      result.counts.future +
      result.counts.eligible,
    31,
  );
  assert.equal(clampToToday("2026-10-31", "2026-10-13"), "2026-10-13");
  assert.equal(clampToToday("2026-09-30", "2026-10-13"), "2026-09-30");
  assert.equal(clampToToday("2026-10-13", "2026-10-13"), "2026-10-13");
});

test("invalid month is rejected", () => {
  assert.throws(() => monthBounds("2026-13"), /Tháng không hợp lệ/);
  assert.throws(() => classifyMonthDays({ yearMonth: "10-2026" }), /Tháng không hợp lệ/);
  assert.throws(() => monthBounds(""), /Tháng không hợp lệ/);
});
