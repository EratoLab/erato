use ractor::ActorRef;
use ractor::registry;
use ractor_actors::time::cron::Job;

use crate::actors::cleanup_worker::CleanupWorkerMessage;

pub struct CleanupTickJob;

#[async_trait::async_trait]
impl Job for CleanupTickJob {
    fn id<'a>(&self) -> &'a str {
        "cleanup_tick_job"
    }

    async fn work(&mut self) -> Result<(), ractor::ActorProcessingErr> {
        tracing::info!("Running cleanup_worker_cron");
        if let Some(actor_cell) = registry::where_is("cleanup_worker".to_string()) {
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
