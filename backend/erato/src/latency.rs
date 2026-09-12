//! Opt-in wall-time diagnostics. These durations include scheduling and I/O,
//! and must not be interpreted as CPU execution time.
use std::future::Future;
use std::sync::OnceLock;
use std::time::Instant;

use metrics::{Unit, describe_gauge, describe_histogram, gauge, histogram};
use tracing::Instrument;

pub fn enabled() -> bool {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    *ENABLED.get_or_init(|| std::env::var("ERATO_LATENCY_DIAGNOSTICS").as_deref() == Ok("1"))
}

/// Drop-based timing also covers error returns and cancellation. Labels must
/// be static stage names, never chat IDs, usernames, SQL or request contents.
pub struct StageTimer(Option<(&'static str, Instant)>);

impl StageTimer {
    pub fn new(stage: &'static str) -> Self {
        if enabled() {
            gauge!("erato_latency_stage_in_flight", "stage" => stage).increment(1.0);
            Self(Some((stage, Instant::now())))
        } else {
            Self(None)
        }
    }
}

impl Drop for StageTimer {
    fn drop(&mut self) {
        if let Some((stage, started)) = self.0 {
            let elapsed_seconds = started.elapsed().as_secs_f64();
            histogram!("erato_latency_stage_duration_seconds", "stage" => stage)
                .record(elapsed_seconds);
            gauge!("erato_latency_stage_in_flight", "stage" => stage).decrement(1.0);
            tracing::debug!(stage, elapsed_seconds, "latency stage finished");
        }
    }
}

pub async fn stage<T>(name: &'static str, future: impl Future<Output = T>) -> T {
    if !enabled() {
        return future.await;
    }
    async {
        let _timer = StageTimer::new(name);
        future.await
    }
    .instrument(tracing::info_span!(
        "latency.stage",
        stage = name,
        dial9 = true
    ))
    .await
}

pub fn start_runtime_probe() {
    if !enabled() {
        return;
    }
    describe_histogram!(
        "erato_latency_stage_duration_seconds",
        Unit::Seconds,
        "Stage wall time including scheduling and dependency waits, errors and cancellation."
    );
    describe_gauge!(
        "erato_latency_stage_in_flight",
        "Operations currently in a diagnostic stage; dispatch_wait counts tasks not yet polled."
    );
    describe_histogram!(
        "erato_runtime_timer_lateness_seconds",
        Unit::Seconds,
        "Lateness of a 250ms Tokio timer; indicates scheduling/runtime stalls, not CPU time."
    );
    tokio::spawn(async {
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(250));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            let deadline = interval.tick().await;
            histogram!("erato_runtime_timer_lateness_seconds")
                .record(deadline.elapsed().as_secs_f64());
        }
    });
}

/// Enter only around synchronous work; never keep an entered guard across await.
/// These spans add no metrics and are disabled outside the Dial9 build.
pub fn sync_span(operation: &'static str) -> tracing::Span {
    #[cfg(feature = "profiling-dial9")]
    {
        tracing::info_span!("sync.operation", operation, dial9 = true)
    }
    #[cfg(not(feature = "profiling-dial9"))]
    {
        let _ = operation;
        tracing::Span::none()
    }
}
