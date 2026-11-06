"""Backend for the NJV SG 需求情报工作台 (Substrait contract).

The workbench is a static frontend (served by nginx on :80). This backend:

  - listens on port 8000
  - GET /health  -> 200 (the platform readiness probe)
  - API routes under /api  (the ingress routes /api here; everything else -> frontend)
  - records "who reviewed the proposal" to OceanBase (access_log) so the team can
    see which teammates opened which tab. DATABASE_URL is injected by the platform
    (database: oceanbase in substrait.yaml); when it is absent we fall back to a
    local JSON file (see store.py) so local tests never break.
"""
import os

from fastapi import FastAPI, Header, HTTPException, Request

import store

app = FastAPI(title="NJV SG 需求情报工作台 (backend)")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/info")
def info():
    return {
        "app": "NJV SG 需求情报工作台",
        "mode": "static-frontend" if store.db_status() == "down" else "db-backed",
        "data": "H1 2026 · 3.27M parcels (≈96.75% completed)",
        "db": store.db_status(),
    }


# --------------------------------------------------------------------------
# Visitor access log -- "who has reviewed the proposal, and which tab".
# The platform's SSO layer injects the viewer's email as the `x-forwarded-email`
# request header (same mechanism Shippers Volume Alert uses for its actor field),
# so we record the real reviewer identity without any client-side code.
# --------------------------------------------------------------------------
ADMIN_EMAILS = {e.strip().lower() for e in os.environ.get("ADMIN_EMAILS", "").split(",") if e.strip()}


@app.post("/api/visit")
def visit(
    tab: str = "",
    x_email: str | None = Header(default=None, alias="x-forwarded-email"),
    request: Request = None,
):
    ip = request.client.host if (request and request.client) else ""
    ua = request.headers.get("user-agent", "") if request else ""
    store.record_access(x_email or "anonymous", tab or "unknown", ip, ua)
    return {"ok": True, "mode": store.db_status()}


@app.get("/api/visits")
def visits(
    x_email: str | None = Header(default=None, alias="x-forwarded-email"),
    limit: int = 200,
):
    # 内部查看：必须登录（平台注入 x-forwarded-email）。若设了 ADMIN_EMAILS 则仅白名单。
    if not x_email:
        raise HTTPException(status_code=401, detail="SSO required (x-forwarded-email)")
    if ADMIN_EMAILS and x_email.strip().lower() not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="admin only")
    return store.list_access(limit)


@app.on_event("startup")
def _startup():
    print(
        f"[backend] DATABASE_URL present={bool(os.environ.get('DATABASE_URL'))} "
        f"(file-store fallback if absent)",
        flush=True,
    )

