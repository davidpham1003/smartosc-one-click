/**
 * POST Zoho People AttendanceViewAction.zp (mode=getAttList).
 * Run this on https://people.zoho.com so the browser sends the session cookies.
 * CSRF comes from the CSRF_TOKEN cookie. Do not pass cookie strings into this function.
 *
 * Portal id is the digits after "hrportal" in the open page URL, for example
 * https://people.zoho.com/hrportal1524046581683/zp → 1524046581683.
 */

const LOG_FROM_MINUTES = 9 * 60;
const LOG_TO_MINUTES = 18 * 60 + 15;
const ZOHO_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function attendancePeriod(yearMonth) {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth || "");
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const from = new Date(Date.UTC(year, month - 2, 21));
  const to = new Date(Date.UTC(year, month - 1, 20));
  const iso = (date) => {
    const day = String(date.getUTCDate()).padStart(2, "0");
    const monthNumber = String(date.getUTCMonth() + 1).padStart(2, "0");
    return `${date.getUTCFullYear()}-${monthNumber}-${day}`;
  };
  const zoho = (date) => {
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${day}-${ZOHO_MONTHS[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
  };
  return { fromDate: zoho(from), toDate: zoho(to), fromIso: iso(from), toIso: iso(to) };
}

/** Attendance month is 21–20. From the 21st, the open period belongs to next month. */
export function defaultAttendanceMonth(today) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today || "").trim());
  if (!match) return "";
  let year = Number(match[1]);
  let month = Number(match[2]);
  const day = Number(match[3]);
  if (day >= 21) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * getMyRequest queries covering every calendar month in the period.
 * Zoho returns the month after sDate/eDate when navigate=1 (that is what the
 * captured request does), so each query sends the previous month's range.
 */
export function requestStatusQueries(period) {
  if (!period || !period.fromIso || !period.toIso) return [];
  const from = /^(\d{4})-(\d{2})/.exec(period.fromIso);
  const to = /^(\d{4})-(\d{2})/.exec(period.toIso);
  if (!from || !to) return [];
  const zoho = (year, monthIndex, day) => `${String(day).padStart(2, "0")}-${ZOHO_MONTHS[monthIndex]}-${year}`;
  const queries = [];
  let year = Number(from[1]);
  let monthIndex = Number(from[2]) - 1;
  const endIndex = Number(to[1]) * 12 + (Number(to[2]) - 1);
  while (year * 12 + monthIndex <= endIndex) {
    const prev = new Date(Date.UTC(year, monthIndex - 1, 1));
    const prevYear = prev.getUTCFullYear();
    const prevMonth = prev.getUTCMonth();
    const lastDay = new Date(Date.UTC(prevYear, prevMonth + 1, 0)).getUTCDate();
    queries.push({
      sDate: zoho(prevYear, prevMonth, 1),
      eDate: zoho(prevYear, prevMonth, lastDay),
      navigate: "1",
    });
    monthIndex += 1;
    if (monthIndex > 11) {
      monthIndex = 0;
      year += 1;
    }
  }
  return queries;
}

export const MAX_PARTIAL_DAYS = 5;
export const WORKDAY_END_MINUTES = LOG_TO_MINUTES;
const FULL_DAY_MINUTES = 8 * 60;

