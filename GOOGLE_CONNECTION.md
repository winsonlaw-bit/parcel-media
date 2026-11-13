# GOOGLE_CONNECTION.md — connecting this app to Google Sheets, Gmail and Chat

Read this whole file before making this app read or write a Google Sheet, draft or send email, or post to Google Chat.

## How it works

This app's **backend cannot reach Google** — it has no Google login. Instead, the **web page** (running in the user's signed-in Chrome) calls the champion's own **App Connector**: an Apps Script web app inside their Sandbox v3 sheet. The call uses a `<script>` tag (JSONP), because a normal `fetch()` to Apps Script is blocked.

```
Web page (browser, signed in to Google) → App Connector (/exec URL) → Sheet / Gmail / Chat
```

The App Connector is already written. It is the file `AppConnector.gs` in the champion's sheet. **Do not write or change Apps Script code for this.** Only write the web page side.

**What the connector allows is set by the champion in three tabs of their sheet, not in code:**
- `Connector_Tabs`: which tabs the app may read, which columns it may change, and which tabs it may add rows to;
- `Connector_Email`: who the app may email;
- `Connector_AI`: the named AI questions the app may ask.

**Always call `describe` first.** It returns the tabs, their column headers, what's allowed on each, the AI question names and the Chat spaces. Build the page from what `describe` returns. Don't guess tab or column names. If something the user wants isn't allowed, tell them which setting to add in which tab, rather than working around it.

## Hard rules

1. **This is browser code by design.** Call the App Connector from the web page's JavaScript, not from Python. (AI_CONNECTION.md's "backend only" rule applies to the AI gateway, not to this.)
2. **Get the `/exec` URL from the backend at page load**, from an environment variable `APPS_SCRIPT_URL`, via a route such as `GET /api/config`. Never write the URL into code or commit it.
3. **Treat the `/exec` URL like a password.** Anyone who has it can make the connector act as the champion, from any website. Never print it on the page, in logs, or in error messages.
4. **Every write sends a new `request_id`** (one per click). This stops double-clicks and refreshes from doing the same thing twice.
5. **Disable the clicked button and show `Working...` while a connector call is running.** Re-enable it only after the call succeeds or fails. This prevents accidental double-clicks before the idempotency check can reply.
6. **Keep each call under 8 KB.** Everything travels in the URL. The helper below refuses larger calls before sending.
7. **Ask before sending email.** A `send` must follow a confirmation that shows the recipient, subject and body. Prefer `draft` when a person should review first.
8. **Show errors exactly as received:** `code`, `message_en`, `message_zh`.
9. **Only use the actions listed below.** The connector refuses anything else.
10. **The app can't send its own AI prompt through the connector.** It picks a named question from `Connector_AI`. If the user needs a new AI question, tell them the exact row to add to `Connector_AI`. (For free-form AI inside the app, use the AI gateway from the backend — see AI_CONNECTION.md.)
11. **Never silently swap email recipients.** If a shipment row needs a shipper email, read the allowed lookup tab (for example `Shipper_Master`) and match by the row's shipper ID. If no recipient is found, leave the field empty and ask the user to fill it in. Do not fall back to the signed-in user, the connector owner, or any other address unless the user explicitly chooses it.

## Setting up (the champion does this once)

1. In the sheet, run `setupConnector` once (Extensions → Apps Script → choose `setupConnector` → Run). This creates the three settings tabs with examples. Edit them for what the app needs.
2. For Chat: add `CHAT_WEBHOOK_URL` in **Project Settings → Script Properties**. Extra spaces go in `CHAT_WEBHOOK_URL_<NAME>`, e.g. `CHAT_WEBHOOK_URL_FINANCE`.
3. Run `testConnector` and read the Execution log. It lists what's allowed and flags mistakes.
4. **Deploy → New deployment → Web app**. Execute as **Me**. Who has access: **Anyone within Ninja Van**. Copy the URL ending in `/exec`.
5. Set `APPS_SCRIPT_URL` in this app with the env commands described in AGENTS.md (not a secret, but never commit it).
6. **Redeploy** the app.
7. Use **Chrome, in a normal window, signed in to your Ninja Van Google account only.** Incognito, Safari, and browsers signed in to more than one Google account have not been tested.

