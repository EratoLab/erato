#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# ///

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import secrets
import shutil
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlparse


OFFICE_ADDIN_PORT = 3002
AUTH_PROXY_PORT = 4181
FUNNEL_TARGET_PORT = AUTH_PROXY_PORT
SCRIPT_PATH = Path(__file__).resolve()
OFFICE_ADDIN_DIR = SCRIPT_PATH.parent.parent
FRONTEND_DIR = OFFICE_ADDIN_DIR.parent / "frontend"
FRONTEND_PUBLIC_DIR = FRONTEND_DIR / "public"
FRONTEND_SOURCE_LOCALES_DIR = FRONTEND_DIR / "src" / "locales"
FRONTEND_TARBALL_PATH = FRONTEND_DIR / "dist-package" / "erato-frontend.tgz"
FRONTEND_PACKAGE_STATE_PATH = (
    FRONTEND_DIR / "dist-package" / "erato-frontend.state.json"
)
FRONTEND_LIBRARY_ENTRY_PATH = FRONTEND_DIR / "dist-library" / "library.js"
FRONTEND_LIBRARY_CSS_PATH = FRONTEND_DIR / "dist-library" / "style.css"
FRONTEND_APP_BUILD_WATCH_POLL_SECONDS = 1.0
FRONTEND_APP_BUILD_WATCH_FILES = (
    FRONTEND_DIR / "lingui.config.ts",
    FRONTEND_DIR / "vite.config.ts",
)
INSTALLED_FRONTEND_LIBRARY_ENTRY_PATH = (
    OFFICE_ADDIN_DIR
    / "node_modules"
    / "@erato"
    / "frontend"
    / "dist-library"
    / "library.js"
)
LOCAL_AUTH_DIR = OFFICE_ADDIN_DIR / "local-auth"
VITE_BIN_PATH = OFFICE_ADDIN_DIR / "node_modules" / ".bin" / "vite"
VITE_CACHE_DIR = OFFICE_ADDIN_DIR / "node_modules" / ".vite"
MANIFEST_LOCAL_PATH = OFFICE_ADDIN_DIR / "manifests" / "manifest-local.xml"
MANIFEST_FUNNEL_PATH = OFFICE_ADDIN_DIR / "manifests" / "manifest-funnel.xml"
ENTRA_TEMPLATE_PATH = LOCAL_AUTH_DIR / "oauth2-proxy-entra-id.template.cfg"
ENTRA_CONFIG_PATH = LOCAL_AUTH_DIR / "oauth2-proxy-entra-id.cfg"
REQUIRED_COMMANDS = ("docker", "pnpm", "tailscale")
EXPECTED_OAUTH2_PROXY_UPSTREAMS = """upstreams = [
    "http://localhost:3130/public/common/#/public/common/",
    "http://localhost:3002/office-addin/#/",
    "http://localhost:3130/office-addin/manifest.xml#/office-addin/manifest.xml",
    "http://localhost:3130/api/#/api/"
]"""


def run_command(
    command: list[str],
    *,
    cwd: Path | None = None,
    capture_output: bool = False,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=cwd,
        check=check,
        capture_output=capture_output,
        text=True,
    )


def print_process_output(output: str | None) -> None:
    if not output:
        return

    for line in output.splitlines():
        if line.strip():
            print(line)


def run_quiet_command(
    command: list[str],
    *,
    cwd: Path | None = None,
    success_message: str | None = None,
    print_stdout_on_success: bool = False,
    print_stderr_on_success: bool = True,
) -> subprocess.CompletedProcess[str]:
    result = run_command(
        command,
        cwd=cwd,
        capture_output=True,
        check=False,
    )

    if result.returncode != 0:
        print_process_output(result.stdout)
        print_process_output(result.stderr)
        raise subprocess.CalledProcessError(
            result.returncode,
            command,
            output=result.stdout,
            stderr=result.stderr,
        )

    if print_stdout_on_success:
        print_process_output(result.stdout)
    if print_stderr_on_success:
        print_process_output(result.stderr)
    if success_message:
        print(success_message)

    return result


def require_command(name: str) -> None:
    if shutil.which(name) is None:
        print(f"Missing required command: {name}", file=sys.stderr)
        sys.exit(1)


