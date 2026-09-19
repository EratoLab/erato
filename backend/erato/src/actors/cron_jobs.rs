use ractor::ActorRef;
use ractor::registry;
use ractor_actors::time::cron::Job;

use crate::actors::cleanup_worker::CleanupWorkerMessage;

/// Ticks one supervisor's cleanup worker.
///
/// The worker's registry name is a field, not a literal, because the registry is
/// process-global and the name is derived per supervisor. Carrying it makes a
/// rename a compile error; a literal would merely make `where_is` return `None`
/// forever and the tick would be skipped behind a `warn!` nobody reads.
pub struct CleanupTickJob {
    pub worker_name: String,
}

#[async_trait::async_trait]
impl Job for CleanupTickJob {
    fn id<'a>(&self) -> &'a str {
        // Job ids are scoped per `CronManager`, and there is one manager per
        // supervisor, so this stays a `'static` literal (the signature allows
        // nothing else) even though the worker name is per-supervisor.
        "cleanup_tick_job"
    }

    async fn work(&mut self) -> Result<(), ractor::ActorProcessingErr> {
        tracing::info!("Running cleanup_worker_cron");
        if let Some(actor_cell) = registry::where_is(self.worker_name.clone()) {
            let worker: ActorRef<CleanupWorkerMessage> = actor_cell.into();
            if let Err(e) = worker.cast(CleanupWorkerMessage::Tick) {
                tracing::error!("Failed to send Tick to cleanup_worker_cron: {e}");
            }
        } else {
            tracing::warn!("cleanup_worker_cron not found in registry. Tick skipped.");
        }
        Ok(())
    }
}
