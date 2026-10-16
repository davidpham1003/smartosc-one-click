export const FALLBACK_ACCOUNT_ROWS = [
  { account: "longhd1" },
  { account: "uyenhth" },
  { account: "khanhpq" },
];

const DIVISION_8 = /\bdivisi?on\s*8\b/i;

export function normalizeAccount(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function accountFromEmail(email) {
  if (!email || typeof email !== "string") return "";
  const trimmed = email.trim();
  const at = trimmed.indexOf("@");
  if (at <= 0) return "";
  return normalizeAccount(trimmed.slice(0, at));
}

export function emailFromUserList(userList) {
  const row = Array.isArray(userList) && Array.isArray(userList[0]) ? userList[0] : null;
  if (!row) return "";
  if (typeof row[8] === "string" && row[8].includes("@")) return row[8].trim();
  const found = row.find((value) => typeof value === "string" && value.includes("@"));
  return typeof found === "string" ? found.trim() : "";
}

export function accountFromUserList(userList) {
  return accountFromEmail(emailFromUserList(userList));
}

export function hasDivision8(deptNameList) {
  const list = Array.isArray(deptNameList) ? deptNameList : [];
  return list.some((name) => DIVISION_8.test(String(name || "")));
}

export function parseAllowedAccounts(rows) {
  const accounts = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const account = normalizeAccount(row && row.account);
    if (account) accounts.add(account);
  }
  return accounts;
}

export function canAccess({ account, deptNameList, allowedAccounts } = {}) {
  if (hasDivision8(deptNameList)) {
    return { ok: true, reason: "division-8", account: normalizeAccount(account) };
  }
  const id = normalizeAccount(account);
  const allowed = allowedAccounts instanceof Set ? allowedAccounts : parseAllowedAccounts(allowedAccounts);
  if (id && allowed.has(id)) {
    return { ok: true, reason: "whitelist", account: id };
  }
  return { ok: false, reason: "denied", account: id };
}

export function orgUserResponse(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.response && typeof payload.response === "object") return payload.response;
  return payload;
}

export function accessFromOrgUser(payload, allowedAccounts) {
  const response = orgUserResponse(payload);
  if (!response) return { ok: false, reason: "denied", account: "" };
  const account = accountFromUserList(response.userList);
  return canAccess({
    account,
    deptNameList: response.deptNameList,
    allowedAccounts,
  });
}

function departmentName(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && typeof value.name === "string") return value.name.trim();
  return "";
}

export function deptNameListFromUser(user) {
  if (!user || typeof user !== "object") return [];
  if (Array.isArray(user.deptNameList) && user.deptNameList.length > 0) return user.deptNameList;
  const name = departmentName(user.department);
  return name ? [name] : [];
}
