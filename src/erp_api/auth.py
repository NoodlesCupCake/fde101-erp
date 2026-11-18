"""Local username/password auth stored in SQLite (data/auth.sqlite, separate from the ERP data).

- Passwords: scrypt (stdlib), per-user random salt, constant-time compare.
- Sessions: 256-bit random token in an HttpOnly, SameSite=Lax cookie; only its SHA-256 is stored.
- Brute force: max 5 failed sign-ins per email+IP in 15 minutes.

Manage accounts with:  uv run python -m erp_api.users --help
Set ERP_AUTH_DISABLED=1 to run without auth (local experiments only).
"""
import base64
import hashlib
import hmac
import os
import secrets
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import Cookie, HTTPException, Request

ROOT = Path(__file__).resolve().parents[2]
AUTH_DB = Path(os.environ.get("ERP_AUTH_DB", ROOT / "data" / "auth.sqlite")).resolve()
COOKIE = "aerp_session"
SESSION_TTL = timedelta(days=7)
MAX_FAILS, FAIL_WINDOW = 5, 15 * 60

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    user_id       INTEGER PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    is_active     INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL,
    last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    user_agent TEXT
);
CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(user_id);
"""


def now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def connect() -> sqlite3.Connection:
    AUTH_DB.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(AUTH_DB, timeout=5)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.executescript(SCHEMA)
    return con


def auth_disabled() -> bool:
    return os.environ.get("ERP_AUTH_DISABLED") == "1"


# ---------------------------------------------------------------- passwords
_N, _R, _P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    b64 = lambda b: base64.b64encode(b).decode()
    return f"scrypt${_N}${_R}${_P}${b64(salt)}${b64(dk)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, dk = stored.split("$")
        got = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(got, base64.b64decode(dk))
    except (ValueError, TypeError):
        return False


_DUMMY_HASH = hash_password(secrets.token_urlsafe(16))  # equalises timing for unknown emails


def validate_password(password: str):
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters")


# ---------------------------------------------------------------- users
def public_user(row) -> dict:
    return {"id": row["user_id"], "email": row["email"], "display_name": row["display_name"], "role": row["role"]}


def create_user(email: str, password: str, display_name: str | None = None, role: str = "user") -> dict:
    validate_password(password)
    email = email.strip().lower()
    if "@" not in email:
        raise ValueError("Invalid email")
    with connect() as con:
        try:
            cur = con.execute("INSERT INTO users (email, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)",
                              (email, display_name, hash_password(password), role, now().isoformat()))
        except sqlite3.IntegrityError:
            raise ValueError(f"User {email} already exists")
        return public_user(con.execute("SELECT * FROM users WHERE user_id = ?", (cur.lastrowid,)).fetchone())


def set_password(email: str, password: str):
    validate_password(password)
    with connect() as con:
        row = con.execute("SELECT user_id FROM users WHERE email = ?", (email.strip(),)).fetchone()
        if not row:
            raise ValueError(f"No user {email}")
        con.execute("UPDATE users SET password_hash = ? WHERE user_id = ?", (hash_password(password), row["user_id"]))
        con.execute("DELETE FROM sessions WHERE user_id = ?", (row["user_id"],))  # sign out everywhere


# ---------------------------------------------------------------- rate limiting (in-process)
_fails: dict[str, list[float]] = {}
_lock = threading.Lock()


def _recent_fails(key: str) -> list[float]:
    cutoff = time.monotonic() - FAIL_WINDOW
    return [t for t in _fails.get(key, []) if t > cutoff]


def check_rate_limit(key: str):
    with _lock:
        _fails[key] = _recent_fails(key)
        if len(_fails[key]) >= MAX_FAILS:
            raise HTTPException(429, "Too many failed sign-in attempts. Try again in 15 minutes.")


def record_failure(key: str):
    with _lock:
        _fails.setdefault(key, []).append(time.monotonic())


def clear_failures(key: str):
    with _lock:
        _fails.pop(key, None)


# ---------------------------------------------------------------- sessions
def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def authenticate(email: str, password: str) -> dict | None:
    with connect() as con:
        row = con.execute("SELECT * FROM users WHERE email = ? AND is_active = 1", (email.strip(),)).fetchone()
        if not row:
            verify_password(password, _DUMMY_HASH)
            return None
        if not verify_password(password, row["password_hash"]):
            return None
        con.execute("UPDATE users SET last_login_at = ? WHERE user_id = ?", (now().isoformat(), row["user_id"]))
        return public_user(row)


def create_session(user_id: int, user_agent: str | None) -> tuple[str, datetime]:
    token = secrets.token_urlsafe(32)
    expires = now() + SESSION_TTL
    with connect() as con:
        con.execute("DELETE FROM sessions WHERE expires_at < ?", (now().isoformat(),))
        con.execute("INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?,?,?,?,?)",
                    (_token_hash(token), user_id, now().isoformat(), expires.isoformat(), (user_agent or "")[:200]))
    return token, expires


def session_user(token: str | None) -> dict | None:
    if not token:
        return None
    with connect() as con:
        row = con.execute("""SELECT u.* FROM sessions s JOIN users u USING (user_id)
                             WHERE s.token_hash = ? AND s.expires_at > ? AND u.is_active = 1""",
                          (_token_hash(token), now().isoformat())).fetchone()
        return public_user(row) if row else None


def delete_session(token: str | None):
    if token:
        with connect() as con:
            con.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))


# ---------------------------------------------------------------- FastAPI dependency
def require_user(request: Request, aerp_session: str | None = Cookie(default=None)) -> dict:
    if auth_disabled():
        return {"id": 0, "email": "anonymous@local", "display_name": "Anonymous", "role": "admin"}
    user = session_user(aerp_session)
    if not user:
        raise HTTPException(401, "Sign in required")
    request.state.user = user
    return user