## Actions

| `action` | Parameters | Returns (on success, `ok: true`) |
|---|---|---|
| `ping` | — | `active_user`, `owner`, `time` |
| `describe` | — | `tabs` (each: `tab`, `headers`, `can_read`, `key_column`, `can_change`, `can_add_rows`, `add_columns`), `ai_questions` (each: `name`, `tab`, `key_column`, `uses_input`), `chat_spaces` |
| `read` | `tab`; optional `where_column` + `where_value` (exact match, not case-sensitive); optional `limit` (max 200) | `headers`, `rows` (arrays of text), `total`, `truncated` |
| `add` | `request_id`, `tab`, `values` = JSON text of `{"Column": "value"}` | `row_number`. `Request_ID`, `Created_At` and `Created_By` are filled automatically if the tab has those columns |
| `update` | `request_id`, `tab`, `key` (the row's value in its key column), `changes` = JSON text of `{"Column": "new value"}` | `before`, `after` |
| `draft` | `request_id`, `to`, `subject`, `body` | `draft_id` — a Gmail draft, not sent |
| `send` | `request_id`, `to`, `subject`, `body` | `sent_to` — **really sends** |
| `chat` | `request_id`, `text`; optional `space` (a name from `chat_spaces`) | `chat_status` |
| `ai` | `request_id`, `question` (a name from `ai_questions`), `key` (if the question has a tab); optional `input` (extra text, max 1000 characters) | `text` — the AI's answer |

Email (`draft`, `send`) goes to **one address only**, and only to an address allowed in `Connector_Email` (a listed address, a whole domain, or a column in a tab), or to the champion.

A repeated `request_id` returns `duplicate: true` and does nothing.

Every failure returns:
```json
{ "ok": false, "error": { "code": "RECIPIENT_NOT_ALLOWED", "message_en": "...", "message_zh": "..." } }
```

Error messages name the tab and setting to fix. Show them to the user as they are.

## JavaScript helper — copy this into the web page

```javascript
let APPS_SCRIPT_URL = null;
const MAX_URL_LENGTH = 8000;
const CALL_TIMEOUT_MS = 30000;

async function loadAppsScriptUrl() {
  const res = await fetch("/api/config");
  const cfg = await res.json();
  APPS_SCRIPT_URL = cfg.apps_script_url;
  if (!APPS_SCRIPT_URL) throw new Error("APPS_SCRIPT_URL is not set on this app.");
}

function newRequestId() {
  return "req-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
}

function callAppsScript(params) {
  return new Promise((resolve, reject) => {
    if (!APPS_SCRIPT_URL) {
      reject({ code: "NOT_CONFIGURED", message_en: "The app has not loaded its settings yet.", message_zh: "应用还没有加载设置。" });
      return;
    }
    const callback = "__appsScript_" + Date.now() + "_" + Math.random().toString(36).slice(2);
    const url = new URL(APPS_SCRIPT_URL);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    url.searchParams.set("callback", callback);

    if (url.toString().length > MAX_URL_LENGTH) {
      reject({ code: "TOO_MUCH_DATA", message_en: "Too much text for one call. Shorten it.", message_zh: "一次发送的文字太多，请缩短。" });
      return;
    }

    const script = document.createElement("script");
    const timer = setTimeout(() => {
      cleanup();
      reject({ code: "NO_REPLY", message_en: "The sheet connector did not reply. Check you are in Chrome, signed in to your Ninja Van account only.", message_zh: "表格连接器没有回应。请确认你在使用 Chrome，并且只登录了 Ninja Van 账号。" });
    }, CALL_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timer);
      delete window[callback];
      script.remove();
    }

    window[callback] = (payload) => {
      cleanup();
      if (payload && payload.ok) resolve(payload);
      else reject((payload && payload.error) || { code: "UNKNOWN", message_en: "Unknown error.", message_zh: "未知错误。" });
    };

    script.onerror = () => {
      cleanup();
      reject({ code: "LOAD_FAILED", message_en: "Could not reach the sheet connector. The data may be too large, or APPS_SCRIPT_URL is wrong.", message_zh: "无法连接表格连接器。可能是数据太多，或 APPS_SCRIPT_URL 填错了。" });
    };

    script.async = true;
    script.src = url.toString();
    document.head.appendChild(script);
  });
}
```

Example uses:
```javascript
await loadAppsScriptUrl();

const allowed = await callAppsScript({ action: "describe" });

const late = await callAppsScript({ action: "read", tab: "Shipments",
                                     where_column: "SLA_Breach", where_value: "YES" });

await callAppsScript({ action: "update", request_id: newRequestId(), tab: "Shipments",
                       key: "SBX-100021", changes: JSON.stringify({ Remarks: "Called customer" }) });

await callAppsScript({ action: "add", request_id: newRequestId(), tab: "App_Entries",
                       values: JSON.stringify({ Tracking_ID: "SBX-100021", Note: "Escalated" }) });

const email = await callAppsScript({ action: "ai", request_id: newRequestId(),
                                     question: "follow_up_email", key: "SBX-100021" });

// If the shipment does not carry the recipient email directly, read the allowed
// lookup tab and match by ID. If no match is found, leave the recipient blank for
// the user to choose; never silently substitute another address.
const shippers = await callAppsScript({ action: "read", tab: "Shipper_Master", limit: 200 });
const shipperHeaders = shippers.headers || [];
const shipperRows = (shippers.rows || []).map((row) =>
  Object.fromEntries(shipperHeaders.map((header, index) => [header, row[index] || ""]))
);
const shipper = shipperRows.find((row) => row.Shipper_ID === "SHIPPER-001");
const recipient = shipper ? shipper.Email : "";

await callAppsScript({ action: "draft", request_id: newRequestId(),
                       to: recipient, subject: "Update on SBX-100021", body: "..." });

await callAppsScript({ action: "chat", request_id: newRequestId(), text: "SBX-100021 escalated" });
```

Backend route for the setting:
```python
import os

@app.get("/api/config")
def config():
    return {"apps_script_url": os.environ.get("APPS_SCRIPT_URL", "")}
```

Keep the app's **Google SSO turned on**, so only Ninja Van staff can load the page and its settings.

## Troubleshooting

| What you see | Meaning | Fix |
|---|---|---|
| `LOAD_FAILED` | Data too large, or wrong URL | Send less text; check `APPS_SCRIPT_URL` ends in `/exec` |
| `NO_REPLY` | The browser couldn't use your Google login | Chrome, normal window, Ninja Van account only |
| A Google sign-in page | Not signed in to an allowed account | Sign in to your Ninja Van Google account |
| `TAB_NOT_ALLOWED`, `ADD_NOT_ALLOWED`, `CHANGE_NOT_ALLOWED`, `COLUMN_NOT_ALLOWED` | The settings don't allow it | Change the row for that tab in `Connector_Tabs` — no redeploy needed |
| `PROTECTED_TAB` | Settings, log and Config tabs can never be opened | Put the data in a different tab |
| `RECIPIENT_NOT_ALLOWED` | Address not allowed | Add the address, its domain (`@company.com`) or its column (`Tab!Column`) to `Connector_Email` |
| `QUESTION_NOT_FOUND` | No such AI question | Add a row to `Connector_AI` |
| `NO_WEBHOOK` | Chat address missing | Add `CHAT_WEBHOOK_URL` (or `CHAT_WEBHOOK_URL_<NAME>`) in Script Properties |
| `MISSING_REQUEST_ID` | The page didn't send one | Use `newRequestId()` for every write |
| App still shows old text or old behavior after deploy | The old page JavaScript is still in the browser | Hard reload the page after the deployment is live. In Chrome: hold Shift and click reload, or press Cmd+Shift+R. |
| Changed the connector **code** but nothing changed | The deployment still runs the old version | Deploy → Manage deployments → edit → Version: New version. (Settings-tab changes don't need this.) |
