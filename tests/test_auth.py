"""Supabase token verification on the API, end to end over HTTP.

Tokens are signed with a throwaway EC key that stands in for the project's JWKS, so no network is needed.
"""
import time
import unittest
from types import SimpleNamespace
from unittest import mock

import jwt
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from erp_api import auth
from erp_api.app import app

URL = "https://example-project.supabase.co"
KEY = ec.generate_private_key(ec.SECP256R1())
OTHER_KEY = ec.generate_private_key(ec.SECP256R1())


def token(key=KEY, **overrides) -> str:
    claims = {"sub": "0b9c-user", "email": "tester@a-erp.test", "aud": "authenticated", "role": "authenticated",
              "iss": f"{URL}/auth/v1", "exp": int(time.time()) + 3600,
              "user_metadata": {"display_name": "Test User"}, "app_metadata": {}}
    claims.update(overrides)
    return jwt.encode(claims, key, algorithm="ES256", headers={"kid": "test"})


class SupabaseAuthTest(unittest.TestCase):
    def setUp(self):
        fake_jwks = SimpleNamespace(get_signing_key_from_jwt=lambda _t: SimpleNamespace(key=KEY.public_key()))
        self.patches = [mock.patch.object(auth, "supabase_url", lambda: URL),
                        mock.patch.object(auth, "jwks_client", lambda: fake_jwks),
                        mock.patch.dict("os.environ", {"ERP_AUTH_DISABLED": ""})]
        for p in self.patches:
            p.start()
        self.client = TestClient(app)

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def get(self, path, tok=None):
        return self.client.get(path, headers={"Authorization": f"Bearer {tok}"} if tok else {})

    def test_health_is_public_data_is_not(self):
        self.assertEqual(self.get("/api/health").status_code, 200)
        self.assertEqual(self.get("/api/meta").status_code, 401)
        self.assertEqual(self.get("/api/auth/me").status_code, 401)

    def test_valid_token(self):
        r = self.get("/api/auth/me", token())
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"id": "0b9c-user", "email": "tester@a-erp.test", "display_name": "Test User", "role": "user"})

    def test_role_comes_only_from_app_metadata(self):
        self.assertEqual(self.get("/api/auth/me", token(user_metadata={"role": "admin"})).json()["role"], "user")
        self.assertEqual(self.get("/api/auth/me", token(app_metadata={"role": "admin"})).json()["role"], "admin")

    def test_rejected_tokens(self):
        bad = {
            "expired": token(exp=int(time.time()) - 60),
            "wrong audience": token(aud="anon"),
            "wrong issuer": token(iss="https://evil.supabase.co/auth/v1"),
            "forged signature": token(key=OTHER_KEY),
            "garbage": "not-a-jwt",
        }
        for name, tok in bad.items():
            with self.subTest(name):
                self.assertEqual(self.get("/api/auth/me", tok).status_code, 401)

    def test_unsigned_token_rejected(self):
        unsigned = jwt.encode({"sub": "x", "aud": "authenticated", "iss": f"{URL}/auth/v1",
                               "exp": int(time.time()) + 60}, None, algorithm="none")
        self.assertEqual(self.get("/api/auth/me", unsigned).status_code, 401)


if __name__ == "__main__":
    unittest.main()
