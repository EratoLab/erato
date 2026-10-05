#!/usr/bin/env python3
"""Check the release executable's backtraces without build-directory sidecars.

Run on Linux with Python 3.11+ and the backend's pinned Rust toolchain.
"""

import difflib
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import tomllib


BACKEND = Path(__file__).resolve().parent
PROBE = """mod qualified {
    pub struct Typed<T>(pub T);
    impl<T: std::fmt::Debug> Typed<T> {
        #[inline(always)]
        fn inlined_frame(&self) {
            panic!("backtrace fidelity probe: {:?}", self.0);
        }
        #[inline(never)]
        pub fn outer_frame(&self) {
            self.inlined_frame();
        }
    }
}
fn main() {
    let callback = || qualified::Typed(std::hint::black_box(42_u64)).outer_frame();
    callback();
}
"""


def capture(
    directory: Path, source: Path, debug: str, split: str, *, compress: bool = False
) -> str:
    build = directory / "build"
    runtime = directory / "runtime"
    build.mkdir(parents=True)
    runtime.mkdir()
    subprocess.run(
        [
            "rustc", "--edition=2024", "--crate-name=release_backtrace_probe",
            "-Copt-level=3", f"-Cdebuginfo={debug}", f"-Csplit-debuginfo={split}",
            *(["-Clink-arg=-Wl,--compress-debug-sections=zlib"] if compress else []),
            str(source), "-o", str(build / "probe"),
        ],
        cwd=BACKEND,
        check=True,
    )
    # Match Docker's binary-only COPY, then remove every build-side debug file.
    shutil.copy2(build / "probe", runtime / "probe")
    shutil.rmtree(build)
    result = subprocess.run(
        [str(runtime / "probe")],
        cwd=runtime,
        env={**os.environ, "RUST_BACKTRACE": "full"},
        capture_output=True,
        text=True,
    )
    if result.returncode != 101:
        raise RuntimeError(f"Expected the probe to panic: {result}")
    trace = re.sub(r"0x[0-9a-f]+", "ADDRESS", result.stderr)
    return re.sub(r"\(\d+\) panicked", "(PID) panicked", trace)


def main() -> None:
    if sys.platform != "linux":
        raise SystemExit("Run this check on Linux, matching the runtime image.")
    with (BACKEND / "Cargo.toml").open("rb") as manifest:
        profile = tomllib.load(manifest)["profile"]["release"]
    with tempfile.TemporaryDirectory(prefix="erato-backtrace-") as temporary:
        root = Path(temporary)
        source = root / "probe.rs"
        source.write_text(PROBE)
        full = capture(root / "full", source, "full", "off")
        for expected in ("::inlined_frame", "::outer_frame", "::main::{{closure}}"):
            if expected not in full:
                raise AssertionError(f"Reference trace lacks {expected}")
        for compress in (False, True):
            name = "release-compressed" if compress else "release"
            release = capture(
                root / name, source, profile["debug"], profile["split-debuginfo"],
                compress=compress,
            )
            if release != full:
                sys.stderr.writelines(difflib.unified_diff(
                    full.splitlines(keepends=True), release.splitlines(keepends=True),
                    fromfile="full debug information", tofile=name,
                ))
                raise SystemExit("Release backtrace differs from the full-debug reference.")
    print("Release backtraces match full debug information, with and without compression.")


if __name__ == "__main__":
    main()
