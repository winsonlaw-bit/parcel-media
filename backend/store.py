"""Persistence: OceanBase (MySQL wire) first, local JSON file fallback.

Mirrors the Shippers Volume Alert project's store.py pattern. The Substrait
platform provisions an OceanBase cluster when `database:` is declared in
substrait.yaml and injects DATABASE_URL. The Flyway migration
V1__access_log.sql creates the access_log table. We record "who viewed the
workbench and which tab" so the team can see who has reviewed the proposal.

When DATABASE_URL is absent or unreachable (local dev, offline), every method
silently falls back to a JSON file under data/ -- the request path never breaks.
This is what keeps "no live DB" from blocking local tests.

DDL / driver rules (from the platform database contract):
  - MySQL dialect only: BIGINT AUTO_INCREMENT, %s placeholders, no SERIAL/RETURNING.
  - Never build SQL with % or f-strings -- always parameterized queries.
  - The driver (pymysql) is imported lazily so a local run never requires it.
  - All logging goes to stdout; never to a file.
"""
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data"
DATA.mkdir(exist_ok=True)


# --------------------------------------------------------------------------
# File fallback (used when no DB is available)
# --------------------------------------------------------------------------
def _p(name: str) -> Path:
    return DATA / name


def load_json(name: str, default=None):
    p = _p(name)
    if not p.exists():
        return default
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return default


