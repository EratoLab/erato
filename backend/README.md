<!-- .... -->

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
override Cargo's configured flags. Release builds already include full debug
symbols in the workspace configuration.

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
