import { compareWorkLogs, hasWorkLogs, mismatchMessage, summarizeAllocations } from "./allocation.js";
import {
  applyRequestStatus,
  earliestFullCheckout,
  findTodayRecord,
  formatCountdown,
  indexRequestStatus,
  readReportHeading,
  remainingMsUntilCheckout,
  shouldShowEarliestCheckout,
  summarizeAttendance,
} from "./attendanceSummary.js";
import {
  attendancePeriod,
  buildAttendanceLog,
  buildAttendanceLogs,
  defaultAttendanceMonth,
  MAX_PARTIAL_DAYS,
  requestStatusQueries,
  runInZohoPage,
  selectDaysToLog,
} from "./attendance.js";
import { accessFromOrgUser, canAccess, deptNameListFromUser } from "./access.js";
import { runInPage } from "./bridge.js";
import { classifyMonthDays, clampToToday } from "./dates.js";
import { detectSurface, loginMessage, timesheetHref, unsupportedMessage } from "./surface.js";
import { loadAllowedAccounts, loadWhitelist } from "./whitelist.js";

let whitelistEntries = [];
let allowedAccounts = new Set();
const ACCESS_DENIED_MESSAGE =
  "Bạn không có quyền sử dụng One Click. Hiện tại app chỉ hỗ trợ member Division 8, vui lòng liên hệ luongpq để được cấp quyền.";
const SESSION_EXPIRED_MESSAGE = "Phiên đăng nhập đã hết hạn. Bấm OK để tải lại trang và đăng nhập lại.";

const monthInput = document.querySelector("#month");
const typeSelect = document.querySelector("#type-of-work");
const descriptionInput = document.querySelector("#description");
const daysOffList = document.querySelector("#days-off");
const addDayOffButton = document.querySelector("#add-day-off");
const form = document.querySelector("#form");
const fields = document.querySelector("#fields");
const submitButton = document.querySelector("#submit");
const reloadButton = document.querySelector("#reload");
const banner = document.querySelector("#banner");
const formError = document.querySelector("#form-error");
const sessionLine = document.querySelector("#session");
const statusLine = document.querySelector("#status");
const summary = document.querySelector("#summary");
const empty = document.querySelector("#empty");
const tableWrap = document.querySelector("#table-wrap");
const rows = document.querySelector("#rows");
const sessionDialog = document.querySelector("#session-dialog");
const sessionOk = document.querySelector("#session-ok");
const eyebrow = document.querySelector(".eyebrow");
const title = document.querySelector("h1");
const logwork = document.querySelector("#logwork");
const peoplePanel = document.querySelector("#people");
const peopleMonthInput = document.querySelector("#people-month");
const peopleStatus = document.querySelector("#people-status");
const peopleAnnounce = document.querySelector("#people-announce");
const peopleSummary = document.querySelector("#people-summary");
const peopleBuckets = document.querySelector("#people-buckets");
const logAllButton = document.querySelector("#log-all");
const allocationsPanel = document.querySelector("#allocations");
const allocationsStatus = document.querySelector("#allocations-status");
const allocationsTableWrap = document.querySelector("#allocations-table-wrap");
const allocationRows = document.querySelector("#allocation-rows");
const allocationsTotal = document.querySelector("#allocations-total");

let running = false;
let peopleSourceTabId = null;
let peopleErecno = "";
let peopleAttendance = null;
let peopleLogging = false;
let checkoutTimer = null;
const peopleDayButtons = new Map();
const loggedDates = new Set();
let sessionReady = false;
let typesLoaded = false;
let contextGeneration = 0;
let expiredPrompted = false;
let reloadTabId = null;
let sessionPromptResolve = null;

monthInput.value = currentMonth();
peopleMonthInput.value = defaultAttendanceMonth(todayIso()) || currentMonth();
applyFormLock();

sessionDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
});
sessionOk.addEventListener("click", () => {
  sessionDialog.close();
  const tabId = reloadTabId;
  reloadTabId = null;
  if (tabId != null && chrome.tabs?.reload) chrome.tabs.reload(tabId).catch(() => {});
  if (sessionPromptResolve) {
    const resolve = sessionPromptResolve;
    sessionPromptResolve = null;
    resolve();
  }
});

addDayOffButton.addEventListener("click", () => addDayOff(""));
reloadButton.addEventListener("click", () => {
  expiredPrompted = false;
  refreshContext({ forceTypes: true, resetPeople: true });
});
form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (running || submitButton.disabled) return;
  logWork();
});
monthInput.addEventListener("input", () => {
  applyFormLock();
  if (sessionReady) refreshAllocations();
});
typeSelect.addEventListener("change", () => applyFormLock());
peopleMonthInput.addEventListener("change", () => {
  refreshContext({ resetPeople: true });
});
logAllButton.addEventListener("click", () => {
  logAllAttendance();
});

if (typeof chrome !== "undefined" && chrome.tabs?.onActivated) {
  chrome.tabs.onActivated.addListener(() => {
    refreshContext();
  });
  chrome.tabs.onUpdated.addListener((_tabId, info) => {
    if (info.status === "complete" || info.url) refreshContext();
  });
}

refreshContext();

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function todayIso() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = {};
  for (const part of parts) {
    if (part.type === "year" || part.type === "month" || part.type === "day") value[part.type] = part.value;
  }
  return `${value.year}-${value.month}-${value.day}`;
}

function addDayOff(value) {
  const row = document.createElement("div");
  row.className = "day-off";
  const input = document.createElement("input");
  input.type = "date";
  input.value = value;
  input.setAttribute("aria-label", "Ngày off");
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "ghost";
  remove.textContent = "Xóa";
  remove.addEventListener("click", () => row.remove());
  row.append(input, remove);
  daysOffList.append(row);
}

function collectDaysOff() {
  return [...daysOffList.querySelectorAll("input")]
    .map((input) => input.value)
    .filter(Boolean);
}

function showBanner(message) {
  banner.hidden = false;
  banner.replaceChildren();
  const loginText = loginMessage(whitelistEntries);
  if (message !== loginText) {
    banner.textContent = message;
    return;
  }
  const url = timesheetHref(whitelistEntries);
  banner.append("Đăng nhập tại ");
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = url;
  banner.append(link, " để tiếp tục log work.");
}

function hideBanner() {
  banner.hidden = true;
  banner.textContent = "";
}

function showFormError(message) {
  formError.hidden = false;
  formError.textContent = message;
}

function hideFormError() {
  formError.hidden = true;
  formError.textContent = "";
}

function setStatus(message) {
  if (!message) {
    statusLine.hidden = true;
    statusLine.textContent = "";
    return;
  }
  statusLine.hidden = false;
  statusLine.textContent = message;
}

