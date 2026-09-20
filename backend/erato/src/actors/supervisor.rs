use std::str::FromStr;

use cron::Schedule;
use ractor::{Actor, ActorProcessingErr, ActorRef, SupervisionEvent};
use ractor_actors::time::cron::{CronManager, CronManagerMessage, CronSettings};
use sea_orm::DatabaseConnection;

use crate::actors::cleanup_worker::{CleanupWorker, CleanupWorkerArgs};
use crate::actors::cron_jobs::CleanupTickJob;
use crate::config::AppConfig;

/// The registry names this supervisor's timed children run under. Derived from
/// the supervisor's own name because `ractor`'s registry is process-global and
/// nothing ever unregisters: a second manager in one process registering the
/// same literal is `SpawnErr::ActorAlreadyRegistered`, which our `.expect()`
/// turns into a panic.
#[derive(Clone, Debug)]
pub struct WorkerNames {
    pub cleanup_worker: String,
    pub cleanup_worker_cron: String,
}

impl WorkerNames {
    pub fn derived_from(supervisor_name: &str) -> Self {
        Self {
            cleanup_worker: format!("{supervisor_name}.cleanup_worker"),
            cleanup_worker_cron: format!("{supervisor_name}.cleanup_worker_cron"),
        }
    }
}

/// The tick job the supervisor schedules, built in one place so a test can
/// drive the *same* construction the supervisor uses.
///
/// Without this the coupling is untestable in the direction that matters: the
/// `Box<dyn Job>` goes straight into `CronManagerMessage::Start` and is never
/// retained, so a job handed `cleanup_worker_cron` instead of `cleanup_worker`
/// would cast every tick at the `CronManager`'s cell — a `Some` from
/// `where_is`, so not even the "Tick skipped" warning fires — and the backstop
/// sweep would never run, silently.
pub fn cleanup_tick_job(names: &WorkerNames) -> CleanupTickJob {
    CleanupTickJob {
        worker_name: names.cleanup_worker.clone(),
    }
}

pub struct WorkerSupervisorArgs {
    pub db: DatabaseConnection,
    pub config: AppConfig,
    /// `None` for an unnamed supervisor, which then starts NO timed children.
    pub workers: Option<WorkerNames>,
}

pub struct WorkerSupervisorState {
    pub cleanup: Option<(WorkerNames, CleanupWorkerArgs)>,
}

pub struct WorkerSupervisor;

impl Actor for WorkerSupervisor {
    type Msg = (); // No messages for supervisor itself for now
    type State = WorkerSupervisorState;
    type Arguments = WorkerSupervisorArgs;

    async fn pre_start(
        &self,
        myself: ActorRef<Self::Msg>,
        args: Self::Arguments,
    ) -> Result<Self::State, ActorProcessingErr> {
        let WorkerSupervisorArgs {
            db,
            config,
            workers,
        } = args;

        // FIRST. An unnamed supervisor starts no timed children at all: that, not
        // a uniquified suffix, is what keeps many managers in one process
        // collision-free, and it also keeps a real `0 */5 * * * *` cron out of a
        // test process whose sqlx database is dropped at test end.
        let Some(names) = workers else {
            return Ok(WorkerSupervisorState { cleanup: None });
        };

        // The worker's tick has two halves with different gating. The retention
        // half is the operator's opt-in to deleting data; the delivery backstop
        // deletes nothing and exists so that a crashed replica cannot lose a
        // finished task's result, which must not be behind that opt-in.
        //
        // `any_route_enabled` rather than `tasks.run_modes ∋ async`: facet
        // overrides can widen list-valued keys at request time, so the config
        // read here is not the last word on whether a run is async. The sweep
        // self-gates cheaply instead — its scan matches nothing when nothing
        // async was ever dispatched.
        if !config.cleanup_enabled && !config.delegation.any_route_enabled() {
            tracing::info!("Neither cleanup nor delegation is enabled. Supervisor will be idle.");
            return Ok(WorkerSupervisorState { cleanup: None });
        }

        let args = CleanupWorkerArgs {
            db: db.clone(),
            cleanup_enabled: config.cleanup_enabled,
            cleanup_archived_max_age_days: config.cleanup_archived_max_age_days,
            delegated_run_auto_archive_after_days: config.delegation.auto_archive_after_days,
            generation_stale_after_secs: config.generation_status.stale_after_secs,
            result_max_chars: config.delegation.result_max_chars,
        };

        // Start the cron manager
        let (cron_manager, cron_manager_handle) = Actor::spawn_linked(
            Some(names.cleanup_worker_cron.clone()),
            CronManager,
            (),
            myself.get_cell(),
        )
        .await
        .expect("Failed to spawn CronManager");
        tokio::spawn(async move {
            cron_manager_handle.await.unwrap();
        });

        // Schedule the cleanup tick job. The job is handed the worker's registry
        // name rather than looking up a literal: that turns a rename into a
        // compile error instead of a tick that is silently skipped forever.
        // Built through `cleanup_tick_job` so that the name it carries is the
        // one a test can observe — the boxed job itself is unobservable once it
        // is inside the cron manager.
        let schedule = Schedule::from_str("0 */5 * * * *").expect("Failed to parse cron schedule");
        let settings = CronSettings {
            schedule,
            job: Box::new(cleanup_tick_job(&names)),
        };
        cron_manager
            .call(|prt| CronManagerMessage::Start(settings, prt), None)
            .await
            .expect("Failed to send Start to CronManager")
            .expect("CronManager timed out starting job")
            .expect("Failed to start CleanupTickJob");

        // Start and supervise the cleanup worker
        let (_cleanup_actor, _cleanup_handle) = Actor::spawn_linked(
            Some(names.cleanup_worker.clone()),
            CleanupWorker,
            args.clone(),
            myself.get_cell(),
        )
        .await
        .expect("Failed to spawn CleanupWorker");

        Ok(WorkerSupervisorState {
            cleanup: Some((names, args)),
        })
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

                // `name` is the *registered* name, which is now derived from the
                // supervisor's own name, so the comparison has to go through the
                // same derivation. A literal here would silently stop matching
                // and a panicked worker would never be restarted.
                if let Some((names, worker_args)) = state.cleanup.as_ref()
                    && name == names.cleanup_worker
                {
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
