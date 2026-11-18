"""Account admin CLI for A-ERP's local SQLite auth.

  uv run python -m erp_api.users create --email tester@a-erp.test [--password ...] [--name "Test User"] [--admin]
  uv run python -m erp_api.users list
  uv run python -m erp_api.users set-password --email tester@a-erp.test [--password ...]
  uv run python -m erp_api.users disable --email tester@a-erp.test
Omit --password to generate a strong one (printed once).
"""
import argparse
import secrets
import string
import sys

from .auth import AUTH_DB, connect, create_user, set_password


def gen_password() -> str:
    alphabet = string.ascii_letters + string.digits
    return "Erp-" + "".join(secrets.choice(alphabet) for _ in range(14))


def main(argv=None):
    ap = argparse.ArgumentParser(prog="erp_api.users", description=f"Manage A-ERP accounts ({AUTH_DB})")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("create")
    c.add_argument("--email", required=True)
    c.add_argument("--password")
    c.add_argument("--name")
    c.add_argument("--admin", action="store_true")
    sub.add_parser("list")
    sp = sub.add_parser("set-password")
    sp.add_argument("--email", required=True)
    sp.add_argument("--password")
    d = sub.add_parser("disable")
    d.add_argument("--email", required=True)
    args = ap.parse_args(argv)

    try:
        if args.cmd == "create":
            pw = args.password or gen_password()
            u = create_user(args.email, pw, args.name, "admin" if args.admin else "user")
            print(f"Created {u['role']} {u['email']} (id {u['id']})")
            if not args.password:
                print(f"Password: {pw}")
        elif args.cmd == "set-password":
            pw = args.password or gen_password()
            set_password(args.email, pw)
            print(f"Password updated for {args.email}; existing sessions signed out")
            if not args.password:
                print(f"Password: {pw}")
        elif args.cmd == "disable":
            with connect() as con:
                n = con.execute("UPDATE users SET is_active = 0 WHERE email = ?", (args.email,)).rowcount
                con.execute("DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM users WHERE email = ?)", (args.email,))
            print(f"Disabled {args.email}" if n else f"No user {args.email}")
        else:
            with connect() as con:
                rows = con.execute("SELECT user_id, email, display_name, role, is_active, last_login_at FROM users ORDER BY user_id").fetchall()
            for r in rows:
                print(f"{r['user_id']:>3}  {r['email']:<32} {r['role']:<6} {'active' if r['is_active'] else 'disabled':<9} last login: {r['last_login_at'] or '—'}")
            if not rows:
                print("No users yet")
    except ValueError as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