def read_required_value(label: str, env_names: tuple[str, ...]) -> str:
    for env_name in env_names:
        value = os.environ.get(env_name)
        if value:
            return value

    if not sys.stdin.isatty():
        joined_names = ", ".join(env_names)
        print(
            f"{label} is required. Set one of: {joined_names}",
            file=sys.stderr,
        )
        sys.exit(1)

    return input(f"{label}: ").strip()


def ensure_entra_proxy_config() -> None:
    if ENTRA_CONFIG_PATH.exists():
        sync_entra_proxy_upstreams()
        return

    template = ENTRA_TEMPLATE_PATH.read_text(encoding="utf-8")
    tenant_id = read_required_value(
        "Entra tenant ID",
        ("ERATO_ENTRA_TENANT_ID", "ENTRA_TENANT_ID", "AZURE_TENANT_ID"),
    )
    client_id = read_required_value(
        "Entra client ID",
        ("ERATO_ENTRA_CLIENT_ID", "ENTRA_CLIENT_ID", "AZURE_CLIENT_ID"),
    )
    client_secret = read_required_value(
        "Entra client secret",
        (
            "ERATO_ENTRA_CLIENT_SECRET",
            "ENTRA_CLIENT_SECRET",
            "AZURE_CLIENT_SECRET",
        ),
    )
    cookie_secret = base64.b64encode(secrets.token_bytes(32)).decode("ascii")

    rendered = (
        template.replace("{{TENANT_ID}}", tenant_id)
        .replace("{{CLIENT_ID}}", client_id)
        .replace("{{CLIENT_SECRET}}", client_secret)
        .replace("{{COOKIE_SECRET}}", cookie_secret)
    )

    ENTRA_CONFIG_PATH.write_text(rendered, encoding="utf-8")
    ENTRA_CONFIG_PATH.chmod(0o600)
    sync_entra_proxy_upstreams()
    print(f"Generated {ENTRA_CONFIG_PATH.relative_to(OFFICE_ADDIN_DIR)}")


def sync_entra_proxy_upstreams() -> None:
    config_text = ENTRA_CONFIG_PATH.read_text(encoding="utf-8")
    updated_config_text, replacements = re.subn(
        r"upstreams\s*=\s*\[(?:.|\n)*?\]",
        EXPECTED_OAUTH2_PROXY_UPSTREAMS,
        config_text,
        count=1,
    )

    if replacements == 0 or updated_config_text == config_text:
        return

    ENTRA_CONFIG_PATH.write_text(updated_config_text, encoding="utf-8")
    print("Updated oauth2-proxy upstreams for add-in manifest routing")


def start_auth_proxy() -> None:
    run_quiet_command(
        [
            "docker",
            "compose",
            "up",
            "--force-recreate",
            "--detach",
            "--remove-orphans",
        ],
        cwd=LOCAL_AUTH_DIR,
        print_stderr_on_success=False,
    )
    print(f"Auth proxy available at http://localhost:{AUTH_PROXY_PORT}")


def load_funnel_status() -> dict:
    result = run_command(
        ["tailscale", "funnel", "status", "--json"],
        capture_output=True,
    )
    return json.loads(result.stdout)


def extract_funnel_proxy_port(status: dict) -> int | None:
    web = status.get("Web", {})
    for host_config in web.values():
        handlers = host_config.get("Handlers", {})
        for handler in handlers.values():
            proxy = handler.get("Proxy")
            if not proxy:
                continue

            parsed = urlparse(proxy)
            if parsed.port is not None:
                return parsed.port
    return None


def extract_funnel_url(status: dict) -> str | None:
    web = status.get("Web", {})
    for host in web:
        display_host = host.removesuffix(":443")
        return f"https://{display_host}/"
    return None


def load_redirect_url() -> str | None:
    if not ENTRA_CONFIG_PATH.exists():
        return None

    for raw_line in ENTRA_CONFIG_PATH.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line.startswith("redirect_url"):
            continue

        _, _, value = line.partition("=")
        redirect_url = value.strip().strip('"')
        return redirect_url or None

    return None


def build_redirect_status_message(funnel_url: str) -> str:
    redirect_url = load_redirect_url()
    if not redirect_url:
        return "Warning: redirect_url is missing from oauth2-proxy-entra-id.cfg"

    expected_redirect_url = f"{funnel_url}oauth2/callback"
    if redirect_url == expected_redirect_url:
        return f"redirect_url aligns with funnel URL ({redirect_url})"

    return (
        "Warning: redirect_url does not match funnel URL "
        f"({redirect_url} != {expected_redirect_url})"
    )


