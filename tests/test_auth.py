"""Local SQLite auth: password hashing, sessions, rate limiting, and the HTTP flow end to end."""
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from erp_api import auth
from erp_api.app import app

EMAIL, PASSWORD = "tester@a-erp.test", "Correct-Horse-9"


class AuthTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.patches = [mock.patch.object(auth, "AUTH_DB", Path(self.tmp.name) / "auth.sqlite"),
                        mock.patch.dict("os.environ", {"ERP_AUTH_DISABLED": ""})]
        for p in self.patches:
            p.start()
        auth._fails.clear()
        auth.create_user(EMAIL, PASSWORD, "Test User")

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()


class PasswordAndSessionTest(AuthTestCase):
    def test_password_is_hashed_not_stored(self):
        with sqlite3.connect(auth.AUTH_DB) as con:
            stored = con.execute("SELECT password_hash FROM users").fetchone()[0]
        self.assertTrue(stored.startswith("scrypt$"))
        self.assertNotIn(PASSWORD, stored)

    def test_authenticate(self):
        self.assertEqual(auth.authenticate(EMAIL.upper(), PASSWORD)["email"], EMAIL)  # email is case-insensitive
        self.assertIsNone(auth.authenticate(EMAIL, "wrong-password"))
        self.assertIsNone(auth.authenticate("nobody@a-erp.test", PASSWORD))

    def test_duplicate_and_weak_passwords_rejected(self):
        with self.assertRaises(ValueError):
            auth.create_user(EMAIL, "Another-Pass-1")
        with self.assertRaises(ValueError):
            auth.create_user("x@a-erp.test", "short")

    def test_session_token_stored_hashed_and_expires(self):
        user = auth.authenticate(EMAIL, PASSWORD)
        token, _ = auth.create_session(user["id"], "ua")
        self.assertEqual(auth.session_user(token)["email"], EMAIL)
        with sqlite3.connect(auth.AUTH_DB) as con:
            self.assertNotIn(token, [r[0] for r in con.execute("SELECT token_hash FROM sessions")])
            con.execute("UPDATE sessions SET expires_at = '2000-01-01T00:00:00+00:00'")
        self.assertIsNone(auth.session_user(token))

    def test_password_change_revokes_sessions(self):
        token, _ = auth.create_session(auth.authenticate(EMAIL, PASSWORD)["id"], None)
        auth.set_password(EMAIL, "Brand-New-Pass-2")
        self.assertIsNone(auth.session_user(token))
        self.assertIsNotNone(auth.authenticate(EMAIL, "Brand-New-Pass-2"))


class HttpFlowTest(AuthTestCase):
    def setUp(self):
        super().setUp()
        self.client = TestClient(app)

    def test_data_requires_sign_in(self):
        self.assertEqual(self.client.get("/api/meta").status_code, 401)
        self.assertEqual(self.client.get("/api/health").status_code, 200)

    def test_login_cookie_access_logout(self):
        r = self.client.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
        self.assertEqual(r.status_code, 200)
        cookie = r.headers["set-cookie"].lower()
        self.assertIn("httponly", cookie)
        self.assertIn("samesite=lax", cookie)
        self.assertEqual(self.client.get("/api/auth/me").json()["email"], EMAIL)
        self.assertEqual(self.client.get("/api/meta").status_code, 200)
        self.assertEqual(self.client.post("/api/auth/logout").status_code, 204)
        self.assertEqual(self.client.get("/api/auth/me").status_code, 401)

    def test_wrong_password_and_rate_limit(self):
        for _ in range(auth.MAX_FAILS):
            self.assertEqual(self.client.post("/api/auth/login", json={"email": EMAIL, "password": "nope"}).status_code, 401)
        # locked out — even the correct password is refused until the window passes
        self.assertEqual(self.client.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD}).status_code, 429)


if __name__ == "__main__":
    unittest.main()
