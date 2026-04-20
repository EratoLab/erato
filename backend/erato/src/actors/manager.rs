use crate::actors::supervisor::WorkerSupervisor;
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
        let args = (db, config);
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
