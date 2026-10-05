<!-- .... -->

## Release build time and backtraces

The release profile uses `debug = "limited"`: qualified function names, inline
frames and source locations are retained, while type and local-variable debug
information is omitted. `line-tables-only` is insufficient here because it loses
qualified function names. Set `CARGO_PROFILE_RELEASE_DEBUG=full` when inspecting
types or local variables in a debugger.

Debug information is embedded (`split-debuginfo = "off"`). A comparison with
`packed` and a shipped `.dwp` found no material application build-time benefit
from splitting (see measurements below). Embedding also avoids a separate
runtime artifact. With `packed`, omitting the matching `.dwp` loses inline frames
and can attribute an application's frame to an inlined dependency's source
location.

The Docker build compresses the embedded DWARF with zlib at link time. This
preserves backtrace details while keeping the runtime executable smaller.
`cargo auditable rustc` passes the linker option only to the final binary;
dependencies retain the same flags as the cargo-chef cache. Plain Cargo release
builds keep the same debug information without compression.

To check the binary-only packaging contract on Linux with Python 3.11+ and the
pinned Rust toolchain:

```sh
python3 check_release_backtraces.py
```

The check compares the configured release debug settings against full embedded
debug information using an optimized panic with generic methods, an inline
frame and a closure. It removes build-side artifacts before running each
executable and compares the complete traces after normalizing addresses and
process IDs, both with and without the Docker linker's compression option.

### ERMAIN-894 investigation

Measurements were taken on `eratolabs-hetzner-1` under `/root/stuff/ermain-894`,
using revision `07c5df8304cbd18e67509828089361755ff8afc8`, the pinned Docker
builder (Rust 1.96.0, Debian Trixie), cargo-auditable 0.7.4 and an eight-CPU
container limit. Raw logs, Cargo timing reports, compiler profiles, executables
and backtrace probes remain in that directory.

The slow final Cargo step is predominantly compilation, not system linking.
Use the uninstrumented measurements below for build-time comparisons. An early
profiling wrapper dropped Cargo's jobserver file descriptors, changing compiler
parallelism; its phase measurements are superseded by the corrected profiling
described below. This did not affect the uninstrumented builds.

With dependencies cached and without compiler instrumentation:

| Build | Library | Binary | Executable size |
| --- | ---: | ---: | ---: |
| Original `full` / `packed` | 233 s | 39 s | 408 MiB, excluding its missing `.dwp` |
| Final `limited` / embedded | 188 s | 26 s | 719 MiB |
| Final binary with linker compression | cached | 27 s | 300 MiB |
| `limited` / `packed`, with linker compression | 189 s | 29 s | 190 MiB executable + 361 MiB `.dwp` |
| Embedded + compression, Erato codegen units increased to 64 | 198 s | 32 s | 317 MiB |
| Embedded + compression, shared generation loop | 161 s | 27 s | 299 MiB |

The follow-up packed build used `limited` for **all** dependencies, matching the
embedded variant, and the same final-binary linker compression. Its application
compilation totaled 218 seconds versus 215 seconds for the embedded library and
compressed binary: effectively a tie for individual runs, with no evidence of
a split-debug speedup. The actual relocated executable plus its `.dwp` produced
the same complete application backtrace as the embedded executable after
normalizing symbol hashes. A standalone probe also verified that removing the
`.dwp` loses inline frames. The `.dwp` was not compressed; reported sizes are
artifact sizes, not compressed OCI image-layer sizes. Raw results are in
`results/all-limited-packed*` in the remote investigation directory.

These are individual runs on Linux x86_64, not repeated statistical benchmarks
or ARM64/CI measurements. The original application timings came from the first
dependency build; subsequent runs reused dependencies. The final compressed
binary was rebuilt separately against the completed library. Its application
backtrace matched the uncompressed executable exactly. The audit metadata
section (`.dep-v0`) was retained. No runtime throughput benchmark was performed.