def write_funnel_manifest(funnel_url: str) -> None:
    manifest_contents = MANIFEST_LOCAL_PATH.read_text(encoding="utf-8")
    updated_contents = manifest_contents.replace(
        "https://localhost:3002",
        funnel_url.rstrip("/"),
    )
    MANIFEST_FUNNEL_PATH.write_text(updated_contents, encoding="utf-8")


def funnel_is_correct(status: dict) -> bool:
    if not any(status.get("AllowFunnel", {}).values()):
        return False

    return extract_funnel_proxy_port(status) == FUNNEL_TARGET_PORT


def ensure_funnel() -> None:
    try:
        status = load_funnel_status()
    except subprocess.CalledProcessError as error:
        print(error.stderr, file=sys.stderr)
        raise

    if funnel_is_correct(status):
        proxy_port = extract_funnel_proxy_port(status)
        print(f"Tailscale funnel already targets localhost:{proxy_port}")
        return

    print(f"Updating Tailscale funnel to localhost:{FUNNEL_TARGET_PORT}")
    run_command(
        ["tailscale", "funnel", "--bg", str(FUNNEL_TARGET_PORT)],
        capture_output=True,
    )

    updated_status = load_funnel_status()
    if not funnel_is_correct(updated_status):
        print(
            "Tailscale funnel did not settle on the expected port",
            file=sys.stderr,
        )
        sys.exit(1)


def print_funnel_url() -> None:
    status = load_funnel_status()
    funnel_url = extract_funnel_url(status)
    if not funnel_url:
        print("Could not determine Tailscale funnel URL", file=sys.stderr)
        return

    write_funnel_manifest(funnel_url)
    redirect_status = build_redirect_status_message(funnel_url)

    lines = [
        "Public Tailscale URL",
        funnel_url,
        "",
        redirect_status,
        "",
        ("Upload manifests/manifest-funnel.xml via https://aka.ms/olksideload"),
    ]
    width = max(len(line) for line in lines) + 4
    border = "#" * width

    print(border)
    for line in lines:
        print(f"# {line.ljust(width - 4)} #")
    print(border)


def install_packaged_frontend() -> None:
    result = run_command(
        [
            "pnpm",
            "install",
            "--no-frozen-lockfile",
            "--lockfile=false",
            "--loglevel=error",
        ],
        cwd=OFFICE_ADDIN_DIR,
        capture_output=True,
    )
    if result.stderr:
        print(result.stderr.rstrip())


def clear_vite_cache() -> None:
    shutil.rmtree(VITE_CACHE_DIR, ignore_errors=True)


def wait_for_generated_path(
    path: Path,
    producer: subprocess.Popen[str],
    *,
    timeout_seconds: int = 60,
) -> None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        if path.exists():
            return

        return_code = producer.poll()
        if return_code is not None:
            print(
                f"Process exited with code {return_code}: {producer.args}",
                file=sys.stderr,
            )
            sys.exit(return_code or 1)

        time.sleep(0.5)

    print(
        f"Timed out waiting for {path.relative_to(FRONTEND_DIR.parent)}",
        file=sys.stderr,
    )
    sys.exit(1)


def wait_for_packaged_frontend(
    frontend_watch: subprocess.Popen[str],
    timeout_seconds: int = 60,
) -> None:
    wait_for_generated_path(
        FRONTEND_PACKAGE_STATE_PATH,
        frontend_watch,
        timeout_seconds=timeout_seconds,
    )
    wait_for_generated_path(
        FRONTEND_TARBALL_PATH,
        frontend_watch,
        timeout_seconds=timeout_seconds,
    )


def wait_for_linked_frontend(
    frontend_watch: subprocess.Popen[str],
    timeout_seconds: int = 60,
) -> None:
    wait_for_generated_path(
        FRONTEND_LIBRARY_ENTRY_PATH,
        frontend_watch,
        timeout_seconds=timeout_seconds,
    )
    wait_for_generated_path(
        FRONTEND_LIBRARY_CSS_PATH,
        frontend_watch,
        timeout_seconds=timeout_seconds,
    )