function setEmpty(title, text) {
  empty.hidden = false;
  empty.replaceChildren();
  const heading = document.createElement("p");
  heading.className = "empty-title";
  heading.textContent = title;
  const body = document.createElement("p");
  body.textContent = text;
  empty.append(heading, body);
  tableWrap.hidden = true;
}

function isTimesheetUrl(url) {
  return detectSurface(url, whitelistEntries) === "timesheet";
}

function requiredFieldsReady() {
  return Boolean(monthInput.value && typeSelect.value);
}

function applyFormLock() {
  fields.disabled = running;
  submitButton.disabled = running || !sessionReady || !requiredFieldsReady();
  reloadButton.disabled = running;
  submitButton.textContent = running ? "Đang log work…" : "Log work";
  if (running) submitButton.setAttribute("aria-busy", "true");
  else submitButton.removeAttribute("aria-busy");
}

function setRunning(next) {
  running = next;
  applyFormLock();
}

function setSessionReady(ready) {
  sessionReady = ready;
  if (!running) applyFormLock();
}

function noteHealthySession() {
  expiredPrompted = false;
}

function promptSessionExpired(tab) {
  setSessionReady(false);
  showBanner(SESSION_EXPIRED_MESSAGE);
  setStatus("Phiên đăng nhập đã hết hạn.");
  if (expiredPrompted) return Promise.resolve();
  expiredPrompted = true;
  reloadTabId = tab && tab.id != null ? tab.id : null;
  return new Promise((resolve) => {
    sessionPromptResolve = resolve;
    try {
      if (!sessionDialog.open) sessionDialog.showModal();
    } catch {
      window.alert(SESSION_EXPIRED_MESSAGE);
      if (reloadTabId != null) chrome.tabs.reload(reloadTabId).catch(() => {});
      reloadTabId = null;
      sessionPromptResolve = null;
      resolve();
    }
  });
}

function requireLogin(sessionText = "Mở trang chấm công và đăng nhập.") {
  sessionLine.textContent = sessionText;
  showBanner(loginMessage(whitelistEntries));
  setSessionReady(false);
  if (!typesLoaded) resetTypeSelect("Đăng nhập để tải danh sách");
}

async function activeTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ?? null;
  } catch {
    return null;
  }
}

async function callPage(tabId, request, func = runInPage) {
  let injected;
  try {
    injected = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func,
      args: [request],
    });
  } catch (error) {
    return {
      ok: false,
      error: "inject",
      message: error && error.message ? error.message : "Không chạy được trên tab này.",
    };
  }
  return injected?.[0]?.result ?? { ok: false, error: "inject", message: "Trang không trả kết quả." };
}

function isAuthFailure(result) {
  return Boolean(
    result &&
      result.ok === false &&
      (result.error === "session-expired" || result.error === "missing-token" || result.status === 401),
  );
}

function resetTypeSelect(label) {
  typeSelect.replaceChildren();
  const option = document.createElement("option");
  option.value = "";
  option.textContent = label;
  typeSelect.append(option);
  typesLoaded = false;
  applyFormLock();
}

function fillTypes(typeOfWorks) {
  const previous = typeSelect.value;
  typeSelect.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Chọn loại công việc";
  typeSelect.append(placeholder);

  const seen = new Set();
  const sorted = [...typeOfWorks].sort((a, b) => Number(a.id) - Number(b.id));
  for (const item of sorted) {
    if (item == null || item.id == null || seen.has(String(item.id))) continue;
    seen.add(String(item.id));
    const option = document.createElement("option");
    option.value = String(item.id);
    const name = typeof item.name === "string" ? item.name.trim() : "";
    option.textContent = name || `Không tên (#${item.id})`;
    typeSelect.append(option);
  }
  if ([...typeSelect.options].some((option) => option.value === previous)) {
    typeSelect.value = previous;
  }
  typesLoaded = typeSelect.options.length > 1;
  applyFormLock();
}

async function loadTypes(tab, generation, user) {
  resetTypeSelect("Đang tải loại công việc…");
  typeSelect.disabled = true;
  const result = await callPage(tab.id, { action: "typeOfWork" });
  if (generation !== contextGeneration) return;
  typeSelect.disabled = false;
  if (result.error === "session-expired" || result.status === 401) {
    await promptSessionExpired(tab);
    return;
  }
  if (!result.ok) {
    resetTypeSelect(result.error === "missing-token" ? "Đăng nhập để tải danh sách" : "Không tải được — bấm Tải lại");
    if (result.error === "missing-token") {
      requireLogin("Bạn chưa đăng nhập.");
      return;
    }
    showBanner(apiError("Không tải được danh sách loại công việc", result));
    setSessionReady(false);
    return;
  }
  const list = result.data && result.data.typeOfWorks;
  if (!Array.isArray(list) || list.length === 0) {
    resetTypeSelect("Không có loại công việc");
    showBanner("Không thấy loại công việc nào.");
    setSessionReady(false);
    return;
  }
  fillTypes(list);
  if (!typesLoaded) {
    showBanner("Không thấy loại công việc nào.");
    setSessionReady(false);
    return;
  }
  setSessionReady(true);
  hideBanner();
  noteHealthySession();
  await loadAllocations(tab, user, generation);
}

const ATTENDANCE_BUCKETS = [
  { key: "full", className: "full", title: "Đủ 8 tiếng trở lên" },
  { key: "mid", className: "mid", title: "Từ 6 đến dưới 8 tiếng" },
  { key: "short", className: "short", title: "Dưới 6 tiếng" },
  { key: "absent", className: "absent", title: "Không có mặt" },
];

const WEEKDAY_SHORT = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

function denyAccess(account) {
  stopCheckoutCountdown();
  logwork.hidden = true;
  peoplePanel.hidden = true;
  if (allocationsPanel) allocationsPanel.hidden = true;
  setSessionReady(false);
  sessionLine.textContent = account ? `${account} — không có quyền` : "Không có quyền";
  hideFormError();
  showBanner(ACCESS_DENIED_MESSAGE);
}

function showSurface(surface) {
  const people = surface === "people";
  const timesheet = surface === "timesheet";
  if (!people) stopCheckoutCountdown();
  logwork.hidden = !timesheet;
  peoplePanel.hidden = !people;
  if (people) {
    eyebrow.textContent = "Zoho People";
    title.textContent = "Log attendance in one click";
  } else if (timesheet) {
    eyebrow.textContent = "SRA";
    title.textContent = "Log work in one click";
  } else {
    eyebrow.textContent = "SmartOSC";
    title.textContent = "One Click";
  }
}

function setPeopleStatus(message) {
  if (!message) {
    peopleStatus.hidden = true;
    peopleStatus.textContent = "";
    return;
  }
  peopleStatus.hidden = false;
  peopleStatus.textContent = message;
}