The shared generation loop removes the response-type parameter from
`stream_generate_chat_completion`. Submit, edit and regenerate have the same
SSE tags and JSON payloads for the six event kinds emitted inside this loop, so
it can use one concrete response type while preserving each endpoint's public
response enum. A regression test compares the tags and serialized payloads
across all three enums. This avoids repeatedly optimizing the large async
body without reducing optimization settings or adding dynamic dispatch.
The executable contains two large copies of the loop instead of six. Its
compiler-reported instantiation count fell from nine to three.
The first comparison against the earlier 215-second build suggested a 12%
saving, but a repeated uninstrumented pair measured **194.6 to 188.3 seconds
(3.2%)**: library 167.15 to 161.11 seconds, binary 27.45 to 27.21 seconds.
The two shared-loop runs agreed closely (188.9 and 188.3 seconds); do not
attribute the earlier baseline's entire difference to this source change.
This remains a small number of runs, not a statistical confidence interval.
The repeated binaries were 300.3 and 298.8 MiB. Raw results are in
`results/repeat-{before,shared}*`. Increasing codegen units to 64 was slower
and was not adopted; the release default remains 16.

Validation: all 76 `server::api::v1beta::message_streaming::` library tests
passed, including the wire-format regression; file formatting passed. The test
build reused release dependencies with test-only Erato overrides
`opt-level=0` and `codegen-units=256`; benchmark builds used the normal release
settings. The optimized executable also produced the expected missing-config
error and symbolized backtrace from the empty runtime-check directory.

#### Compiler phase breakdown

A corrected wrapper uses `os.execvpe` to preserve Cargo's jobserver descriptors.
The lightweight run enables `-Ztime-passes` and `-Zdump-mono-stats` only for
Erato, leaving dependencies cached. Library phase times were:

| Phase | Generic loop | Shared loop |
| --- | ---: | ---: |
| Macro expansion and name resolution | 3.0 s | 2.9 s |
| Type checking | 13.2 s | 13.3 s |
| Borrow checking | 10.5 s | 10.7 s |
| Metadata and generic-code collection | 26.6 s | 26.1 s |
| Code generation and waiting for LLVM | 110.2 s | 106.4 s |
| Library archive/link work | 0.4 s | 0.4 s |
| Whole library compiler invocation, including other work | 166.2 s | 162.0 s |

The code-generation row combines `codegen_crate` and
`finish_ongoing_codegen`. Within that work, emitting LLVM IR took 25.5 / 23.8
seconds, initial LLVM passes took 48.8 / 48.1 seconds and local ThinLTO took
60.5 / 57.6 seconds. These subphases overlap: **do not add them**. Generic-code
collection itself took 18.1 / 17.6 seconds, included in the metadata row.
The subsequent binary compiler invocation took about 27 seconds in both
runs, including 3.1 / 2.7 seconds in the system linker with debug compression.

A separate detailed LLVM time trace identified the repeated generation-loop
functions among the most expensive functions to optimize. Across compiler
threads, instruction combining and inlining each accounted for about 80
seconds, followed by global value numbering (31 seconds) and control-flow
simplification (28 seconds). These are accumulated pass durations, not elapsed
build times. The trace produced roughly 15 GB for the library alone and spent
66 seconds dumping it; its total build time is unsuitable for comparisons.
The monomorphization report also identifies MessagePack deserialization
(`rmp_serde::decode::Deserializer::any_inner`, 198 instantiations) as a source
of generated code, but that has not been refactored or benchmarked separately.

The remote `profile-phases.py` wrapper, `results/phases-{before,shared}-*`,
`results/granular-llvm-summary.json` and `results/llvm-traces` retain the
measurements. Lower optimization levels or disabling local ThinLTO are further
experiments, but require runtime-performance validation before changing the
release profile. Replacing the system linker offers little headroom here.

For repeat measurements, use `cargo auditable build --locked --release -p erato
--bin erato --timings`. Once dependencies are built, touching `erato/src/lib.rs`
and `erato/src/main.rs` forces the application to rebuild. Inspect the separate
library and binary entries in `target/cargo-timings/cargo-timing.html`; changing
global profile settings also rebuilds dependencies, so that invocation's total
is not a cached-dependency comparison. Compiler self-profiling adds overhead
and its parallel event durations must not be summed as wall-clock time.
To reproduce Docker's compressed binary, use:

```sh
cargo auditable rustc --locked --release -p erato --bin erato --timings -- \
  -C link-arg=-Wl,--compress-debug-sections=zlib
```

## Dial9 profiling

Run `just run_dial9` from this directory to build and run the backend in release
mode with the opt-in `profiling-dial9` feature. It records Tokio runtime events,
application spans and process resource usage, plus sampled allocations using
Dial9's system allocator wrapper and CPU samples on Linux. Do not combine it
with the jemalloc/pprof `profiling` feature.

