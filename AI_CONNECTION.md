# AI_CONNECTION.md — adding AI to this app

Read this whole file before adding any AI feature to this app.

## What this is

This app reaches AI through the **XB AI Gateway**, a service run for the AI Champions programme. The gateway holds the real AI key. This app holds only two settings:

| Setting | What it is | Secret? |
|---|---|---|
| `AI_GATEWAY_URL` | The gateway's address | No |
| `AI_GATEWAY_KEY` | This champion's personal key, starting `xbg_` | **Yes** |

The gateway decides which AI model is used, counts calls against a daily cap, and can be switched off by the programme owner.

## Hard rules

1. **Call the gateway only from backend Python code.** Never from the web page's JavaScript. The key must never reach the browser. (This rule is about the AI gateway only. Calls to the user's Apps Script web app are browser code by design — see GOOGLE_CONNECTION.md.)
2. **Read `AI_GATEWAY_URL` and `AI_GATEWAY_KEY` from environment variables.** Never write the key into code, the web page, logs, commit messages, or a committed `.env` file. Never print it.
3. **The gateway is the only way to reach AI.** Do not install or use `google-genai`, `@google/genai`, `openai`, `anthropic` or any other AI SDK. Do not use or ask for a `GEMINI_API_KEY` or any other AI provider key.
4. **Do not send a model name.** The gateway chooses the model.
5. **One gateway call per user action.** No loops that call the gateway once per row. If many items need AI, put them in one prompt.
6. **Never retry automatically** after an error. Show the error and let the user decide.
7. **Use only the Python standard library** (`urllib`) for the call. Do not add HTTP packages to the requirements.
8. **Routes that call the gateway must be plain `def`, not `async def`**, because the call waits for the reply.
9. **Show AI output as a suggestion** the user can accept, edit or ignore. Never save AI output into data automatically.
10. **Uploaded files are checked in memory and not stored.** Do not save uploaded documents to disk, the database or object storage.
11. **Ask for less.** Ask for a fixed list of named items and short answers. Long answers are slow, and requests are cut off at about 30 seconds.

## Setting up (the champion does this once)

1. Set the two settings with the env commands described in AGENTS.md. `AI_GATEWAY_KEY` must be set **as a secret**. `AI_GATEWAY_URL` is not secret.
2. **Redeploy.** A new or changed setting only takes effect after a redeploy has finished. Testing before the redeploy finishes gives `INVALID_KEY` even when the key is correct.
3. Test with one short call before building anything bigger.

## The request

`POST {AI_GATEWAY_URL}/v1/generate`

Headers:
```
Content-Type: application/json
Authorization: Bearer {AI_GATEWAY_KEY}
```

Text only:
```json
{ "prompt": "Summarise this note in one sentence: ..." }
```

With a PDF:
```json
{
  "prompt": "Check this invoice for: invoice number, HS code, total amount, consignee. For each, give the value or say MISSING.",
  "files": [
    { "mime_type": "application/pdf", "data": "<base64 of the file>" }
  ]
}
```

Limits:
- **Files: PDF only**, one per call, at most **5 MB** and **5 pages**. Base64 makes a file about a third larger.
- Use **text PDFs or clean, readable scans only**. Low-quality scanned images may return fast but miss the invoice fields. If a scan is hard to read by eye, ask the user for a clearer file before calling AI.
- The whole request must finish within about **25 seconds**, or the gateway returns `AI_TIMEOUT`.

## The response

Success (HTTP 200):
```json
{
  "text": "Invoice number: INV-1234\nHS code: MISSING\n...",
  "request_id": "req_2f4618fce28e40f8",
  "usage": { "input_tokens": 1082, "output_tokens": 77 }
}
```

Error (any other status):
```json
{
  "error": {
    "code": "CAP_REACHED",
    "message_en": "You have used today's AI calls.",
    "message_zh": "你今天的 AI 调用次数已用完。",
    "request_id": "req_..."
  }
}
```

## Python helper — copy this into the backend

