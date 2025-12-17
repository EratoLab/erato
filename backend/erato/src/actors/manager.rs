use crate::actors::supervisor::WorkerSupervisor;
use crate::config::AppConfig;
use ractor::Actor;
use sea_orm::DatabaseConnection;

#[derive(Clone, Debug)]
pub struct ActorManager;

impl ActorManager {
    pub async fn new(db: DatabaseConnection, config: AppConfig) -> Self {
        let args = (db, config);
        // Spawn the top-level supervisor
        let (_supervisor, supervisor_handle) = Actor::spawn(
            Some("worker_supervisor".to_string()),
            WorkerSupervisor,
            args,
        )
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