function weekdayShort(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return WEEKDAY_SHORT[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

function attendanceLabel(row, withHours) {
  const [, month, day] = row.date.split("-");
  const date = `${weekdayShort(row.date)} ${day}/${month}`;
  if (!withHours || !row.hours || row.hours === "00:00") return date;
  return `${date} · ${row.hours}`;
}

function stopCheckoutCountdown() {
  if (checkoutTimer == null) return;
  clearInterval(checkoutTimer);
  checkoutTimer = null;
}

function hideTodayAnnounce() {
  stopCheckoutCountdown();
  peopleAnnounce.hidden = true;
  peopleAnnounce.replaceChildren();
}

function renderTodayAnnounce(summary) {
  stopCheckoutCountdown();
  const today = findTodayRecord(summary, todayIso());
  if (!shouldShowEarliestCheckout(today)) {
    hideTodayAnnounce();
    return;
  }
  const when = attendanceLabel(today, false);
  const checkout = earliestFullCheckout(today.checkIn);
  peopleAnnounce.hidden = false;
  peopleAnnounce.replaceChildren();
  if (today.checkIn && checkout) {
    const title = document.createElement("p");
    title.className = "announce-title";
    title.append("Hôm nay đã vào lúc ");
    const inTime = document.createElement("strong");
    inTime.textContent = today.checkIn;
    title.append(inTime);

    const detail = document.createElement("p");
    detail.className = "announce-detail";
    detail.append("Checkout sớm nhất ");
    const outTime = document.createElement("strong");
    outTime.textContent = checkout;
    detail.append(outTime, " để đủ 8 tiếng");

    const label = document.createElement("p");
    label.className = "announce-label";
    const clock = document.createElement("p");
    clock.className = "announce-clock";
    clock.setAttribute("aria-hidden", "true");

    const tick = () => {
      if (!shouldShowEarliestCheckout(today)) {
        hideTodayAnnounce();
        return;
      }
      const remaining = remainingMsUntilCheckout(today.checkIn);
      if (remaining == null || remaining <= 0) {
        label.textContent = "";
        clock.textContent = "";
        stopCheckoutCountdown();
        return;
      }
      label.textContent = "Còn lại đến giờ checkout";
      clock.textContent = formatCountdown(remaining);
      clock.classList.remove("done");
    };
    tick();
    if (!peopleAnnounce.hidden && checkoutTimer == null && remainingMsUntilCheckout(today.checkIn) > 0) {
      checkoutTimer = setInterval(tick, 1000);
    }
    if (!peopleAnnounce.hidden) peopleAnnounce.append(title, detail, label, clock);
    return;
  }
  const title = document.createElement("p");
  title.className = "announce-title";
  title.textContent = `${when}: chưa có giờ vào.`;
  peopleAnnounce.append(title);
}

function renderBucket(spec, rows) {
  const section = document.createElement("section");
  section.className = `bucket ${spec.className}`;
  const header = document.createElement("header");
  const heading = document.createElement("h2");
  heading.textContent = spec.title;
  const count = document.createElement("span");
  count.className = "count";
  count.textContent = String(rows.length);
  header.append(heading, count);
  section.append(header);
  if (rows.length === 0) {
    const emptyLine = document.createElement("p");
    emptyLine.className = "empty-line";
    emptyLine.textContent = "Không có ngày nào.";
    section.append(emptyLine);
    return section;
  }
  if (spec.key === "mid" || spec.key === "short") {
    section.append(renderDayRows(rows, "Log Attendance", spec.key));
    return section;
  }
  if (spec.key === "absent") {
    section.append(renderDayRows(rows, "Log work from home", spec.key));
    return section;
  }
  const list = document.createElement("ul");
  for (const row of rows) {
    const item = document.createElement("li");
    item.textContent = attendanceLabel(row, true);
    if (row.request) {
      item.classList.add(`has-${row.request.status}`);
      item.append(document.createTextNode(" "), statusBadge(row.request));
    }
    list.append(item);
  }
  section.append(list);
  return section;
}

function isRequested(row) {
  return Boolean(row && row.request && row.request.status !== "rejected");
}

function statusBadge(request) {
  const badge = document.createElement("span");
  badge.className = `status-badge ${request.status}`;
  badge.textContent = request.label;
  const detail = [request.from && request.to ? `${request.from}–${request.to}` : "", request.desc].filter(Boolean);
  if (detail.length > 0) badge.title = detail.join(" · ");
  return badge;
}

function renderDayRows(rows, actionLabel, bucketKey) {
  const workFromHome = actionLabel === "Log work from home";
  const detailed = !workFromHome;
  const list = document.createElement("ul");
  list.className = "day-rows compact";
  const cell = (className, text) => {
    const span = document.createElement("span");
    span.className = `cell ${className}`;
    span.textContent = text;
    return span;
  };
  if (detailed) {
    const head = document.createElement("li");
    head.className = "day-row compact-row head";
    head.setAttribute("aria-hidden", "true");
    head.append(
      cell("cell-date", "Ngày"),
      cell("cell-in", "Vào"),
      cell("cell-out", "Ra"),
      cell("cell-hours-head", "Tổng"),
    );
    list.append(head);
  }
  for (const row of rows) {
    const item = document.createElement("li");
    item.className = detailed ? "day-row compact-row" : "day-row compact-row absent-row";
    item.dataset.date = row.date;
    if (row.request) item.classList.add(`has-${row.request.status}`);
    item.append(cell("cell-date", attendanceLabel(row, false)));
    if (detailed) {
      item.append(
        cell("cell-in", row.checkIn || "—"),
        cell("cell-out", row.checkOut || "—"),
        cell("cell-hours", row.hours || "00:00"),
      );
    }
    if (isRequested(row)) {
      item.append(statusBadge(row.request));
      list.append(item);
      continue;
    }
    if (row.request) item.append(statusBadge(row.request));
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.date = row.date;
    button.dataset.bucket = bucketKey || "";
    button.textContent = actionLabel;
    peopleDayButtons.set(row.date, button);
    button.addEventListener("click", () => {
      logAttendanceDay(button, row, workFromHome ? "WFH" : "Attendance");
    });
    item.append(button);
    if (loggedDates.has(row.date)) markDayLogged(row.date);
    list.append(item);
  }
  return list;
}

function successIcon() {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("width", "16");
  icon.setAttribute("height", "16");
  icon.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", "currentColor");
  path.setAttribute("d", "M6.2 11.6 2.8 8.2l1.2-1.2 2.2 2.2 5-5.2 1.2 1.2z");
  icon.append(path);
  return icon;
}

function setPeopleLogBusy(busy, activeButton) {
  peopleLogging = busy;
  for (const dayButton of peopleDayButtons.values()) {
    if (dayButton.classList.contains("logged")) continue;
    dayButton.disabled = busy;
  }
  if (!logAllButton.classList.contains("logged")) {
    logAllButton.disabled = busy;
  }
  if (!activeButton) return;
  if (busy) {
    activeButton.disabled = true;
    activeButton.setAttribute("aria-busy", "true");
  } else {
    activeButton.removeAttribute("aria-busy");
  }
}

function markLogged(button) {
  button.disabled = true;
  button.classList.add("logged");
  button.setAttribute("aria-label", "Đã log");
  button.replaceChildren(successIcon());
}

function markDayLogged(date) {
  loggedDates.add(date);
  const button = peopleDayButtons.get(date);
  if (button && !button.classList.contains("logged")) markLogged(button);
  const row = peopleBuckets.querySelector(`li[data-date="${date}"]`);
  if (!row) return;
  row.classList.add("logged-row");
  if (!row.querySelector(".logged-label")) {
    const label = document.createElement("p");
    label.className = "logged-label";
    label.append(successIcon(), document.createTextNode(" Đã log"));
    row.append(label);
  }
}

async function logAttendanceDay(button, row, desc) {
  if (button.disabled || peopleLogging || loggedDates.has(row.date)) return;
  if (peopleSourceTabId == null) return;
  const payload = buildAttendanceLog({ isoDate: row.date, erecno: peopleErecno, desc });
  if (!payload) {
    showBanner("Không thấy mã nhân viên để log.");
    return;
  }
  const label = button.textContent;
  setPeopleLogBusy(true, button);
  button.textContent = "Đang log…";
  try {
    const result = await callPage(peopleSourceTabId, { action: "log", ...payload }, runInZohoPage);
    if (!result.ok) {
      button.textContent = label;
      showBanner(result.message || "Không log được. Hãy thử lại.");
      return;
    }
    hideBanner();
    await refreshContext({ resetPeople: true });
  } finally {
    if (peopleLogging) setPeopleLogBusy(false, button);
  }
}

function unloggedRows(rows) {
  return (rows || []).filter((row) => !loggedDates.has(row.date) && !isRequested(row));
}

function logAllCandidates() {
  if (!peopleAttendance) return [];
  return selectDaysToLog({
    absent: unloggedRows(peopleAttendance.absent),
    short: unloggedRows(peopleAttendance.short),
    mid: unloggedRows(peopleAttendance.mid),
  });
}

/**
 * 6-8 hour days only need logging while more than MAX_PARTIAL_DAYS of them are
 * still unlogged. Once the count drops to the limit, hide the remaining buttons.
 */
function refreshMidButtons() {
  const remaining = peopleAttendance ? unloggedRows(peopleAttendance.mid).length : 0;
  const hide = remaining <= MAX_PARTIAL_DAYS;
  for (const button of peopleDayButtons.values()) {
    if (button.dataset.bucket !== "mid" || button.classList.contains("logged")) continue;
    button.hidden = hide;
  }
}

async function logAllAttendance() {
  if (logAllButton.disabled || peopleLogging || !peopleAttendance) return;
  const days = logAllCandidates();
  if (days.length === 0) return;
  if (peopleSourceTabId == null) return;
  const payload = buildAttendanceLogs({
    isoDates: days.map((row) => row.date),
    erecno: peopleErecno,
  });
  if (!payload) {
    showBanner("Không có ngày cần log.");
    return;
  }
  setPeopleLogBusy(true, logAllButton);
  logAllButton.textContent = "Đang log…";
  try {
    const result = await callPage(peopleSourceTabId, { action: "log", ...payload }, runInZohoPage);
    if (!result.ok) {
      logAllButton.textContent = "Log all";
      showBanner(result.message || "Không log được. Hãy thử lại.");
      return;
    }
    hideBanner();
    await refreshContext({ resetPeople: true });
  } finally {
    if (peopleLogging) setPeopleLogBusy(false, logAllButton);
  }
}

function refreshLogAllButton() {
  refreshMidButtons();
  const pending = logAllCandidates();
  if (pending.length === 0 || logAllButton.classList.contains("logged")) {
    if (!logAllButton.classList.contains("logged")) logAllButton.hidden = true;
    return;
  }
  logAllButton.hidden = false;
  logAllButton.disabled = false;
  logAllButton.textContent = "Log all";
}

function renderAttendance(view, report, period, requests = []) {
  const summary = summarizeAttendance(view, todayIso());
  const statusByDate = indexRequestStatus(requests || []);
  const requestCounts = applyRequestStatus(summary, statusByDate, period);
  peopleAttendance = summary;
  peopleDayButtons.clear();
  logAllButton.classList.remove("logged");
  logAllButton.removeAttribute("aria-label");
  renderTodayAnnounce(summary);
  const heading = readReportHeading(report);
  const name = heading?.name || (view.userDetails && view.userDetails.fName) || "Zoho People";
  const recordNo =
    peopleErecno ||
    (view && view.userDetails && (view.userDetails.eNo || view.userDetails.erecno)) ||
    (report && report.monthDetails && report.monthDetails.eno) ||
    "";
  peopleErecno = recordNo == null ? "" : String(recordNo);
  sessionLine.textContent = name;

  peopleSummary.replaceChildren();
  const totals = document.createElement("p");
  const parts = [];
  if (period) parts.push(`${formatVi(period.fromIso)} – ${formatVi(period.toIso)}`);
  const present = summary.full.length + summary.mid.length + summary.short.length;
  parts.push(`${present} ngày có mặt`);
  parts.push(`${summary.absent.length} ngày không có mặt`);
  parts.push(`${summary.holiday.length} ngày lễ`);
  parts.push(`${summary.paidLeave.length} ngày nghỉ phép`);
  totals.textContent = parts.join(" · ");
  peopleSummary.hidden = !totals.textContent;
  if (totals.textContent) peopleSummary.append(totals);
  if (summary.holiday.length > 0) {
    const holidayLine = document.createElement("p");
    holidayLine.className = "note";
    holidayLine.textContent = `Ngày lễ: ${summary.holiday.map((row) => attendanceLabel(row, false)).join(", ")}`;
    peopleSummary.append(holidayLine);
  }
  if (summary.paidLeave.length > 0) {
    const leaveLine = document.createElement("p");
    leaveLine.className = "note";
    leaveLine.textContent = `Nghỉ phép: ${summary.paidLeave.map((row) => attendanceLabel(row, false)).join(", ")}`;
    peopleSummary.append(leaveLine);
  }
  const statusParts = [];
  if (requestCounts.pending > 0) statusParts.push(`${requestCounts.pending} chờ duyệt`);
  if (requestCounts.approved > 0) statusParts.push(`${requestCounts.approved} đã duyệt`);
  if (requestCounts.rejected > 0) statusParts.push(`${requestCounts.rejected} từ chối`);
  if (statusParts.length > 0) {
    const statusLine = document.createElement("p");
    statusLine.className = "note status-line";
    statusLine.textContent = `Yêu cầu đã log: ${statusParts.join(" · ")}`;
    peopleSummary.append(statusLine);
    for (const status of ["pending", "rejected"]) {
      if (requestCounts.dates[status].length === 0) continue;
      const line = document.createElement("p");
      line.className = `note status-dates ${status}`;
      const label = status === "pending" ? "Chờ duyệt" : "Từ chối";
      line.textContent = `${label}: ${requestCounts.dates[status].map((date) => attendanceLabel({ date }, false)).join(", ")}`;
      peopleSummary.append(line);
    }
  }

  peopleBuckets.replaceChildren();
  for (const spec of ATTENDANCE_BUCKETS) {
    peopleBuckets.append(renderBucket(spec, summary[spec.key]));
  }

  refreshLogAllButton();
}

function resetPeopleState() {
  loggedDates.clear();
  peopleAttendance = null;
  peopleErecno = "";
  peopleLogging = false;
  peopleDayButtons.clear();
  logAllButton.hidden = true;
  logAllButton.classList.remove("logged");
  logAllButton.removeAttribute("aria-label");
  logAllButton.textContent = "Log all";
  peopleSummary.hidden = true;
  stopCheckoutCountdown();
  peopleAnnounce.hidden = true;
  peopleAnnounce.replaceChildren();
  peopleBuckets.replaceChildren();
}

async function refreshPeople(tab, generation, { reset = false } = {}) {
  peopleSourceTabId = tab && tab.id != null ? tab.id : null;
  hideBanner();
  hideFormError();
  if (!peopleMonthInput.value) peopleMonthInput.value = defaultAttendanceMonth(todayIso()) || currentMonth();
  const period = attendancePeriod(peopleMonthInput.value);
  if (!period) {
    setPeopleStatus("Tháng không hợp lệ.");
    return;
  }
  if (!reset && peopleAttendance) {
    for (const date of loggedDates) markDayLogged(date);
    refreshLogAllButton();
    return;
  }
  if (tab && tab.status === "loading") {
    sessionLine.textContent = "Trang đang tải.";
    setPeopleStatus("Trang đang tải. Đợi một chút rồi bấm Tải lại.");
    return;
  }

  setPeopleStatus("Đang tải chấm công…");
  resetPeopleState();
  peopleMonthInput.disabled = true;
  let result = { ok: false, message: "Chưa mở Zoho People." };
  if (tab && tab.id != null) {
    result = await callPage(
      tab.id,
      {
        action: "month",
        fromDate: period.fromDate,
        toDate: period.toDate,
        statusQueries: requestStatusQueries(period),
      },
      runInZohoPage,
    );
  }
  peopleMonthInput.disabled = false;
  if (generation !== contextGeneration || running) return;

  if (!result.ok) {
    const message = result.message || "Không tải được chấm công. Hãy đăng nhập Zoho People rồi bấm Tải lại.";
    sessionLine.textContent = "Không tải được chấm công.";
    setPeopleStatus(message);
    return;
  }
  const access = accessFromOrgUser(result.orgUser, allowedAccounts);
  if (!result.orgUser || !access.ok) {
    denyAccess(access.account);
    setPeopleStatus(result.orgUser ? ACCESS_DENIED_MESSAGE : result.orgUserError || "Không kiểm tra được quyền truy cập.");
    return;
  }
  if (!result.view || !result.view.regDetails) {
    setPeopleStatus("API không trả dữ liệu kỳ này. Hãy thử tháng khác hoặc bấm Tải lại.");
    return;
  }

  setPeopleStatus("");
  hideBanner();
  peopleErecno = result.erecno ? String(result.erecno) : "";
  renderAttendance(result.view, result.report, period, result.requests || []);
  for (const message of [result.reportError, result.requestsError]) {
    if (!message) continue;
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent = message;
    peopleBuckets.append(note);
  }
}

async function refreshContext({ forceTypes = false, resetPeople = false } = {}) {
  if (running) return;
  const generation = ++contextGeneration;
  if (forceTypes) typesLoaded = false;

  const tab = await activeTab();
  if (generation !== contextGeneration) return;

  whitelistEntries = await loadWhitelist({ force: forceTypes });
  allowedAccounts = await loadAllowedAccounts({ force: forceTypes });
  if (generation !== contextGeneration) return;

  const surface = detectSurface(tab && tab.url, whitelistEntries);
  showSurface(surface);

  if (surface === "people") {
    hideAllocations();
    await refreshPeople(tab, generation, { reset: resetPeople });
    return;
  }

  if (surface !== "timesheet") {
    hideAllocations();
    sessionLine.textContent = "Trang này không được hỗ trợ.";
    hideFormError();
    showBanner(unsupportedMessage(whitelistEntries));
    setSessionReady(false);
    if (!typesLoaded) resetTypeSelect("Đăng nhập để tải danh sách");
    return;
  }

  if (tab.status === "loading") {
    sessionLine.textContent = "Trang đang tải.";
    showBanner("Trang đang tải. Đợi một chút rồi bấm Tải lại.");
    setSessionReady(false);
    return;
  }

  const session = await callPage(tab.id, { action: "session" });
  if (generation !== contextGeneration || running) return;

  if (!session.ok && session.error === "inject") {
    sessionLine.textContent = "Không đọc được trang này.";
    showBanner(`Không đọc được trang này. Hãy tải lại trang SRA. ${session.message}`);
    setSessionReady(false);
    return;
  }

  if (!session.ok && isAuthFailure(session)) {
    await promptSessionExpired(tab);
    return;
  }

  if (!session.hasToken) {
    requireLogin("Bạn chưa đăng nhập.");
    return;
  }

  if (session.expired) {
    await promptSessionExpired(tab);
    return;
  }

  const user = session.user;
  if (!user?.username || user.id == null) {
    sessionLine.textContent = user?.username ? user.username : "Chưa rõ tài khoản.";
    showBanner("Không lấy được thông tin tài khoản. Hãy đăng nhập lại.");
    setSessionReady(false);
    if (!typesLoaded) resetTypeSelect("Chưa rõ tài khoản");
    return;
  }

  const access = canAccess({
    account: user.username,
    deptNameList: deptNameListFromUser(user),
    allowedAccounts,
  });
  if (!access.ok) {
    denyAccess(access.account || user.username);
    if (!typesLoaded) resetTypeSelect("Không có quyền");
    return;
  }

  sessionLine.textContent = user.name ? `${user.name} (${user.username})` : user.username;

  if (!typesLoaded) {
    await loadTypes(tab, generation, user);
    return;
  }
  setSessionReady(true);
  hideBanner();
  noteHealthySession();
  await loadAllocations(tab, user, generation);
}

function missingFields() {
  const missing = [];
  if (!monthInput.value) missing.push("tháng");
  if (!typeSelect.value) missing.push("loại công việc");
  return missing;
}

function apiError(prefix, result) {
  if (result.error === "session-expired" || result.status === 401) return SESSION_EXPIRED_MESSAGE;
  if (result.error === "missing-token") return loginMessage(whitelistEntries);
  if (result.message && !/^HTTP \d+$/.test(result.message)) return `${prefix}. ${result.message}`;
  return `${prefix}. Hãy thử lại.`;
}

function normalizeDate(value) {
  if (typeof value !== "string") return "";
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match ? match[1] : "";
}

const WEEKDAYS = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

function formatVi(iso) {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function weekdayVi(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

function formatProject(name, code) {
  const label = typeof name === "string" ? name.trim() : "";
  const id = code == null ? "" : String(code).trim();
  if (label && id) return `${label} (${id})`;
  return label || id || "—";
}

function asPositiveHours(value) {
  const number = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(number) || number <= 0) return null;
  return number;
}

function setAllocationsStatus(message) {
  if (!allocationsStatus) return;
  if (!message) {
    allocationsStatus.hidden = true;
    allocationsStatus.textContent = "";
    return;
  }
  allocationsStatus.hidden = false;
  allocationsStatus.textContent = message;
}

function hideAllocations() {
  if (!allocationsPanel) return;
  allocationsPanel.hidden = true;
  if (allocationRows) allocationRows.replaceChildren();
  if (allocationsTableWrap) allocationsTableWrap.hidden = true;
  if (allocationsTotal) allocationsTotal.hidden = true;
  setAllocationsStatus("");
}

function formatAllocDates(dates) {
  return dates.map((iso) => {
    const [, month, day] = iso.split("-");
    return `${day}/${month}`;
  }).join(", ");
}

function renderAllocations(summary) {
  if (!allocationsPanel) return;
  allocationsPanel.hidden = false;
  allocationRows.replaceChildren();
  const groups = summary && Array.isArray(summary.groups) ? summary.groups : [];
  if (groups.length === 0) {
    allocationsTableWrap.hidden = true;
    allocationsTotal.hidden = true;
    setAllocationsStatus("Tháng này chưa có giờ allocate.");
    return;
  }
  setAllocationsStatus("");
  allocationsTableWrap.hidden = false;
  allocationsTotal.hidden = true;
  for (const group of groups) {
    for (const item of group.projects) {
      const tr = document.createElement("tr");
      const project = document.createElement("td");
      project.textContent = formatProject(item.name, item.code);
      const hours = document.createElement("td");
      hours.textContent = String(item.hours);
      tr.append(project, hours);
      allocationRows.append(tr);
    }
    const datesRow = document.createElement("tr");
    datesRow.className = "day-group";
    const datesCell = document.createElement("td");
    datesCell.colSpan = 2;
    datesCell.textContent = `Ngày: ${formatAllocDates(group.dates)}`;
    datesRow.append(datesCell);
    allocationRows.append(datesRow);
  }
}

async function loadAllocations(tab, user, generation = contextGeneration) {
  if (!allocationsPanel || !tab || !user?.username || !monthInput.value) {
    hideAllocations();
    return;
  }
  allocationsPanel.hidden = false;
  setAllocationsStatus("Đang tải allocate…");
  allocationsTableWrap.hidden = true;
  allocationsTotal.hidden = true;
  allocationRows.replaceChildren();

  const today = todayIso();
  let preview;
  try {
    preview = classifyMonthDays({ yearMonth: monthInput.value, daysOff: [], holidayDates: [], today });
  } catch {
    setAllocationsStatus("Tháng không hợp lệ.");
    return;
  }
  if (preview.startDate > today) {
    setAllocationsStatus("Tháng này chưa tới.");
    return;
  }

  const timesheet = await callPage(tab.id, {
    action: "timesheet",
    username: user.username,
    startDate: preview.startDate,
    endDate: clampToToday(preview.endDate, today),
  });
  if (generation !== contextGeneration) return;
  if (isAuthFailure(timesheet)) {
    hideAllocations();
    await promptSessionExpired(tab);
    return;
  }
  if (!timesheet.ok) {
    setAllocationsStatus(apiError("Không tải được allocate", timesheet));
    return;
  }
  const days = overviewDays(timesheet.data);
  if (!days) {
    setAllocationsStatus("Không đọc được bảng công.");
    return;
  }
  renderAllocations(summarizeAllocations(days));
}

async function refreshAllocations() {
  if (running || !sessionReady) return;
  const tab = await activeTab();
  if (!tab || !isTimesheetUrl(tab.url)) {
    hideAllocations();
    return;
  }
  const session = await callPage(tab.id, { action: "session" });
  if (!session || !session.ok || !session.user) return;
  await loadAllocations(tab, session.user);
}

function overviewDays(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.timesheetOverview)) return data.timesheetOverview;
  return null;
}

function indexOverview(days) {
  const byDate = new Map();
  const holidayDates = [];
  for (const day of days) {
    const iso = normalizeDate(day && day.date);
    if (!iso) continue;
    byDate.set(iso, day);
    if (day.isHoliday === true) holidayDates.push(iso);
  }
  return { byDate, holidayDates };
}

function ensureDateGroup(date) {
  const exists = [...rows.children].some(
    (tr) => tr.classList.contains("day-group") && tr.dataset.date === date,
  );
  if (exists) return;
  const tr = document.createElement("tr");
  tr.className = "day-group";
  tr.dataset.date = date;
  const cell = document.createElement("td");
  cell.colSpan = 4;
  cell.textContent = `${formatVi(date)} (${weekdayVi(date)})`;
  tr.append(cell);
  rows.append(tr);
}

function appendRow({ date, project, hours, result, detail, code = "", posted = false }) {
  ensureDateGroup(date);
  const tr = document.createElement("tr");
  tr.className = result === "success" ? "success" : "fail";
  tr.dataset.date = date;
  if (code) tr.dataset.code = code;
  if (posted) tr.dataset.posted = "true";

  const projectCell = document.createElement("td");
  projectCell.textContent = project || "—";

  const hoursCell = document.createElement("td");
  hoursCell.textContent = hours == null || hours === "" ? "—" : String(hours);

  const resultCell = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = `badge ${result === "success" ? "success" : "fail"}`;
  badge.textContent = result === "success" ? "Xong" : "Lỗi";
  resultCell.append(badge);

  const detailCell = document.createElement("td");
  detailCell.textContent = detail || "";

  tr.append(projectCell, hoursCell, resultCell, detailCell);
  rows.append(tr);
  tableWrap.hidden = false;
  empty.hidden = true;
  tr.scrollIntoView({ block: "nearest" });
  return tr;
}

function setRowState(tr, result, detail) {
  tr.className = result === "success" ? "success" : "fail";
  const badge = tr.querySelector(".badge");
  badge.className = `badge ${result === "success" ? "success" : "fail"}`;
  badge.textContent = result === "success" ? "Xong" : "Lỗi";
  tr.lastElementChild.textContent = detail || "";
}

function postedRowsFor(date) {
  return [...rows.children].filter((tr) => tr.dataset.date === date && tr.dataset.posted === "true");
}

function countResults() {
  let success = 0;
  let fail = 0;
  for (const badge of rows.querySelectorAll(".badge")) {
    if (badge.classList.contains("success")) success += 1;
    else fail += 1;
  }
  return { success, fail };
}

function renderSummary(plan) {
  summary.hidden = false;
  summary.replaceChildren();
  const line = document.createElement("p");
  const text = document.createElement("span");
  text.append("Bỏ qua ");
  text.append(strong(`${plan.counts.weekend} ngày cuối tuần`));
  text.append(", ");
  text.append(strong(`${plan.counts.daysOff} ngày off`));
  text.append(", ");
  text.append(strong(`${plan.counts.holiday} ngày lễ`));
  if (plan.counts.future > 0) {
    text.append(", ");
    text.append(strong(`${plan.counts.future} ngày tương lai`));
  }
  text.append(`. Còn ${plan.counts.eligible} ngày làm việc.`);
  line.append(text);
  summary.append(line);

  if (plan.ignoredDaysOff.length > 0) {
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = `Ngày off ngoài tháng này không được tính: ${plan.ignoredDaysOff.join(", ")}.`;
    summary.append(note);
  }
}

function strong(value) {
  const node = document.createElement("strong");
  node.textContent = value;
  return node;
}

async function ensureSession(tab) {
  if (!tab || !isTimesheetUrl(tab.url)) {
    requireLogin();
    return null;
  }
  const session = await callPage(tab.id, { action: "session" });
  if (!session || session.ok === false) {
    if (session && isAuthFailure(session)) {
      await promptSessionExpired(tab);
      return null;
    }
    showBanner(session?.message || "Không đọc được phiên đăng nhập. Hãy tải lại trang.");
    setSessionReady(false);
    return null;
  }
  if (session.expired) {
    await promptSessionExpired(tab);
    return null;
  }
  if (!session.hasToken) {
    requireLogin("Bạn chưa đăng nhập.");
    return null;
  }
  if (!session.user?.username || session.user.id == null) {
    showBanner("Không lấy được thông tin tài khoản. Hãy đăng nhập lại.");
    setSessionReady(false);
    return null;
  }
  const access = canAccess({
    account: session.user.username,
    deptNameList: deptNameListFromUser(session.user),
    allowedAccounts,
  });
  if (!access.ok) {
    denyAccess(access.account || session.user.username);
    return null;
  }
  return session;
}

async function logWork() {
  if (running) return;
  hideFormError();

  if (!sessionReady) {
    showBanner(loginMessage(whitelistEntries));
    return;
  }

  const missing = missingFields();
  if (missing.length > 0) {
    showFormError(`Hãy chọn ${missing.join(" và ")} trước khi log work.`);
    if (!monthInput.value) monthInput.focus();
    else if (!typeSelect.value) typeSelect.focus();
    return;
  }

  const typeOfWork = Number(typeSelect.value);
  if (!Number.isFinite(typeOfWork)) {
    showFormError("Loại công việc không hợp lệ.");
    typeSelect.focus();
    return;
  }

  const today = todayIso();
  const description = descriptionInput.value.trim();
  const daysOff = collectDaysOff();
  let preview;
  try {
    preview = classifyMonthDays({ yearMonth: monthInput.value, daysOff, holidayDates: [], today });
  } catch (error) {
    showFormError(error.message || "Tháng không hợp lệ.");
    monthInput.focus();
    return;
  }

  setRunning(true);
  rows.replaceChildren();
  summary.hidden = true;
  summary.replaceChildren();
  tableWrap.hidden = true;
  empty.hidden = true;
  setStatus("Đang tải bảng công…");
  hideBanner();

  let successCount = 0;
  let failCount = 0;
  let skippedLogged = 0;
  const postedDates = [];
  const blocked = [];

  try {
    whitelistEntries = await loadWhitelist();
    const tab = await activeTab();
    const session = await ensureSession(tab);
    if (!session) return;

    if (preview.startDate > today) {
      showBanner("Tháng này chưa tới. Hãy chọn tháng này hoặc một tháng đã qua.");
      setStatus("");
      setEmpty("Không có ngày để log work", "Chọn tháng này hoặc một tháng đã qua.");
      return;
    }

    const rangeStart = preview.startDate;
    const rangeEnd = clampToToday(preview.endDate, today);
    const user = session.user;
    setStatus(`Đang tải bảng công đến ${formatVi(rangeEnd)}…`);

    const timesheet = await callPage(tab.id, {
      action: "timesheet",
      username: user.username,
      startDate: rangeStart,
      endDate: rangeEnd,
    });

    if (isAuthFailure(timesheet)) {
      await promptSessionExpired(tab);
      setEmpty("Chưa có kết quả", SESSION_EXPIRED_MESSAGE);
      return;
    }

    if (!timesheet.ok) {
      showBanner(apiError("Không tải được bảng công", timesheet));
      setStatus("");
      setEmpty("Chưa có kết quả", "Bảng công chưa tải được. Xem thông báo phía trên rồi thử lại.");
      return;
    }

    const overview = overviewDays(timesheet.data);
    if (!overview) {
      showBanner("Không đọc được bảng công.");
      setStatus("");
      setEmpty("Chưa có kết quả", "Bảng công không có danh sách ngày.");
      return;
    }

    noteHealthySession();
    const { byDate, holidayDates } = indexOverview(overview);
    const plan = classifyMonthDays({
      yearMonth: monthInput.value,
      daysOff,
      holidayDates,
      today,
    });
    renderSummary(plan);

    for (const date of plan.eligible) {
      setStatus(`Đang log work ${formatVi(date)}…`);
      const outcome = await logDate({
        tab,
        user,
        date,
        day: byDate.get(date),
        description,
        typeOfWork,
        today,
      });
      if (outcome === "stopped") return;
      successCount += outcome.success;
      failCount += outcome.fail;
      if (outcome.skippedLogged) skippedLogged += 1;
      if (outcome.posted) postedDates.push(date);
      if (outcome.note) blocked.push(`${formatVi(date)}: ${outcome.note}`);
    }

    const verifyResult = await verifyOverview({
      tab,
      username: user.username,
      startDate: rangeStart,
      endDate: rangeEnd,
      postedDates,
    });
    if (verifyResult === "stopped") return;
    if (verifyResult === "ok") {
      const totals = countResults();
      successCount = totals.success;
      failCount = totals.fail;
    }

    if (skippedLogged > 0) {
      const note = document.createElement("p");
      note.className = "note";
      note.textContent = `${skippedLogged} ngày đã có worklog.`;
      summary.append(note);
    }
    if (blocked.length > 0) {
      const note = document.createElement("p");
      note.className = "note";
      note.textContent = `Chưa log work được: ${blocked.join("; ")}.`;
      summary.append(note);
    }

    if (rows.children.length === 0) {
      setEmpty(
        skippedLogged > 0 ? "Không cần log work thêm" : "Không có ngày cần log work",
        skippedLogged > 0
          ? `${skippedLogged} ngày đã có worklog.`
          : "Các ngày còn lại là cuối tuần, ngày nghỉ hoặc ngày lễ.",
      );
    }

    const parts = [
      successCount === 0 && failCount === 0
        ? "Xong. Không có worklog mới."
        : `Xong. Đã log work ${successCount}, chưa log work được ${failCount}.`,
    ];
    if (skippedLogged > 0) parts.push(`Bỏ qua ${skippedLogged} ngày đã có worklog.`);
    if (verifyResult === "ok") {
      parts.push(`Đã kiểm tra lại từ ${formatVi(rangeStart)} đến ${formatVi(rangeEnd)}.`);
    } else {
      parts.push("Chưa kiểm tra lại được kết quả.");
    }
    setStatus(parts.join(" "));
  } catch (error) {
    showBanner(error && error.message ? error.message : "Không log work được. Hãy thử lại.");
    setStatus("");
  } finally {
    setRunning(false);
  }
}

async function verifyOverview({ tab, username, startDate, endDate, postedDates }) {
  setStatus(`Đang kiểm tra lại từ ${formatVi(startDate)} đến ${formatVi(endDate)}…`);
  const verified = await callPage(tab.id, {
    action: "timesheet",
    username,
    startDate,
    endDate,
  });
  if (isAuthFailure(verified)) {
    await promptSessionExpired(tab);
    return "stopped";
  }
  if (!verified.ok) {
    showBanner(apiError("Chưa kiểm tra lại được kết quả", verified));
    return "failed";
  }
  const days = overviewDays(verified.data);
  if (!days) {
    showBanner("Không đọc được worklog vừa tạo.");
    return "failed";
  }
  const { byDate } = indexOverview(days);
  for (const date of postedDates) applyVerifiedDay(date, byDate.get(date));
  return "ok";
}

function applyVerifiedDay(date, day) {
  const list = postedRowsFor(date);
  if (!day || !hasWorkLogs(day)) {
    for (const tr of list) {
      const previous = tr.lastElementChild.textContent.trim();
      const detail = previous
        ? `Đã gửi nhưng chưa thấy worklog. ${previous}`
        : "Đã gửi nhưng chưa thấy worklog.";
      setRowState(tr, "fail", detail);
    }
    return;
  }
  const compared = compareWorkLogs(day);
  if (compared.match) {
    for (const tr of list) setRowState(tr, "success", "Đã log work và số giờ khớp allocate.");
    return;
  }
  const byCode = new Map(compared.mismatches.map((item) => [item.code, item]));
  for (const tr of list) {
    const item = byCode.get(tr.dataset.code || "");
    if (item) setRowState(tr, "fail", mismatchMessage(item));
    else setRowState(tr, "success", "Đã log work và số giờ khớp allocate.");
  }
}

async function logDate({ tab, user, date, day, description, typeOfWork, today }) {
  if (today && date > today) {
    return { success: 0, fail: 0, skippedLogged: false, posted: false, note: "" };
  }

  const quiet = { success: 0, fail: 0, skippedLogged: false, posted: false, note: "" };

  if (!day) {
    return { ...quiet, note: "Không thấy dữ liệu ngày này." };
  }

  if (hasWorkLogs(day)) {
    const compared = compareWorkLogs(day);
    if (compared.match) return { ...quiet, skippedLogged: true };
    for (const item of compared.mismatches) {
      appendRow({
        date,
        project: formatProject(item.name, item.code),
        hours: item.logged,
        result: "fail",
        detail: mismatchMessage(item),
        code: item.code,
      });
    }
    return { success: 0, fail: compared.mismatches.length, skippedLogged: false, posted: false, note: "" };
  }

  const details = Array.isArray(day.allocated && day.allocated.detail) ? day.allocated.detail : [];
  const positive = [];
  for (const detail of details) {
    const hours = asPositiveHours(detail && detail.hours);
    if (hours == null) continue;
    positive.push({
      code: detail && detail.code != null ? String(detail.code).trim() : "",
      name: detail && typeof detail.name === "string" ? detail.name : "",
      hours,
    });
  }

  if (positive.length === 0) {
    return { ...quiet, note: "Ngày này chưa được allocate giờ." };
  }

  const projectsResult = await callPage(tab.id, {
    action: "projects",
    userId: user.id,
    date,
  });
  if (isAuthFailure(projectsResult)) {
    await promptSessionExpired(tab);
    return "stopped";
  }
  if (!projectsResult.ok) {
    return { ...quiet, note: apiError("Không tải được danh sách project", projectsResult) };
  }

  const projects = Array.isArray(projectsResult.data) ? projectsResult.data : null;
  if (!projects) {
    return { ...quiet, note: "Không đọc được danh sách project." };
  }

  let success = 0;
  let fail = 0;
  let posted = false;
  const notes = [];
  for (const detail of positive) {
    const project = projects.find((item) => item && String(item.code ?? "").trim() === detail.code);
    const projectId = project ? Number(project.id) : NaN;
    if (!project || !Number.isFinite(projectId)) {
      notes.push(detail.code ? `Không tìm thấy project ${detail.code}.` : "Không tìm thấy project.");
      continue;
    }

    const postedResult = await callPage(tab.id, {
      action: "worklog",
      workLog: {
        date,
        description,
        workHours: detail.hours,
        typeOfWork,
        projectId,
      },
    });
    if (isAuthFailure(postedResult)) {
      await promptSessionExpired(tab);
      appendRow({
        date,
        project: formatProject(project.name, project.code),
        hours: detail.hours,
        result: "fail",
        detail: SESSION_EXPIRED_MESSAGE,
        code: detail.code,
      });
      return "stopped";
    }
    posted = true;
    if (!postedResult.ok) {
      appendRow({
        date,
        project: formatProject(project.name || detail.name, project.code || detail.code),
        hours: detail.hours,
        result: "fail",
        detail: apiError("Không log work được", postedResult),
        code: detail.code,
        posted: true,
      });
      fail += 1;
      continue;
    }

    appendRow({
      date,
      project: formatProject(project.name || detail.name, project.code || detail.code),
      hours: detail.hours,
      result: "success",
      detail: "",
      code: detail.code,
      posted: true,
    });
    success += 1;
  }

  return { success, fail, skippedLogged: false, posted, note: notes.join(" ") };
}
