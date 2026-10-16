import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  accessFromOrgUser,
  accountFromEmail,
  accountFromUserList,
  canAccess,
  deptNameListFromUser,
  hasDivision8,
  parseAllowedAccounts,
} from "./access.js";

const orgUser = JSON.parse(readFileSync(new URL("../res/user.json", import.meta.url), "utf8"));
const whitelist = JSON.parse(readFileSync(new URL("../res/whitelist-account.json", import.meta.url), "utf8"));
const allowed = parseAllowedAccounts(whitelist);

test("email local-part becomes the account", () => {
  assert.equal(accountFromEmail("luongpq@smartosc.com"), "luongpq");
  assert.equal(accountFromEmail("LuongPQ@SmartOSC.com"), "luongpq");
  assert.equal(accountFromEmail(""), "");
});

test("Zoho userList email is at index 8", () => {
  assert.equal(accountFromUserList(orgUser.response.userList), "luongpq");
});

test("Division 8 in deptNameList is allowed", () => {
  assert.equal(hasDivision8(orgUser.response.deptNameList), true);
  assert.equal(hasDivision8(["Division 7 - Center DEV"]), false);
  const access = accessFromOrgUser(orgUser, allowed);
  assert.equal(access.ok, true);
  assert.equal(access.reason, "division-8");
  assert.equal(access.account, "luongpq");
});

test("whitelist account is allowed without Division 8", () => {
  const access = canAccess({
    account: "longhd1",
    deptNameList: ["Division 2"],
    allowedAccounts: allowed,
  });
  assert.equal(access.ok, true);
  assert.equal(access.reason, "whitelist");
});

test("other accounts are denied", () => {
  const access = canAccess({
    account: "someone",
    deptNameList: ["Division 2"],
    allowedAccounts: allowed,
  });
  assert.equal(access.ok, false);
  assert.equal(access.reason, "denied");
});

test("SRA userData department.name allows Division 8", () => {
  const userData = {
    id: 2816,
    email: "luongpq@smartosc.com",
    username: "luongpq",
    department: { id: 143, name: "Division 8 - Center DEV" },
    division: { id: 14, name: "Division 8" },
  };
  assert.deepEqual(deptNameListFromUser(userData), ["Division 8 - Center DEV"]);
  const access = canAccess({
    account: userData.username,
    deptNameList: deptNameListFromUser(userData),
    allowedAccounts: allowed,
  });
  assert.equal(access.ok, true);
  assert.equal(access.reason, "division-8");
});

test("SRA userData other department is denied unless whitelisted", () => {
  const userData = {
    username: "someone",
    department: { id: 1, name: "Division 2 - Center DEV" },
  };
  const access = canAccess({
    account: userData.username,
    deptNameList: deptNameListFromUser(userData),
    allowedAccounts: allowed,
  });
  assert.equal(access.ok, false);
});
