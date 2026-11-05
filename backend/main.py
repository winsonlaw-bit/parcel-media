"""Minimal conforming backend for the NJV SG workbench (Substrait contract).

The workbench itself is a static frontend (served by nginx on :80). This backend
exists only to satisfy Substrait's hard requirements:

  - listens on port 8000
  - GET /health  -> 200 (the platform readiness probe)
  - API routes under /api  (the ingress routes /api here; everything else -> frontend)

This is a static, read-only app: it declares NO database in substrait.yaml, so
there is no DATABASE_URL and no DB driver. Add endpoints here when the workbench
later needs a real API (e.g. serving pre-aggregated JSON).
"""
from fastapi import FastAPI

app = FastAPI(title="NJV SG 需求情报工作台 (backend)")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/info")
def info():
    return {
        "app": "NJV SG 需求情报工作台",
        "mode": "static-frontend",
        "data": "H1 2026 · 3.26M parcels (≈96.75% completed)",
    }
