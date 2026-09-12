# Local concurrency load tests

This workflow runs `helm/erato-stress-test/load-tests/chat.js` from a separate
infrastructure checkout. The workload is not copied: each VU uses a distinct
Dex account, logs in once, repeatedly starts a fresh chat, sends `Test`, and
waits for full streaming completion. The companion patch fixes error waits in
that shared helper and captures browser console errors. It should also be
carried into the infrastructure repository so cluster and local runs match.

For Dial9, replace the backend baseline command with
`just run_latency_dial9 /tmp/erato-profiles/my-run/traces`.
Set `OUTPUT_DIR=/tmp/erato-profiles/my-run/load-test` on `load_test` to
retain the workload log, configuration, generator CPU usage, and metrics there.
`ERATO_SKIP_DOTENV=1` in the isolated backend recipes prevents parent dotenv
files from silently overriding the mock configuration.

## Setup

1. Start/migrate local Postgres using `backend/justfile` (`run_local_services`
   and `deploy_db`), or use an existing migrated development database. This
   workflow creates persistent chats; use a dedicated database for clean runs.
2. In separate terminals in `backend`, run `just run_mock_llm` and
   `just run_mock_mcp`. The existing mock `Test` response contains ten chunks
   with 100 ms delays (roughly one second including the final stream delay).
3. Run `just run_latency` in `backend` for the non-profiling release baseline.
   It reads only `backend/latency/erato.toml`, which selects local mock services.
   Unset inherited configuration environment variables before a controlled run;
   environment configuration still overrides TOML. No real OpenAI key is needed.
4. Run `VITE_API_ROOT_URL=http://localhost:4180/api/ just dev` in `frontend`.
   Ensure the frontend's public assets are installed using its normal setup.
   It generates the 1,000 Dex accounts while
   preserving development accounts and starts the authenticated frontend on
   `http://localhost:4180`. Stop conflicting processes on 3000/3130/4180/5556
   first. Docker Desktop needs host networking for the existing auth Compose.
   For measurements, prefer a production frontend: build with
   `VITE_API_ROOT_URL=http://localhost:4180/api/ pnpm exec vite build`, set
   `FRONTEND__WEB_FRONTEND_BUNDLE_PATH` to the absolute output directory on the
   backend, and route the OAuth proxy's root upstream to the backend as well.
   This avoids measuring Vite module compilation and development asset requests.
5. Install the upstream pinned k6: `cd /path/to/infrastructure/helm/erato-stress-test/load-tests && just install`.
   Install Lightpanda as described in that directory's README, or select
   `LOAD_TEST_BROWSER=chromium`. For the direct control, install this repository's
   e2e dependencies with `pnpm install` and Chromium with
   `pnpm exec playwright install chromium` in `e2e-tests`.
6. Apply the shared diagnostic fix once (the runner checks it is present):

   ```sh
   git -C /path/to/infrastructure apply /absolute/path/to/erato/e2e-tests/load-tests/infrastructure-diagnostics.patch
   ```

## Run

From `e2e-tests`:

```sh
# Actual OAuth redirects/login and profile checks; distinct sessions and IDs.
USERS=2 FIRST_USER=999 just load_test_auth /path/to/infrastructure

BASE_URL=http://localhost:4180 USERS=5 FIRST_USER=1 DURATION_SECONDS=45 \
  MODEL='Mock LLM' K6_REMOTE_WRITE=0 just load_test /path/to/infrastructure

# Uses the same upstream login helper, then closes Chromium before starting
# concurrent HTTP requests. MODEL_ID is the backend ID, not the display name.
USERS=5 DURATION_SECONDS=45 MODEL_ID=mock \
  just load_test_direct /path/to/infrastructure > ../tmp/direct-5.jsonl 2>&1
```

Create `../tmp` before redirecting. The direct control records login failures,
headers, first/last text delta, final persistence and full stream durations,
structured SSE errors, truncated streams and overall journey success. It
creates a fresh chat per request. It intentionally omits browser navigation
and model selection, so compare it as a control, not an equivalent journey.
All users must log in successfully for matched-load comparisons; a failed
login reduces offered load even when the remaining journeys succeed.