export function zonedClockMinutes(now = new Date(), timeZone = "Asia/Ho_Chi_Minh") {
  const parts = {};
  for (const part of new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

/** Today: hide Log Attendance unless it is the 20th, or after 18:15 without 8h. Other days stay loggable. */
export function canShowAttendanceLogButton(row, { today, now } = {}) {
  if (!row || typeof row.date !== "string" || !row.date) return false;
  if (!today || row.date !== today) return true;
  const day = Number(row.date.slice(8, 10));
  if (day === 20) return true;
  const clock = zonedClockMinutes(now);
  if (clock == null) return false;
  const minutes = Number(row.minutes) || 0;
  return clock >= WORKDAY_END_MINUTES && minutes < FULL_DAY_MINUTES;
}

function zohoDateFromIso(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || "");
  if (!match) return "";
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${String(day).padStart(2, "0")}-${ZOHO_MONTHS[month - 1]}-${match[1]}`;
}

export function selectDaysToLog(summary) {
  const byDate = (a, b) => String(a.date).localeCompare(String(b.date));
  const absent = [...((summary && summary.absent) || [])].sort(byDate);
  const short = [...((summary && summary.short) || [])].sort(byDate);
  const mid = [...((summary && summary.mid) || [])].sort(byDate);
  const extraMid = mid.length > MAX_PARTIAL_DAYS ? mid.slice(0, mid.length - MAX_PARTIAL_DAYS) : [];
  return [...absent, ...short, ...extraMid].sort(byDate);
}

export function buildAttendanceLogs({ isoDates, erecno }) {
  const id = erecno == null ? "" : String(erecno).trim();
  const dates = [...new Set(isoDates || [])].filter((iso) => zohoDateFromIso(iso)).sort();
  if (!id || dates.length === 0) return null;
  const dataObj = {};
  for (const iso of dates) {
    const fdate = zohoDateFromIso(iso);
    dataObj[fdate] = {
      fromDate: fdate,
      toDate: fdate,
      ftime: LOG_FROM_MINUTES,
      ttime: LOG_TO_MINUTES,
    };
  }
  const keys = Object.keys(dataObj);
  return {
    erecno: id,
    fdate: keys[0],
    tdate: keys[keys.length - 1],
    dataObj: JSON.stringify(dataObj),
  };
}

function collectLogErrorText(data) {
  const nested = data && data.error && typeof data.error === "object" ? data.error : null;
  const values = [
    data && data.error,
    data && data.msg,
    data && data.message,
    data && data.Message,
    nested && nested.msg,
    nested && nested.message,
  ];
  return values.find((value) => typeof value === "string" && value.trim()) || "";
}

function isFailStatus(status) {
  if (status === 0 || status === "0" || status === false) return true;
  return typeof status === "string" && /^(error|failure|fail|denied|invalid)$/i.test(status.trim());
}

/**
 * bulkAttendReg returns an object when the request is created. Only treat
 * explicit error flags as failure; do not require a follow-up getMyRequest.
 */
export function interpretAttendanceLogResponse(data) {
  if (data == null || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, message: "Không đọc được kết quả log. Hãy đăng nhập Zoho People." };
  }
  const errorText = collectLogErrorText(data);
  const status = data.status ?? data.Status ?? data.result ?? data.Result;
  const successFlag = data.success ?? data.Success;
  if (successFlag === false || successFlag === "false") {
    return { ok: false, message: errorText || "Không log được. Hãy thử lại." };
  }
  if (isFailStatus(status)) {
    return { ok: false, message: errorText || "Không log được. Hãy thử lại." };
  }
  if (typeof data.error === "string" && data.error.trim()) {
    return { ok: false, message: data.error.trim() };
  }
  if (data.NODATA === true || data.NODATA === "true" || data.PERM === false || data.csrf === false) {
    return { ok: false, message: errorText || "Zoho không tạo request. Hãy thử lại." };
  }
  return { ok: true };
}

export function buildAttendanceLog({ isoDate, erecno, desc }) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || "");
  const id = erecno == null ? "" : String(erecno).trim();
  if (!match || !id) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const fdate = `${String(day).padStart(2, "0")}-${ZOHO_MONTHS[month - 1]}-${match[1]}`;
  return {
    erecno: id,
    fdate,
    dataObj: JSON.stringify({
      [fdate]: {
        fromDate: fdate,
        toDate: fdate,
        reasonanddesc: { desc: desc || "" },
        ftime: LOG_FROM_MINUTES,
        ttime: LOG_TO_MINUTES,
      },
    }),
  };
}

function readPortalId() {
  if (typeof location === "undefined") return "";
  const match = /\/hrportal(\d+)/.exec(location.pathname);
  return match ? match[1] : "";
}

function readCsrfToken() {
  if (typeof document === "undefined" || typeof document.cookie !== "string") return "";
  const match = /(?:^|;\s*)CSRF_TOKEN=([^;]*)/.exec(document.cookie);
  return match ? decodeURIComponent(match[1]) : "";
}

function fail(error, extra = {}) {
  return { ok: false, error, ...extra };
}

/**
 * @param {object} [options]
 * @param {"week"|"month"|"day"} [options.view]
 * @param {number} [options.preMonth] 0 = current period, negative = earlier
 * @param {number} [options.weekStarts] 1 = Monday
 * @param {boolean} [options.loadToday]
 */
export async function fetchAttendanceList(options = {}) {
  const portalId = readPortalId();
  const view = options.view || "week";
  const preMonth = options.preMonth == null ? 0 : options.preMonth;
  const weekStarts = options.weekStarts == null ? 1 : options.weekStarts;
  const loadToday = options.loadToday === true;
  const origin = typeof location !== "undefined" && location.origin ? location.origin : "";

  if (!portalId || !origin) {
    return fail("missing-portal", {
      message: "Không thấy portal id trên URL. Hãy mở trang Zoho People (…/hrportal…/zp) rồi gọi lại.",
    });
  }

  const csrf = readCsrfToken();
  if (!csrf) {
    return fail("missing-csrf", {
      message: "Thiếu CSRF_TOKEN. Hãy mở Zoho People và đăng nhập, rồi gọi hàm trên trang đó.",
    });
  }

  const body = new URLSearchParams({
    mode: "getAttList",
    conreqcsr: csrf,
    loadToday: String(loadToday),
    view: String(view),
    preMonth: String(preMonth),
    weekStarts: String(weekStarts),
  });

  const url = `${origin}/hrportal${portalId}/AttendanceViewAction.zp`;

  try {
    const response = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "*/*",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: body.toString(),
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!response.ok) {
      return fail("http", { status: response.status, data });
    }
    return { ok: true, status: response.status, data };
  } catch (error) {
    return fail("network", {
      message: error && error.message ? error.message : "Không kết nối được. Hãy thử lại.",
    });
  }
}

/**
 * Serialized into the Zoho People page (MAIN world). Nested helpers stay inside.
 */
export async function runInZohoPage(request) {
  function fail(error, extra = {}) {
    return { ok: false, error, ...extra };
  }

  function readPortalId() {
    const match = /\/hrportal(\d+)/.exec(location.pathname);
    return match ? match[1] : "";
  }

  function readCsrfToken() {
    const match = /(?:^|;\s*)CSRF_TOKEN=([^;]*)/.exec(document.cookie);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function interpretLogResponse(data) {
    if (data == null || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, message: "Không đọc được kết quả log. Hãy đăng nhập Zoho People." };
    }
    const nested = data.error && typeof data.error === "object" ? data.error : null;
    const errorText = [data.error, data.msg, data.message, data.Message, nested && nested.msg, nested && nested.message].find(
      (value) => typeof value === "string" && value.trim(),
    );
    const status = data.status ?? data.Status ?? data.result ?? data.Result;
    const successFlag = data.success ?? data.Success;
    const failStatus =
      status === 0 ||
      status === "0" ||
      status === false ||
      (typeof status === "string" && /^(error|failure|fail|denied|invalid)$/i.test(status.trim()));
    if (successFlag === false || successFlag === "false" || failStatus) {
      return { ok: false, message: errorText || "Không log được. Hãy thử lại." };
    }
    if (typeof data.error === "string" && data.error.trim()) {
      return { ok: false, message: data.error.trim() };
    }
    if (data.NODATA === true || data.NODATA === "true" || data.PERM === false || data.csrf === false) {
      return { ok: false, message: errorText || "Zoho không tạo request. Hãy thử lại." };
    }
    return { ok: true };
  }

  async function fetchRequestStatus(erecno, queries) {
    const requests = [];
    for (const query of queries || []) {
      if (!query || !query.sDate || !query.eDate) continue;
      const statusResult = await postForm("AttendanceAction.zp", {
        mode: "getMyRequest",
        navigate: query.navigate == null ? "1" : String(query.navigate),
        sDate: String(query.sDate),
        eDate: String(query.eDate),
        erecno: JSON.stringify([String(erecno)]),
        statFil: JSON.stringify(["-1"]),
      });
      if (statusResult.ok) requests.push(statusResult.data);
    }
    return requests;
  }

  async function postForm(actionName, fields) {
    const body = new URLSearchParams({ conreqcsr: readCsrfToken(), ...fields });
    try {
      const response = await fetch(`${location.origin}/hrportal${readPortalId()}/${actionName}`, {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "*/*",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: body.toString(),
      });
      const text = await response.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      if (!response.ok) return fail("http", { status: response.status, data });
      if (!data || typeof data !== "object") {
        return fail("session", { message: "Không đọc được chấm công. Hãy đăng nhập Zoho People." });
      }
      return { ok: true, status: response.status, data };
    } catch (error) {
      return fail("network", {
        message: error && error.message ? error.message : "Không kết nối được. Hãy thử lại.",
      });
    }
  }

  async function postLog(fields) {
    const form = new FormData();
    form.append("conreqcsr", readCsrfToken());
    form.append("erecno", fields.erecno);
    form.append("fdate", fields.fdate);
    if (fields.tdate) form.append("tdate", fields.tdate);
    form.append("dataObj", fields.dataObj);
    try {
      const response = await fetch(
        `${location.origin}/hrportal${readPortalId()}/AttendanceAction.zp?mode=bulkAttendReg`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            Accept: "*/*",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: form,
        },
      );
      const text = await response.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      if (!response.ok) return fail("http", { status: response.status, message: "Không log được. Hãy thử lại." });
      const parsed = interpretLogResponse(data);
      if (!parsed.ok) return fail("http", { message: parsed.message, data });
      return { ok: true, status: response.status, data };
    } catch (error) {
      return fail("network", {
        message: error && error.message ? error.message : "Không kết nối được. Hãy thử lại.",
      });
    }
  }

  try {
    if (!request || (request.action !== "month" && request.action !== "log")) {
      return fail("unknown-action", { message: "Thao tác không hỗ trợ." });
    }
    const portalId = readPortalId();
    if (!portalId) {
      return fail("missing-portal", {
        message: "Không thấy portal id trên URL. Hãy mở trang Zoho People (…/hrportal…/zp) rồi gọi lại.",
      });
    }
    const csrf = readCsrfToken();
    if (!csrf) {
      return fail("missing-csrf", {
        message: "Thiếu CSRF_TOKEN. Hãy đăng nhập Zoho People trên tab này.",
      });
    }
    if (request.action === "log") {
      if (!request.erecno || !request.fdate || !request.dataObj) {
        return fail("invalid", { message: "Thiếu ngày hoặc mã nhân viên." });
      }
      return postLog(request);
    }
    if (!request.fromDate || !request.toDate) {
      return fail("invalid", { message: "Thiếu khoảng ngày chấm công." });
    }
    const reportResult = await postForm("AttendanceReportAction.zp", {
      mode: "getMonthReportForUser",
      view: "month",
      preMonth: "0",
    });
    if (!reportResult.ok) return reportResult;
    const erecno = reportResult.data && reportResult.data.monthDetails && reportResult.data.monthDetails.eno;
    if (!erecno) return fail("missing-erecno", { message: "Không thấy mã nhân viên." });
    const orgUserResult = await postForm("commonAction/getOrgUserListNew", {
      isInit: "false",
      userIds: JSON.stringify([String(erecno)]),
    });
    const viewResult = await postForm("AttendanceAction.zp", {
      mode: "getAttFiloInfo",
      isAddRegRequest: "true",
      fromDate: String(request.fromDate),
      toDate: String(request.toDate),
      erecno: String(erecno),
    });
    if (!viewResult.ok) return viewResult;
    const viewUser = viewResult.data && viewResult.data.userDetails;
    const logErecno = (viewUser && (viewUser.eNo || viewUser.erecno)) || erecno;
    const queries = Array.isArray(request.statusQueries) ? request.statusQueries : [];
    const requests = await fetchRequestStatus(logErecno, queries);
    const requestsError = queries.length > 0 && requests.length === 0 ? "Không tải được trạng thái yêu cầu." : "";
    return {
      ok: true,
      view: viewResult.data,
      report: reportResult.ok ? reportResult.data : null,
      reportError: reportResult.ok ? "" : reportResult.message || "Không tải được tổng tháng.",
      erecno: String(logErecno),
      orgUser: orgUserResult.ok ? orgUserResult.data : null,
      orgUserError: orgUserResult.ok ? "" : orgUserResult.message || "Không tải được thông tin nhân viên.",
      requests,
      requestsError,
    };
  } catch (error) {
    return fail("exception", { message: error && error.message ? error.message : "Có lỗi xảy ra. Hãy thử lại." });
  }
}
