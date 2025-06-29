use std::str::FromStr;

use cron::Schedule;
use ractor::{Actor, ActorProcessingErr, ActorRef, SupervisionEvent};
use ractor_actors::time::cron::{CronManager, CronManagerMessage, CronSettings};
use sea_orm::DatabaseConnection;

use crate::actors::cleanup_worker::{CleanupWorker, CleanupWorkerArgs};
use crate::actors::cron_jobs::CleanupTickJob;
use crate::config::AppConfig;

pub struct WorkerSupervisor;

impl Actor for WorkerSupervisor {
    type Msg = (); // No messages for supervisor itself for now
    type State = Option<CleanupWorkerArgs>;
    type Arguments = (DatabaseConnection, AppConfig);

    async fn pre_start(
        &self,
        myself: ActorRef<Self::Msg>,
        (db, config): Self::Arguments,
    ) -> Result<Self::State, ActorProcessingErr> {
        if !config.cleanup_enabled {
            tracing::info!("Cleanup worker is disabled via config. Supervisor will be idle.");
            return Ok(None);
        }

        let args = CleanupWorkerArgs {
            db: db.clone(),
            cleanup_archived_max_age_days: config.cleanup_archived_max_age_days,
        };

        // Start the cron manager
        let (cron_manager, cron_manager_handle) = Actor::spawn_linked(
            Some("cleanup_worker_cron".to_string()),
            CronManager,
            (),
            myself.get_cell(),
        )
        .await
        .expect("Failed to spawn CronManager");
        tokio::spawn(async move {
            cron_manager_handle.await.unwrap();
        });

        // Schedule the cleanup tick job
        let schedule = Schedule::from_str("0 */5 * * * *").expect("Failed to parse cron schedule");
        let settings = CronSettings {
            schedule,
            job: Box::new(CleanupTickJob),
        };
        cron_manager
            .call(|prt| CronManagerMessage::Start(settings, prt), None)
            .await
            .expect("Failed to send Start to CronManager")
            .expect("CronManager timed out starting job")
            .expect("Failed to start CleanupTickJob");

        // Start and supervise the cleanup worker
        let (_cleanup_actor, _cleanup_handle) = Actor::spawn_linked(
            Some("cleanup_worker".to_string()),
            CleanupWorker,
            args.clone(),
            myself.get_cell(),
        )
        .await
        .expect("Failed to spawn CleanupWorker");

        Ok(Some(args))
    }

    async fn handle_supervisor_evt(
        &self,
        myself: ActorRef<Self::Msg>,
        message: SupervisionEvent,
        state: &mut Self::State,
    ) -> Result<(), ActorProcessingErr> {
        match message {
            SupervisionEvent::ActorStarted(who) => {
                let name = who.get_name().unwrap_or_else(|| "un-named".to_string());
                tracing::info!("Actor '{name}' started and supervised.");
            }
            SupervisionEvent::ActorFailed(who, reason) => {
                let name = who.get_name().unwrap_or_else(|| "un-named".to_string());
                tracing::error!("Actor '{name}' panicked with reason: {reason}. Restarting...",);

                if name == "cleanup_worker" {
                    if let Some(worker_args) = state {
                        // Restart the panicked actor
                        let (_restarted_actor, _handle) = Actor::spawn_linked(
                            who.get_name(),
                            CleanupWorker,
                            worker_args.clone(),
                            myself.get_cell(),
                        )
                        .await
                        .expect("Failed to restart actor");

                        tracing::info!("Restarted '{name}'.");
                    } else {
                        tracing::error!(
                            "cleanup_worker failed, but supervisor has no state to restart it."
                        );
                    }
                }
            }
            SupervisionEvent::ActorTerminated(who, _, reason) => {
                let name = who.get_name().unwrap_or_else(|| "un-named".to_string());
                tracing::error!(
                    "Actor '{name}' terminated with reason: {reason:?}. Not restarting.",
                );
            }
            _ => {}
        }
        Ok(())
    }
}