`load_test` defaults remote write to **off** and saves metadata, run output and
two-second Prometheus snapshots under `e2e-tests/tmp/latency/`. The upstream
runner also saves `summary.json`, logs and browser artifacts under its own
`results/` directory, printed in `run.log`. A nonzero k6 exit is preserved.
To enable remote write, provide both `K6_REMOTE_WRITE=1` and an explicit
`K6_PROMETHEUS_RW_SERVER_URL`; the wrapper never opens a cluster tunnel.
Metadata includes source revisions, `RESOURCE_LIMITS`, `HISTORY_STATE`, and
`INSTRUMENTATION`; set these for every measurement.

## Diagnostics and matched comparisons

Start `backend/run_jaeger.sh`, then enable the configured local OTLP gRPC sink
with `INTEGRATIONS__OTEL__ENABLED=true just run_latency_diagnostics` in `backend`.
Jaeger UI is `http://localhost:16686`; metrics are on port 3132, avoiding the
admin frontend on 3131. Keep OTLP disabled if the collector is not running.
Use `just run_latency_mock_console` for the release Tokio-console build;
connect with `tokio-console` on its default port 6669. This build has
`tokio_unstable` and no jemalloc/Dial9 allocator. `run_dial9` remains available
as a separate diagnostic (see `backend/README.md`).

`ERATO_LATENCY_DIAGNOSTICS=1` enables stage spans/histograms, in-flight counts
and a 250 ms timer-lateness probe. Inspect:

- `request.authentication`, `request.configuration`, `request.policy`.
- `policy.rebuild_lock_wait` versus `policy.rebuild_lock_hold` and the nested
  `rebuild_data_locked` trace, which includes the individual resource fetches.
- `policy.evaluation_queue_wait` for the four-slot process-wide admission limit,
  `policy.blocking_dispatch_wait` for blocking-pool scheduling, and
  `policy.evaluate` for input preparation/queries on a blocking thread.
  `policy.engine_read_hold` covers only snapshot cloning. Running jobs retain
  their slot when an HTTP caller disconnects; no read lock crosses the offload.
- `generation.dispatch_wait` (spawn to first poll), `generation.run`,
  `provider.connect` (request through response headers), existing provider
  first/last-token metrics, and `generation.final_persistence`.
- Generation registry/history lock wait versus hold, SSE channel send wait,
  and shared-event persistence. Channel wait in-flight is blocked producers,
  not channel occupancy. The normal submit path spawns per-chat tasks rather
  than dispatching through one generation worker.
- SQLx `sqlx::pool::acquire=debug` events (`acquired_after_secs`) versus existing
  query execution metrics, which start after pool acquisition.

Wall-time spans and long Tokio polls include scheduling/preemption and I/O;
they are not CPU profiles. Correlate with Dial9 CPU stacks on Linux, process
CPU and cgroup `cpu.stat` (`nr_throttled`, `throttled_usec`). The profile-render
HTTP handlers use one bounded blocking job to keep symbolization off Tokio
workers.

Compare an uninstrumented release backend with diagnostics at the same user
count and duration. Use fresh disjoint account ranges, or reset a **dedicated**
database between runs; document which.
Keep generator/browser worker count fixed and record its CPU alongside the
backend. Separate generator CPU from backend CPU where possible. A local dev
frontend, differing hardware, accumulated chats and different worker counts
are material differences from the cluster baseline.

For the 0.5 versus 2 CPU comparison, run the release backend in a Linux
container/cgroup with the same 2 GiB memory limit, explicitly set
`TOKIO_WORKER_THREADS=4`, and change only its CPU quota (`--cpus=0.5` versus
`--cpus=2`). Keep mocks, Postgres and browsers outside that quota. Native macOS
does not provide equivalent Linux CPU quotas or Dial9 perf sampling; do not
label unconstrained macOS runs as matched quota measurements.

Retain failure counts, incomplete/error chat durations, screenshots/logs,
telemetry and metadata as well as successful p95. Inspect generator saturation
and diagnostic overhead before attributing a slowdown to backend CPU cost.
Keep run-specific findings and trace artifacts in the output directory alongside
the workload configuration and logs.