The recipe explicitly loads `profiling-dial9/.cargo/config.toml` to enable
`tokio_unstable` and frame pointers, and uses a separate `target/dial9` build
directory. Normal Cargo commands do not load this configuration. Unset
`RUSTFLAGS` and `CARGO_ENCODED_RUSTFLAGS` when running the recipe, since they
override Cargo's configured flags. Release builds include debug information for
qualified function names, inline frames and source locations. For type and
local-variable inspection in a debugger, set `CARGO_PROFILE_RELEASE_DEBUG=full`.

Traces default to `/tmp/dial9-traces`, with a 1 GiB disk budget and 60-second
rotation. For example:

```sh
DIAL9_TRACE_DIR=/tmp/erato-dial9 DIAL9_MAX_DISK_USAGE_MB=512 just run_dial9
```

Stop with Ctrl-C to shut down the server and flush the final trace segment.
To view traces:

```sh
cargo install --locked dial9 --features cli
dial9 serve --local-dir /tmp/erato-dial9
```

The recipe enables recording and allocation sampling. Other `DIAL9_*` settings
can be supplied in the shell, including `DIAL9_MEMORY_TRACK_LIVESET=true` for
tracking frees. These settings are read before the application's dotenv files
are loaded. When running Cargo directly, also set `DIAL9_ENABLED=true` and
`DIAL9_MEMORY_PROFILE_ENABLED=true` to enable recording and allocation sampling.

CPU profiling and scheduler events are Linux-only. Dial9 0.5.0's allocation
unwinder also does not support macOS; Tokio events, application spans and process
resource counters are available there. Linux perf permissions can limit CPU
and scheduler capture. Runtime hooks cover ordinary Tokio tasks; detailed wake
causality requires spawning tasks through Dial9's APIs. See the
[Dial9 documentation](https://github.com/dial9-rs/dial9/tree/main/dial9#readme)
for platform requirements and additional configuration.

The feature installs `dial9-utils`' `tracing-layer` alongside normal logging.
Only spans marked `dial9 = true` are recorded: HTTP method/path (without query
strings), diagnostic stages, synchronous policy evaluation and its queries,
translation compilation, and frontend path/file operations. HTTP spans cover
response-body polling as well as handler execution. Entered synchronous spans
never cross an await. Capture filtering is independent of `RUST_LOG`.

Policy evaluation runs on Tokio's blocking pool with at most four admitted
evaluations process-wide. Callers await capacity before checking snapshot
freshness; the engine read lock is held only while cloning the snapshot.
The blocking job owns its permit until completion, including after caller
cancellation. Diagnostics separate capacity wait, blocking dispatch wait and
evaluation time.

For the isolated mock-only setup, use
`just run_latency_dial9 /tmp/erato-profiles/my-run/traces`.
The [local concurrency workflow](../e2e-tests/load-tests/README.md) documents
Dex setup, the shared infrastructure workload and diagnostics.

## Embedded PDF image integration tests

From `backend/`, run:

```sh
just test -p erato --test integration_tests api::embedded_images
```

Use Rust 1.94 or newer (required by the workspace dependencies). The tests use
`erato/tests/integration_tests/test_files/embedded-images.pdf`, containing two
distinct images, and start `mock-llm-server`'s chat handler in-process on an
ephemeral HTTP port. No external LLM or separately running mock server is needed.

As with the existing upload integration tests, PostgreSQL must be available at
`postgres://eratouser:eratopw@127.0.0.1:5432/erato` (or set `DATABASE_URL` to a
PostgreSQL role that can create test databases), and SeaweedFS must expose S3 at
`http://127.0.0.1:8333`, with bucket `erato-storage` and credentials `admin` / `admin`.
The existing `./run_postgres.sh` and `./run_seaweedfs.sh` scripts start these services.
The normal backend file-processing build/runtime dependencies are also required;
PDF extraction uses the real xberg pipeline, with no mocked extraction results.

The four cases cover inherited global enablement, both provider overrides, and
omitted/default-disabled configuration. Enabled cases select different images
from the actual request's tool allowlist, validate the MIME type and decoded
bytes in the follow-up model request, and repeat those assertions on a later
chat turn to cover persisted replay and tool-response/image ordering.
