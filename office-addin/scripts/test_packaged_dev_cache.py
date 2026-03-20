#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve()
OFFICE_ADDIN_DIR = SCRIPT_PATH.parent.parent
REPO_ROOT = OFFICE_ADDIN_DIR.parent
FRONTEND_LIBRARY_INDEX = REPO_ROOT / "frontend" / "src" / "library" / "index.ts"
FRONTEND_PACKAGE_STATE = (
    REPO_ROOT / "frontend" / "dist-package" / "erato-frontend.state.json"
)
VITE_CACHE_ROOT = OFFICE_ADDIN_DIR / "node_modules" / ".vite"
SENTINEL_EXPORT = (
    'export { FilePreviewButton as DevCacheValidationExport } '
    'from "@/components/ui/FileUpload/FilePreviewButton";\n'
)
PACK_LIBRARY_LOG = "[pack-library] wrote"
PACKAGE_UPDATE_LOG = "Detected packaged frontend update, reinstalling office-addin"
INSTALLED_CHANGE_LOG = (
    "Detected installed frontend library change, clearing Vite cache and restarting office-addin"
)
FORCE_OPTIMIZE_LOG = "Forced re-optimization of dependencies"
STARTUP_READY_LOG = "Local:   http://localhost:3002/office-addin/"
TIMEOUT_SECONDS = 120


class ProcessMonitor:
    def __init__(self, process: subprocess.Popen[str]) -> None:
        self.process = process
        self.lines: list[str] = []
        self._lock = threading.Lock()
        self._thread = threading.Thread(target=self._read_output, daemon=True)
        self._thread.start()

    def _read_output(self) -> None:
        assert self.process.stdout is not None
        for raw_line in self.process.stdout:
            line = raw_line.rstrip("\n")
            with self._lock:
                self.lines.append(line)
            print(line)

    def snapshot(self) -> list[str]:
        with self._lock:
            return list(self.lines)

    def wait_for_line(self, pattern: str, *, timeout: float) -> bool:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.process.poll() is not None:
                break
            if any(pattern in line for line in self.snapshot()):
                return True
            time.sleep(0.25)
        return any(pattern in line for line in self.snapshot())

    def count_lines(self, pattern: str) -> int:
        return sum(1 for line in self.snapshot() if pattern in line)


def compute_sha256(path: Path) -> str | None:
    if not path.exists():
        return None

    digest = hashlib.sha256()
    with path.open("rb") as file_handle:
        for chunk in iter(lambda: file_handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def terminate_process(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return

    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return

    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            return
        process.wait(timeout=10)


def wait_for_package_sha_change(previous_sha: str | None, *, timeout: float) -> str:
    deadline = time.time() + timeout
    while time.time() < deadline:
        current_sha = compute_sha256(FRONTEND_PACKAGE_STATE)
        if current_sha and current_sha != previous_sha:
            return current_sha
        time.sleep(0.5)
    raise TimeoutError("Timed out waiting for frontend package state change")


def latest_optimized_library_path() -> Path:
    candidates = list(VITE_CACHE_ROOT.glob("deps*/@erato_frontend_library.js"))
    if not candidates:
        raise FileNotFoundError("Could not find optimized @erato/frontend/library output")

    return max(candidates, key=lambda path: path.stat().st_mtime)


def wait_for_optimized_library_path(*, timeout: float) -> Path:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            return latest_optimized_library_path()
        except FileNotFoundError:
            time.sleep(0.25)

    raise FileNotFoundError("Could not find optimized @erato/frontend/library output")


def export_block_contains(path: Path, export_name: str) -> bool:
    contents = path.read_text(encoding="utf-8")
    export_start = contents.rfind("export {")
    if export_start == -1:
        return False
    export_block = contents[export_start:]
    return export_name in export_block


def append_sentinel_export(original_contents: str) -> None:
    if SENTINEL_EXPORT in original_contents:
        raise RuntimeError("Sentinel export already present in frontend library index")

    FRONTEND_LIBRARY_INDEX.write_text(
        original_contents + SENTINEL_EXPORT,
        encoding="utf-8",
    )


def restore_frontend_library_index(original_contents: str) -> None:
    FRONTEND_LIBRARY_INDEX.write_text(original_contents, encoding="utf-8")


def run_validation() -> None:
    original_contents = FRONTEND_LIBRARY_INDEX.read_text(encoding="utf-8")
    process: subprocess.Popen[str] | None = None

    try:
        process = subprocess.Popen(
            ["just", "dev"],
            cwd=OFFICE_ADDIN_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            start_new_session=True,
        )
        monitor = ProcessMonitor(process)

        if not monitor.wait_for_line(STARTUP_READY_LOG, timeout=TIMEOUT_SECONDS):
            raise TimeoutError("Timed out waiting for office-addin dev server startup")

        initial_pack_count = monitor.count_lines(PACK_LIBRARY_LOG)
        deadline = time.time() + TIMEOUT_SECONDS
        while time.time() < deadline:
            if process.poll() is not None:
                break
            if monitor.count_lines(PACK_LIBRARY_LOG) > initial_pack_count:
                break
            time.sleep(0.25)

        baseline_package_sha = compute_sha256(FRONTEND_PACKAGE_STATE)
        if baseline_package_sha is None:
            raise TimeoutError("Timed out waiting for initial frontend package state")

        append_sentinel_export(original_contents)
        wait_for_package_sha_change(baseline_package_sha, timeout=TIMEOUT_SECONDS)
        force_optimize_count_after_sentinel_pack = monitor.count_lines(
            FORCE_OPTIMIZE_LOG,
        )
        deadline = time.time() + TIMEOUT_SECONDS
        while time.time() < deadline:
            if process.poll() is not None:
                break
            if (
                monitor.count_lines(FORCE_OPTIMIZE_LOG)
                > force_optimize_count_after_sentinel_pack
            ):
                break
            time.sleep(0.25)

        if (
            monitor.count_lines(FORCE_OPTIMIZE_LOG)
            <= force_optimize_count_after_sentinel_pack
        ):
            raise AssertionError(
                "Expected a forced Vite re-optimization after the sentinel package update",
            )

        optimized_library = wait_for_optimized_library_path(timeout=TIMEOUT_SECONDS)
        if not export_block_contains(optimized_library, "DevCacheValidationExport"):
            raise AssertionError(
                f"Optimized library wrapper did not include sentinel export: {optimized_library}",
            )

        print("")
        print("Validation succeeded.")
        print(f"Optimized wrapper: {optimized_library}")
        print(f"Forced re-optimization count: {monitor.count_lines(FORCE_OPTIMIZE_LOG)}")
    finally:
        restore_frontend_library_index(original_contents)
        if process is not None:
            terminate_process(process)


def main() -> int:
    try:
        run_validation()
    except Exception as error:  # noqa: BLE001
        print(f"Validation failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
