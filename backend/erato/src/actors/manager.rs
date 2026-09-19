use crate::actors::supervisor::{WorkerNames, WorkerSupervisor, WorkerSupervisorArgs};
use crate::config::AppConfig;
use ractor::Actor;
use sea_orm::DatabaseConnection;

#[derive(Clone, Debug)]
pub struct ActorManager;

impl ActorManager {
    pub async fn new(db: DatabaseConnection, config: AppConfig) -> Self {
        Self::new_with_name(db, config, Some("worker_supervisor".to_string())).await
    }

    pub async fn new_with_name(
        db: DatabaseConnection,
        config: AppConfig,
        supervisor_name: Option<String>,
    ) -> Self {
        // The supervisor's own name is the derivation root for its children's
        // registry names. An unnamed supervisor gets no names, and therefore
        // starts no timed children: the registry is process-global and never
        // unregisters, so many managers in one process (tests) must not
        // register anything at all.
        let args = WorkerSupervisorArgs {
            workers: supervisor_name.as_deref().map(WorkerNames::derived_from),
            db,
            config,
        };
        // Spawn the top-level supervisor
        let (_supervisor, supervisor_handle) =
            Actor::spawn(supervisor_name, WorkerSupervisor, args)
                .await
                .expect("Failed to spawn WorkerSupervisor");

        // We'll spawn the supervisor handle in a background task to ensure it's not dropped
        // and the actor system keeps running.
        tokio::spawn(async move {
            supervisor_handle.await.unwrap();
        });

        Self
    }
}
