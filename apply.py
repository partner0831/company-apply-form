#!/usr/bin/env python3
"""
Submit a job application to the company's apply endpoint.

Bearer token: SHA-256 of your email (trimmed, lowercased), hex-encoded.

Usage:
  pip install -r requirements.txt
  copy .env.example .env   # then edit .env
  python apply.py

Or pass values on the command line:
  python apply.py --name "Jane Doe" --email jane@example.com --github janedoe --resume resume.pdf
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

APPLY_URL = "https://kibjbsigxbqpfhqqarbo.supabase.co/functions/v1/apply"
MAX_RESUME_BYTES = 5 * 1024 * 1024  # 5 MB


def load_dotenv(path: Path) -> None:
    """Load KEY=value lines from a .env file into os.environ (no quotes required)."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if value and key not in os.environ:
            os.environ[key] = value


def bearer_token_from_email(email: str) -> str:
    normalized = email.strip().lower()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def validate_resume(path: Path) -> None:
    if not path.is_file():
        raise FileNotFoundError(f"Resume not found: {path}")
    if path.suffix.lower() != ".pdf":
        raise ValueError("Resume must be a PDF file (.pdf)")
    size = path.stat().st_size
    if size > MAX_RESUME_BYTES:
        mb = size / (1024 * 1024)
        raise ValueError(f"Resume is {mb:.2f} MB; maximum is 5 MB")


def submit(
    name: str,
    email: str,
    github_username: str,
    resume_path: Path,
    *,
    dry_run: bool = False,
) -> requests.Response | None:
    validate_resume(resume_path)
    token = bearer_token_from_email(email)

    headers = {
        "Authorization": f"Bearer {token}",
        "X-Applicant-Tool": "company-apply/1.0",
        "X-Submitted-At": datetime.now(timezone.utc).isoformat(),
        "X-GitHub": github_username,
    }

    data = {
        "name": name.strip(),
        "email": email.strip(),
        "github_username": github_username.strip().lstrip("@"),
    }

    print(f"Endpoint: {APPLY_URL}")
    print(f"Email:    {data['email']}")
    print(f"GitHub:   {data['github_username']}")
    print(f"Resume:   {resume_path} ({resume_path.stat().st_size:,} bytes)")
    print(f"Token:    sha256(email) -> {token[:16]}...{token[-8:]}")

    if dry_run:
        print("\nDry run — request not sent.")
        return None

    with resume_path.open("rb") as f:
        files = {"resume": (resume_path.name, f, "application/pdf")}
        response = requests.post(
            APPLY_URL,
            headers=headers,
            data=data,
            files=files,
            timeout=120,
        )

    print(f"\nStatus: {response.status_code}")
    print(f"Body:   {response.text}")

    if response.status_code == 201:
        print("\nApplication submitted successfully.")
    else:
        print("\nSubmission failed. Check the response above.", file=sys.stderr)
        sys.exit(1)

    return response


def parse_args() -> argparse.Namespace:
    script_dir = Path(__file__).resolve().parent
    load_dotenv(script_dir / ".env")

    parser = argparse.ArgumentParser(
        description="Submit your application (PDF resume, max 5 MB)."
    )
    parser.add_argument("--name", default=os.environ.get("APPLY_NAME"), help="Full name")
    parser.add_argument("--email", default=os.environ.get("APPLY_EMAIL"), help="Email address")
    parser.add_argument(
        "--github",
        default=os.environ.get("APPLY_GITHUB"),
        dest="github_username",
        help="GitHub username (no @)",
    )
    parser.add_argument(
        "--resume",
        default=os.environ.get("APPLY_RESUME"),
        type=Path,
        help="Path to resume PDF",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate inputs and show token preview without POSTing",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    missing = [
        flag
        for flag, val in (
            ("--name", args.name),
            ("--email", args.email),
            ("--github", args.github_username),
            ("--resume", args.resume),
        )
        if not val
    ]
    if missing:
        print(
            "Missing required fields. Set them in .env (see .env.example) or pass:\n"
            "  --name  --email  --github  --resume\n"
            f"Missing: {', '.join(missing)}",
            file=sys.stderr,
        )
        sys.exit(2)

    try:
        submit(
            args.name,
            args.email,
            args.github_username,
            Path(args.resume).expanduser().resolve(),
            dry_run=args.dry_run,
        )
    except (FileNotFoundError, ValueError) as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
