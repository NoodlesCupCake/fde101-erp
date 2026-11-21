"""Supabase Auth for the API: every data request must carry a valid Supabase access token.

- The React app signs in with Supabase (supabase-js) and sends `Authorization: Bearer <access_token>`.
- The API verifies the token itself: signature against the project's public JWKS (no secrets needed),
  issuer, audience 'authenticated', and expiry. A login page alone protects nothing.
- Accounts are managed in the Supabase dashboard (Authentication → Users). Public sign-up is disabled
  in supabase/config.toml, so only users an admin creates can get in.

Config: SUPABASE_URL env var, else VITE_SUPABASE_URL from web/.env.local (the same file the web app uses).
Set ERP_AUTH_DISABLED=1 to run without auth (local experiments only).
"""
import os
from functools import lru_cache
from pathlib import Path

import jwt
from fastapi import HTTPException, Request

ROOT = Path(__file__).resolve().parents[2]
WEB_ENV = ROOT / "web" / ".env.local"
ALGORITHMS = ["ES256", "RS256"]  # Supabase asymmetric signing keys
AUDIENCE = "authenticated"


def auth_disabled() -> bool:
    return os.environ.get("ERP_AUTH_DISABLED") == "1"


@lru_cache
def supabase_url() -> str:
    url = os.environ.get("SUPABASE_URL")
    if not url and WEB_ENV.exists():
        for line in WEB_ENV.read_text(encoding="utf-8").splitlines():
            key, _, value = line.partition("=")
            if key.strip() == "VITE_SUPABASE_URL":
                url = value.strip().strip('"').strip("'")
    if not url:
        raise HTTPException(503, "Auth is not configured: set SUPABASE_URL or VITE_SUPABASE_URL in web/.env.local")
    return url.rstrip("/")


@lru_cache
def jwks_client() -> jwt.PyJWKClient:
    # Keys are cached in-process; an unknown `kid` (key rotation) triggers a refetch.
    return jwt.PyJWKClient(f"{supabase_url()}/auth/v1/.well-known/jwks.json", cache_keys=True, lifespan=3600)


def verify_token(token: str) -> dict:
    try:
        key = jwks_client().get_signing_key_from_jwt(token).key
        return jwt.decode(token, key, algorithms=ALGORITHMS, audience=AUDIENCE,
                          issuer=f"{supabase_url()}/auth/v1", options={"require": ["exp", "sub"]})
    except jwt.PyJWKClientConnectionError:
        raise HTTPException(503, "Can't reach Supabase to verify the sign-in")
    except jwt.PyJWTError:
        raise HTTPException(401, "Sign in required")


def public_user(claims: dict) -> dict:
    meta = claims.get("user_metadata") or {}
    role = (claims.get("app_metadata") or {}).get("role")  # set by an admin, never by the user
    return {"id": claims["sub"], "email": claims.get("email"),
            "display_name": meta.get("display_name") or meta.get("full_name") or meta.get("name"),
            "role": "admin" if role == "admin" else "user"}


# ---------------------------------------------------------------- FastAPI dependency
def require_user(request: Request) -> dict:
    if auth_disabled():
        return {"id": "anonymous", "email": "anonymous@local", "display_name": "Anonymous", "role": "admin"}
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(401, "Sign in required")
    user = public_user(verify_token(token))
    request.state.user = user
    return user