def save_json(name: str, obj) -> None:
    p = _p(name)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(
        json.dumps(obj, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    tmp.replace(p)


# --------------------------------------------------------------------------
# OceanBase / MySQL connection (lazy, best-effort)
# --------------------------------------------------------------------------
_DB_PARAMS = None
_DB_OK = None   # None=untested, False=unavailable, True=available
_DB_ERR = None  # last failure reason (no credentials) -- surfaced by /api/info


def _db_params():
    """Parse DATABASE_URL (mysql://user:pass@host:port/db) or mark absent."""
    global _DB_PARAMS, _DB_ERR
    if _DB_PARAMS is not None:
        return _DB_PARAMS
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        _DB_PARAMS = False
        _DB_ERR = "DATABASE_URL missing"
        return False
    try:
        from urllib.parse import urlparse, unquote

        u = urlparse(url)
        _DB_PARAMS = dict(
            host=u.hostname or "127.0.0.1",
            port=u.port or 3306,
            # Percent-decode credentials: passwords with @ : / % arrive still
            # encoded in the URL and would otherwise fail auth verbatim.
            user=unquote(u.username) if u.username else "root",
            password=unquote(u.password) if u.password else "",
            database=(u.path.lstrip("/") or "").split("?")[0],
            charset="utf8mb4",
            connect_timeout=5,
            read_timeout=5,
            write_timeout=5,
        )
        return _DB_PARAMS
    except Exception as e:  # noqa: BLE001
        _DB_PARAMS = False
        _DB_ERR = f"parse: {type(e).__name__}: {e}"
        return False


def _db_conn():
    """Return a live connection, or None (and remember the failure)."""
    global _DB_OK, _DB_ERR
    if _DB_OK is False:
        return None
    params = _db_params()
    if params is False:
        _DB_OK = False
        return None
    try:
        import pymysql

        conn = pymysql.connect(**params)
        _DB_OK = True
        _DB_ERR = None
        return conn
    except Exception as e:  # noqa: BLE001
        _DB_OK = False
        _DB_ERR = f"{type(e).__name__}: {e}"
        print(f"[store] OceanBase unavailable, using file store: {e}", flush=True)
        return None


def _safe_close(conn) -> None:
    try:
        if conn:
            conn.close()
    except Exception:
        pass


def db_status(force: bool = False) -> str:
    """Connectivity probe: 'up' (OceanBase) or 'down' (file store).

    With force=True it re-tests even if a previous attempt failed. The failure
    cache is per-process, so a transient boot-time error would otherwise pin the
    app to file fallback for its whole lifetime.
    """
    global _DB_OK
    if force:
        _DB_OK = None
    if _DB_OK is None:
        _safe_close(_db_conn())
    return "up" if _DB_OK else "down"


def db_diag() -> dict:
    """DB diagnostic for /api/info. Exposes error class + env var NAMES, never secrets."""
    url = os.environ.get("DATABASE_URL", "")
    names = sorted(
        k
        for k in os.environ
        if any(t in k.upper() for t in ("DATABASE", "DB_", "MYSQL", "OCEAN", "MARIA", "SQL_HOST"))
    )
    status = db_status(force=True)  # fresh probe; populates _DB_ERR on failure
    err = _DB_ERR[:300] if _DB_ERR else None
    pw = _DB_PARAMS.get("password") if isinstance(_DB_PARAMS, dict) else None
    if err and pw:
        err = err.replace(pw, "***")  # belt-and-braces: never echo the password
    return {
        "db": status,
        "db_url_present": bool(url),
        "db_url_scheme": (url.split(":", 1)[0] if url else None),
        "db_env_names": names,   # variable NAMES only, no values
        "db_error": err,          # connection/parse error, password scrubbed
    }


def _now() -> str:
    """MySQL-friendly naive UTC timestamp."""
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")


# --------------------------------------------------------------------------
# Access log -- "who reviewed the proposal, and which tab"
# --------------------------------------------------------------------------
_DEDUP_SECONDS = 600  # same actor+tab within 10 min -> one row (avoid refresh spam)


def record_access(actor: str, tab: str, actor_ip: str = "", user_agent: str = "") -> None:
    actor = actor or "anonymous"
    ts = _now()
    conn = _db_conn()
    if conn:
        try:
            with conn.cursor() as cur:
                # Light dedup: skip if the same actor+tab was seen in the last 10 min.
                cur.execute(
                    "SELECT id FROM access_log WHERE actor=%s AND tab=%s "
                    "AND created_at >= NOW() - INTERVAL %s SECOND LIMIT 1",
                    (actor, tab, _DEDUP_SECONDS),
                )
                if cur.fetchone():
                    return
                cur.execute(
                    "INSERT INTO access_log (actor, actor_ip, tab, user_agent, created_at) "
                    "VALUES (%s,%s,%s,%s,%s)",
                    (actor, actor_ip, tab, user_agent, ts),
                )
                conn.commit()
            return
        except Exception as e:  # noqa: BLE001
            print(f"[store] access_log DB write failed, file fallback: {e}", flush=True)
            _safe_close(conn)
    # file fallback
    arr = load_json("access_log.json", [])
    arr.append({
        "ts": datetime.now(timezone.utc).isoformat(),
        "actor": actor, "ip": actor_ip, "tab": tab, "ua": user_agent,
    })
    save_json("access_log.json", arr[-2000:])


def list_access(limit: int = 200) -> dict:
    conn = _db_conn()
    if conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT actor, tab, created_at FROM access_log ORDER BY id DESC LIMIT %s",
                    (limit,),
                )
                rows = cur.fetchall()
                cur.execute("SELECT COUNT(DISTINCT actor) FROM access_log")
                unique = cur.fetchone()[0]
                cur.execute("SELECT tab, COUNT(*) FROM access_log GROUP BY tab")
                by_tab = {r[0]: r[1] for r in cur.fetchall()}
                cur.execute("SELECT COUNT(*) FROM access_log")
                total = cur.fetchone()[0]
            return {
                "total": total,
                "uniqueActors": unique,
                "byTab": by_tab,
                "recent": [
                    {
                        "actor": r[0],
                        "tab": r[1],
                        "at": (r[2].strftime("%Y-%m-%dT%H:%M:%SZ") if r[2] else None),
                    }
                    for r in rows
                ],
            }
        except Exception as e:  # noqa: BLE001
            print(f"[store] access_list DB failed, file fallback: {e}", flush=True)
            _safe_close(conn)
    arr = load_json("access_log.json", [])
    recent = [
        {"actor": a.get("actor"), "tab": a.get("tab"), "at": a.get("ts")}
        for a in arr[-limit:][::-1]
    ]
    unique = len({a.get("actor") for a in arr})
    by_tab = {}
    for a in arr:
        by_tab[a.get("tab")] = by_tab.get(a.get("tab"), 0) + 1
    return {"total": len(arr), "uniqueActors": unique, "byTab": by_tab, "recent": recent}
