#!/usr/bin/env python3
"""Run with `python3 scripts/test_funnel_startup.py`; no network required."""

import contextlib
import io
import json
import subprocess
import unittest
from unittest.mock import patch

import dev


def completed(data=None, *, code=0, stdout="", stderr=""):
    return subprocess.CompletedProcess(
        args=[],
        returncode=code,
        stdout=json.dumps(data) if data is not None else stdout,
        stderr=stderr,
    )


def configured_funnel(port=4181):
    return {
        "Web": {
            "test.example.ts.net:443": {
                "Handlers": {"/": {"Proxy": f"http://127.0.0.1:{port}"}}
            }
        },
        "AllowFunnel": {"test.example.ts.net:443": True},
    }


class FunnelStartupTests(unittest.TestCase):
    def test_disconnected_profile_stops_before_reading_or_changing_funnel(self):
        for state in ("Stopped", "NeedsLogin"):
            with self.subTest(state=state), patch.object(
                dev.subprocess, "run", return_value=completed({"BackendState": state})
            ) as run, contextlib.redirect_stderr(io.StringIO()) as errors:
                with self.assertRaises(SystemExit) as exit:
                    dev.ensure_funnel()
                self.assertEqual(exit.exception.code, 1)
                self.assertEqual(run.call_count, 1)
                self.assertIn(state, errors.getvalue())
                self.assertIn("tailscale up", errors.getvalue())

    def test_connected_existing_funnel_is_not_reconfigured(self):
        with patch.object(
            dev.subprocess,
            "run",
            side_effect=[
                completed({"BackendState": "Running"}),
                completed(configured_funnel()),
            ],
        ) as run, contextlib.redirect_stdout(io.StringIO()) as output:
            dev.ensure_funnel()
            self.assertEqual(run.call_count, 2)
            self.assertIn("already targets localhost:4181", output.getvalue())

    def test_failed_update_exposes_tailscale_diagnostic_and_exits_cleanly(self):
        with patch.object(
            dev.subprocess,
            "run",
            side_effect=[
                completed({"BackendState": "Running"}),
                completed({}),
                completed(code=1, stdout="Enable Funnel first", stderr="access denied"),
            ],
        ), contextlib.redirect_stdout(io.StringIO()) as output, (
            contextlib.redirect_stderr(io.StringIO())
        ):
            with self.assertRaises(SystemExit) as exit:
                dev.ensure_funnel()
            self.assertEqual(exit.exception.code, 1)
            self.assertIn("Enable Funnel first", output.getvalue())
            self.assertIn("access denied", output.getvalue())

    def test_successful_update_is_verified(self):
        with patch.object(
            dev.subprocess,
            "run",
            side_effect=[
                completed({"BackendState": "Running"}),
                completed(configured_funnel(port=4180)),
                completed(),
                completed(configured_funnel()),
            ],
        ) as run, contextlib.redirect_stdout(io.StringIO()):
            dev.ensure_funnel()
            self.assertEqual(
                run.call_args_list[2].args[0], ["tailscale", "funnel", "--bg", "4181"]
            )


if __name__ == "__main__":
    unittest.main()
