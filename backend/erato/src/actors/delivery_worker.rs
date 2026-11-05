use crate::services::scheduled_deliveries::{
    DeliveryRegistry, ExecutorSettings, run_delivery_tick,
};
use ractor::{Actor, ActorProcessingErr, ActorRef};
use sea_orm::DatabaseConnection;
use std::sync::Arc;

#[derive(Debug, Clone)]
pub enum DeliveryWorkerMessage {
    Tick,
}

#[derive(Clone)]
pub struct DeliveryWorkerArgs {
    pub db: DatabaseConnection,
    pub settings: ExecutorSettings,
    pub registry: Arc<DeliveryRegistry>,
}

/// Runs the scheduled-delivery executor on this replica's cron tick.
pub struct DeliveryWorker;

impl Actor for DeliveryWorker {
    type Msg = DeliveryWorkerMessage;
    type State = DeliveryWorkerArgs;
    type Arguments = DeliveryWorkerArgs;

    async fn pre_start(
        &self,
        _myself: ActorRef<Self::Msg>,
        args: Self::Arguments,
    ) -> Result<Self::State, ActorProcessingErr> {
        Ok(args)
    }

    async fn handle(
        &self,
        _myself: ActorRef<Self::Msg>,
        message: Self::Msg,
        state: &mut Self::State,
    ) -> Result<(), ActorProcessingErr> {
        match message {
            DeliveryWorkerMessage::Tick => {
                let outcome = run_delivery_tick(&state.db, &state.settings, &state.registry).await;
                if outcome.touched() {
                    tracing::info!(?outcome, "Scheduled delivery tick");
                }
            }
        }
        Ok(())
    }
}