def clear_frontend_watch_outputs() -> None:
    FRONTEND_LIBRARY_ENTRY_PATH.unlink(missing_ok=True)
    FRONTEND_LIBRARY_CSS_PATH.unlink(missing_ok=True)
    FRONTEND_PACKAGE_STATE_PATH.unlink(missing_ok=True)
    FRONTEND_TARBALL_PATH.unlink(missing_ok=True)


def read_package_state() -> dict[str, str] | None:
    if not FRONTEND_PACKAGE_STATE_PATH.exists():
        return None

    try:
        return json.loads(FRONTEND_PACKAGE_STATE_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def compute_file_sha256(path: Path) -> str | None:
    if not path.exists():
        return None

    digest = hashlib.sha256()
    with path.open("rb") as file_handle:
        for chunk in iter(lambda: file_handle.read(1024 * 1024), b""):
            digest.update(chunk)

    return digest.hexdigest()


def build_frontend_app() -> None:
    print("Building frontend app output for backend-served assets")
    run_quiet_command(
        ["pnpm", "exec", "lingui", "compile"],
        cwd=FRONTEND_DIR,
        print_stderr_on_success=False,
    )
    run_quiet_command(
        ["pnpm", "exec", "tsc"],
        cwd=FRONTEND_DIR,
        print_stderr_on_success=False,
    )
    run_quiet_command(
        ["pnpm", "exec", "vite", "build", "--mode", "dev-linked", "--logLevel", "warn"],
        cwd=FRONTEND_DIR,
        print_stdout_on_success=True,
        print_stderr_on_success=True,
        success_message="Frontend app output ready",
    )


def path_has_hidden_segment(path: Path) -> bool:
    return any(part.startswith(".") for part in path.parts)


def should_watch_frontend_app_file(path: Path) -> bool:
    if path_has_hidden_segment(path.relative_to(FRONTEND_DIR)):
        return False

    if (
        path.name == "messages.json"
        and "locales" in path.parts
    ):
        return False

    return path.is_file()


def iter_frontend_app_watch_files() -> list[Path]:
    files: list[Path] = []

    for watch_file in FRONTEND_APP_BUILD_WATCH_FILES:
        if watch_file.exists():
            files.append(watch_file)

    for root in (FRONTEND_PUBLIC_DIR, FRONTEND_SOURCE_LOCALES_DIR):
        if not root.exists():
            continue

        for path in root.rglob("*"):
            if should_watch_frontend_app_file(path):
                files.append(path)

    return sorted(files)


def capture_frontend_app_watch_snapshot() -> dict[str, tuple[int, int]]:
    snapshot: dict[str, tuple[int, int]] = {}
    for file_path in iter_frontend_app_watch_files():
        stat_result = file_path.stat()
        snapshot[str(file_path.relative_to(FRONTEND_DIR))] = (
            stat_result.st_mtime_ns,
            stat_result.st_size,
        )

    return snapshot


class FrontendAppBuildWatcher:
    def __init__(self) -> None:
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        self._thread.join(timeout=5)

    def _run(self) -> None:
        baseline_snapshot = capture_frontend_app_watch_snapshot()

        while not self._stop_event.wait(FRONTEND_APP_BUILD_WATCH_POLL_SECONDS):
            current_snapshot = capture_frontend_app_watch_snapshot()
            if current_snapshot == baseline_snapshot:
                continue

            print(
                "Detected frontend public or locale source change, rebuilding frontend app",
            )
            snapshot_before_build = current_snapshot

            try:
                build_frontend_app()
            except subprocess.CalledProcessError as error:
                print(
                    f"Frontend app build failed with code {error.returncode}; waiting for more changes",
                    file=sys.stderr,
                )
                baseline_snapshot = snapshot_before_build
                continue

            snapshot_after_build = capture_frontend_app_watch_snapshot()
            if snapshot_after_build != snapshot_before_build:
                print(
                    "Frontend public or locale source changed during rebuild, scheduling another frontend app build",
                )
                baseline_snapshot = snapshot_before_build
                continue

            baseline_snapshot = snapshot_after_build


def spawn_frontend_watch() -> subprocess.Popen[str]:
    return subprocess.Popen(
        ["pnpm", "run", "build:lib:watch"],
        cwd=FRONTEND_DIR,
        text=True,
        start_new_session=True,
    )


def spawn_app_dev(mode: str, *, force_optimize: bool = False) -> subprocess.Popen[str]:
    command = [str(VITE_BIN_PATH), "--host"]
    if mode == "linked":
        command.extend(["--mode", "linked"])
    if force_optimize:
        command.append("--force")

    return subprocess.Popen(
        command,
        cwd=OFFICE_ADDIN_DIR,
        text=True,
        start_new_session=True,
    )


def terminate_process(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return

    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return

    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            return
        process.wait(timeout=5)


def wait_for_processes(
    frontend_watch: subprocess.Popen[str],
    app_dev: subprocess.Popen[str],
    *,
    mode: str,
) -> int:
    current_package_sha = None
    current_installed_library_sha = compute_file_sha256(
        INSTALLED_FRONTEND_LIBRARY_ENTRY_PATH,
    )
    initial_package_state = read_package_state()
    if initial_package_state is not None:
        current_package_sha = initial_package_state.get("sha256")

    try:
        while True:
            frontend_return_code = frontend_watch.poll()
            if frontend_return_code is not None:
                if frontend_return_code != 0:
                    print(
                        f"Process exited with code {frontend_return_code}: {frontend_watch.args}",
                        file=sys.stderr,
                    )
                return frontend_return_code

            if mode == "packaged":
                package_state = read_package_state()
                next_package_sha = (
                    package_state.get("sha256") if package_state else None
                )
                if next_package_sha and next_package_sha != current_package_sha:
                    print(
                        "Detected packaged frontend update, reinstalling office-addin"
                    )
                    install_packaged_frontend()
                    clear_vite_cache()
                    terminate_process(app_dev)
                    app_dev = spawn_app_dev(mode, force_optimize=True)
                    current_package_sha = next_package_sha
                    current_installed_library_sha = compute_file_sha256(
                        INSTALLED_FRONTEND_LIBRARY_ENTRY_PATH,
                    )

                next_installed_library_sha = compute_file_sha256(
                    INSTALLED_FRONTEND_LIBRARY_ENTRY_PATH,
                )
                if (
                    next_installed_library_sha
                    and next_installed_library_sha != current_installed_library_sha
                ):
                    print(
                        "Detected installed frontend library change, clearing Vite cache and restarting office-addin",
                    )
                    clear_vite_cache()
                    terminate_process(app_dev)
                    app_dev = spawn_app_dev(mode, force_optimize=True)
                    current_installed_library_sha = next_installed_library_sha

            app_return_code = app_dev.poll()
            if app_return_code is not None:
                if app_return_code != 0:
                    print(
                        f"Process exited with code {app_return_code}: {app_dev.args}",
                        file=sys.stderr,
                    )
                return app_return_code

            time.sleep(0.5)
    finally:
        terminate_process(frontend_watch)
        terminate_process(app_dev)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--mode",
        choices=("packaged", "linked"),
        default="packaged",
        help="How office-addin consumes the frontend library during development.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    for command in REQUIRED_COMMANDS:
        require_command(command)

    ensure_entra_proxy_config()
    start_auth_proxy()
    ensure_funnel()
    print_funnel_url()

    frontend_watch: subprocess.Popen[str] | None = None
    frontend_app_build_watcher: FrontendAppBuildWatcher | None = None
    app_dev: subprocess.Popen[str] | None = None

    def cleanup() -> None:
        if frontend_watch is not None:
            terminate_process(frontend_watch)
        if frontend_app_build_watcher is not None:
            frontend_app_build_watcher.stop()
        if app_dev is not None:
            terminate_process(app_dev)

    def handle_signal(signum: int, _frame: object) -> None:
        cleanup()
        raise SystemExit(0)

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    try:
        clear_frontend_watch_outputs()
        if args.mode == "packaged":
            frontend_watch = spawn_frontend_watch()
            wait_for_packaged_frontend(frontend_watch)
            install_packaged_frontend()
            clear_vite_cache()
            app_dev = spawn_app_dev(args.mode, force_optimize=True)
        else:
            build_frontend_app()
            frontend_watch = spawn_frontend_watch()
            wait_for_linked_frontend(frontend_watch)
            frontend_app_build_watcher = FrontendAppBuildWatcher()
            frontend_app_build_watcher.start()
            app_dev = spawn_app_dev(args.mode)

        assert frontend_watch is not None
        assert app_dev is not None
        return wait_for_processes(
            frontend_watch,
            app_dev,
            mode=args.mode,
        )
    except BaseException:
        cleanup()
        raise


if __name__ == "__main__":
    raise SystemExit(main())
