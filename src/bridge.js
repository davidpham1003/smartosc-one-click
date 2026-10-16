/**
 * Serialized into the SRA page (MAIN world) by chrome.scripting.executeScript.
 * Keep this function self-contained: nested helpers are included, imports are not.
 * The bearer token is read here and never returned to the extension.
 */
export async function runInPage(request) {
  function fail(error, extra = {}) {
    return { ok: false, error, ...extra };
  }

  function readToken() {
    const raw = localStorage.getItem("accessToken");
    return raw ? String(raw).trim() : "";
  }

  function readUser() {
    const raw = localStorage.getItem("userData");
    if (!raw) return null;
    let user;
    try {
      user = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!user || typeof user !== "object") return null;
    const username = typeof user.username === "string" ? user.username.trim() : "";
    const name = typeof user.name === "string" ? user.name.trim() : "";
    const id = typeof user.id === "number" && Number.isFinite(user.id) ? user.id : null;
    if (!username || id == null) return null;
    const departmentName =
      user.department && typeof user.department === "object" && typeof user.department.name === "string"
        ? user.department.name.trim()
        : typeof user.department === "string"
          ? user.department.trim()
          : "";
    const deptNameList = Array.isArray(user.deptNameList) && user.deptNameList.length > 0
      ? user.deptNameList
      : departmentName
        ? [departmentName]
        : [];
    return { id, username, name, deptNameList };
  }

  function decodeJwtPayload(token) {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    try {
      const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
      const binary = atob(padded);
      const json = decodeURIComponent(
        Array.from(binary, (char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""),
      );
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  function isTokenExpired(token) {
    const payload = decodeJwtPayload(token);
    if (!payload || payload.exp == null) return false;
    const exp = Number(payload.exp);
    return Number.isFinite(exp) && exp * 1000 <= Date.now();
  }

  function readSession() {
    const token = readToken();
    return {
      ok: true,
      hasToken: Boolean(token),
      expired: Boolean(token) && isTokenExpired(token),
      user: readUser(),
    };
  }

  function errorMessage(data, text, status) {
    if (typeof data === "string" && data.trim() && data.trim().length <= 300 && !data.trim().startsWith("<")) {
      return data.trim();
    }
    if (data && typeof data === "object") {
      for (const key of ["message", "error", "title", "detail"]) {
        const value = data[key];
        if (typeof value === "string" && value.trim()) return value.trim().slice(0, 300);
      }
    }
    if (typeof text === "string" && text.trim() && text.trim().length <= 300 && !text.trim().startsWith("<")) {
      return text.trim();
    }
    return `HTTP ${status}`;
  }

  async function api(url, options = {}) {
    const token = readToken();
    if (!token) return fail("missing-token", { message: "Bạn chưa đăng nhập." });
    if (isTokenExpired(token)) {
      return fail("session-expired", { status: 401, message: "Phiên đăng nhập đã hết hạn." });
    }
    const headers = {
      accept: "application/json, text/plain, */*",
      authorization: `Bearer ${token}`,
    };
    if (options.body != null) headers["content-type"] = "text/plain";
    try {
      const response = await fetch(url, {
        method: options.method || "GET",
        headers,
        body: options.body,
        cache: "no-store",
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
        if (response.status === 401) {
          return fail("session-expired", {
            status: response.status,
            message: "Phiên đăng nhập đã hết hạn.",
          });
        }
        return fail("http", {
          status: response.status,
          message: errorMessage(data, text, response.status),
        });
      }
      return { ok: true, status: response.status, data };
    } catch (error) {
      return fail("network", { message: error && error.message ? error.message : "Không kết nối được. Hãy thử lại." });
    }
  }

  try {
    const action = request && request.action;
    if (action === "session") return readSession();

    if (action === "typeOfWork") {
      return api("https://sra-api.smartosc.com/api/timesheet/type-of-work");
    }

    if (action === "timesheet") {
      const url = new URL("https://sra-api.smartosc.com/api/timesheet-overview");
      url.searchParams.set("username", String(request.username));
      url.searchParams.set("startDate", String(request.startDate));
      url.searchParams.set("endDate", String(request.endDate));
      return api(url.toString());
    }

    if (action === "projects") {
      const url = new URL("https://sra-api.smartosc.com/api/projects/all");
      url.searchParams.set("userId", String(request.userId));
      url.searchParams.set("date", String(request.date));
      return api(url.toString());
    }

    if (action === "worklog") {
      const entry = request.workLog || {};
      const body = JSON.stringify({
        workLogs: [
          {
            date: entry.date,
            description: entry.description,
            workHours: entry.workHours,
            typeOfWork: entry.typeOfWork,
            projectId: entry.projectId,
          },
        ],
      });
      return api("https://sra-api.smartosc.com/api/user/worklogs", { method: "POST", body });
    }

    return fail("unknown-action", { message: "Thao tác không hỗ trợ." });
  } catch (error) {
    return fail("exception", { message: error && error.message ? error.message : "Có lỗi xảy ra. Hãy thử lại." });
  }
}