```python
import json
import os
import urllib.error
import urllib.request

AI_TIMEOUT_SECONDS = 28  # longer than the gateway's own ~25s limit, so its clear error arrives first


class AIError(Exception):
    def __init__(self, code, message_en, message_zh, request_id=None, status=None):
        super().__init__(f"{code}: {message_en}")
        self.code = code
        self.message_en = message_en
        self.message_zh = message_zh
        self.request_id = request_id
        self.status = status

    def to_dict(self):
        return {
            "code": self.code,
            "message_en": self.message_en,
            "message_zh": self.message_zh,
            "request_id": self.request_id,
        }


def ask_ai(prompt, files=None):
    """Send one request to the XB AI Gateway. Returns {"text", "request_id", "usage"}.
    Raises AIError on any failure. Never retries."""
    url = os.environ["AI_GATEWAY_URL"].rstrip("/") + "/v1/generate"
    key = os.environ["AI_GATEWAY_KEY"]

    body = {"prompt": prompt}
    if files:
        body["files"] = files  # [{"mime_type": "application/pdf", "data": "<base64>"}]

    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
    )

    try:
        with urllib.request.urlopen(request, timeout=AI_TIMEOUT_SECONDS) as response:
            status = response.status
            raw = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        status = error.code
        raw = error.read().decode("utf-8", "replace")
    except (urllib.error.URLError, TimeoutError) as error:
        raise AIError(
            "NETWORK_OR_TIMEOUT",
            f"Could not reach the AI gateway, or it took too long ({error}).",
            f"无法连接 AI gateway，或等待时间过长（{error}）。",
        )

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise AIError(
            "NOT_JSON",
            "The gateway returned a web page instead of data. If this happened immediately, "
            "AI_GATEWAY_URL is wrong. If it took about 30 seconds, the request was too slow.",
            "Gateway 返回的是网页而不是数据。如果立刻出现，说明 AI_GATEWAY_URL 填错了；"
            "如果等了大约 30 秒，说明请求太慢了。",
            status=status,
        )

    if status != 200 or "error" in data:
        err = data.get("error", {})
        raise AIError(
            err.get("code", "UNKNOWN"),
            err.get("message_en", "Unknown error."),
            err.get("message_zh", "未知错误。"),
            err.get("request_id"),
            status,
        )
    return data
```

## Example: a document check route

The web page reads the chosen file with `FileReader.readAsDataURL`, removes everything up to and including the first comma, and sends the base64 text to this route as JSON. This avoids file-upload packages.

Show a short note next to the upload button: **Text PDFs work best. Scanned PDFs must be clear and readable.**

```python
import base64
from fastapi import HTTPException
from pydantic import BaseModel

MAX_PDF_BYTES = 5 * 1024 * 1024


class DocumentCheck(BaseModel):
    filename: str
    mime_type: str
    data: str          # base64, without the "data:...;base64," prefix
    fields: list[str]  # e.g. ["Invoice number", "HS code", "Total amount", "Consignee"]


@app.post("/api/check-document")
def check_document(req: DocumentCheck):          # plain def, not async def
    if req.mime_type != "application/pdf":
        raise HTTPException(415, detail={"code": "PDF_ONLY", "message_en": "PDF files only.", "message_zh": "只支持 PDF 文件。"})
    if len(base64.b64decode(req.data, validate=True)) > MAX_PDF_BYTES:
        raise HTTPException(413, detail={"code": "FILE_TOO_LARGE", "message_en": "The file is too large.", "message_zh": "文件太大。"})

    prompt = (
        "Check this document. For each item below, give the value exactly as written, "
        "or say MISSING. One line per item. No other text.\n" + "\n".join(req.fields)
    )
    try:
        result = ask_ai(prompt, files=[{"mime_type": "application/pdf", "data": req.data}])
    except AIError as error:
        raise HTTPException(error.status or 502, detail=error.to_dict())

    # The uploaded file is not stored anywhere.
    return {"suggestion": result["text"], "request_id": result["request_id"]}
```

The page shows `suggestion` as a suggestion the user checks against the document.

## Showing errors

When a call fails, the page shows **all four** of these exactly as received, so the champion can send them for help:

- `code`
- `message_en`
- `message_zh`
- `request_id` (if present)

| Code | Meaning | What the champion does |
|---|---|---|
| `INVALID_KEY` | Key wrong or missing | Check `AI_GATEWAY_KEY`. If you just set it, **redeploy** and wait for it to finish |
| `KEY_DISABLED` | Key switched off | Contact Sean |
| `CAP_REACHED` | Today's calls used up | Wait until tomorrow (Singapore time) |
| `RATE_LIMITED` | Too many calls in one minute | Wait a minute |
| `PAUSED` | AI switched off for everyone | Contact Sean |
| `AI_TIMEOUT` | The AI took too long | Ask for less, or use a smaller document |
| `TOO_LARGE` | Request too big | Use a smaller file |
| `UNSUPPORTED_FILE_TYPE` | Not a PDF | PDF only |
| `NOT_JSON` | A web page came back instead of data | Immediately: wrong `AI_GATEWAY_URL`. After ~30s: too slow — ask for less |
| `NETWORK_OR_TIMEOUT` | No reply | Check the address; try again later |

## Not available in Session 4

Streaming, images, and JSON mode are not part of this guide. Do not use `/v1/stream`.
