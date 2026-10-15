# SmartOSC - One Click

Just one click for your daily SmartOSC routine: log work on SRA and register attendance on Zoho People.

Chrome extension (Manifest V3). On `https://sra.smartosc.com/time-sheet` the side panel writes SRA worklogs for one month from timesheet allocations; on `people.zoho.com` it summarizes attendance for the 21st–20th period and registers attendance / work-from-home days. The side panel is in Vietnamese. It does not store a bearer token. At runtime it reads `localStorage.accessToken` on `https://sra.smartosc.com`.

Requires Chrome 114 or newer (side panel).

## Load the unpacked extension

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Choose this folder — the one that contains `manifest.json`.
5. Open [https://sra.smartosc.com](https://sra.smartosc.com) and sign in.
6. Click the extension icon. The side panel opens.

If you change the source, click **Reload** on the extension card, then close and reopen the side panel.

## How logging works

1. The panel checks that the active tab is `https://sra.smartosc.com` and that `accessToken` is in that page's `localStorage`. If either is missing, it shows the error and does not call the API.
2. It loads **Loại công việc** once from `GET /api/timesheet/type-of-work`. Later runs reuse the dropdown. The selected option's value is the type id.
3. **Mô tả** is optional. When filled in, it is copied onto every worklog. **Ngày off** is optional; add one date per row.
4. **Log work** is blocked while tháng or loại công việc is empty. Mô tả may be left blank.
5. The month timesheet is loaded once: `GET /api/timesheet-overview` from the 1st through the last day of the selected month. The username comes from the signed-in session.
6. Each day in that month is skipped when it is Saturday, Sunday, one of the ngày off, or `isHoliday === true`. A day is counted in only one bucket, in that order. The counts sit above the result table.
7. For each remaining day, the extension reads `allocated.detail` and, when some line has `hours > 0`, calls `GET /api/projects/all?userId=&date=`. It maps `detail.code` to `project.id`.
8. Each detail with `hours > 0` is one `POST /api/user/worklogs`. The body is `text/plain` and contains a single object: `{ "workLogs": [{ date, description, workHours, typeOfWork, projectId }] }`. Requests run one after another. The table gains a row as each one finishes.
9. A day with no allocation, a code that matches no project, or an API error becomes a **fail** row. The **Lỗi** column has that day's message.

Every API call runs inside the SRA tab (`chrome.scripting.executeScript`, main world) so the request origin stays `https://sra.smartosc.com`. The token is not copied into the extension.

Running **Log work** again can create duplicate worklogs. The panel says so above the button.

`localStorage.accessToken` is the raw JWT (`username`, `exp`). `localStorage.userData` is the signed-in user (`id`, `username`, `name`). The projects request uses that `id`.

## Tests

Date selection (weekends, days off, holidays, month length) is pure Node. It does not call SRA.

```bash
node --test src/dates.test.js
```
