#!/usr/bin/env python3
"""Reproducibly append the cluster's 1,000 load-test identities to local Dex."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent
# Public test credential from the stress-test chart: bcrypt("password").
PASSWORD_HASH = "$2b$10$5Rxvgiu278hWgHFWFpPIye7P61wmRptKhtqcHN6iYRBOnXdfZlcE2"


def generate() -> str:
    config = (ROOT / "dex-config.yml").read_text().rstrip() + "\n"
    for number in range(1, 1001):
        username = f"user-{number:04d}"
        config += (
            f'\n  - email: "{username}@example.com"\n'
            f'    hash: "{PASSWORD_HASH}"\n'
            f'    username: "{username}"\n'
            f'    userID: "{username}"\n'
        )
    return config


if __name__ == "__main__":
    output = ROOT / "dex-config.generated.yml"
    output.write_text(generate())
    print(f"Generated {output} with 1,000 stress-test accounts plus development accounts")
