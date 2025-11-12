use crate::db::entity::{chat_file_uploads, chats, messages};
use chrono::{Duration, Utc};
use ractor::{Actor, ActorProcessingErr, ActorRef};
use sea_orm::{
    ColumnTrait, Condition, DatabaseConnection, EntityTrait, QueryFilter, TransactionTrait,
};

#[derive(Debug, Clone)]
pub enum CleanupWorkerMessage {
    Tick,
}

#[derive(Clone)]
pub struct CleanupWorkerArgs {
    pub db: DatabaseConnection,
    pub cleanup_archived_max_age_days: u32,
}

pub struct CleanupWorker;

pub async fn cleanup_archived_chats(
    db: &DatabaseConnection,
    max_age_days: u32,
) -> Result<(), ActorProcessingErr> {
    let cutoff_date = Utc::now() - Duration::days(max_age_days as i64);
    tracing::info!("Cleaning up archived chats older than {}", cutoff_date);

    let chats_to_delete = chats::Entity::find()
        .filter(
            Condition::all()
                .add(chats::Column::ArchivedAt.is_not_null())
                .add(chats::Column::ArchivedAt.lt(cutoff_date)),
        )
        .all(db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to query chats for cleanup: {}", e);
            ActorProcessingErr::from(e)
        })?;

    if chats_to_delete.is_empty() {
        tracing::info!("No old archived chats to delete.");
        return Ok(());
    }

    let chat_ids: Vec<sea_orm::prelude::Uuid> = chats_to_delete.iter().map(|c| c.id).collect();
    tracing::info!("Found {} chats to delete.", chat_ids.len());

    let txn = db.begin().await.map_err(|e| {
        tracing::error!("Failed to begin transaction for cleanup: {}", e);
        ActorProcessingErr::from(e)
    })?;

    // Delete chat-file upload relations from join table to allow chat deletion
    // This removes the foreign key constraint by deleting the join table records
    // File upload records themselves are preserved for potential future use
    let chat_file_uploads_delete_result = chat_file_uploads::Entity::delete_many()
        .filter(chat_file_uploads::Column::ChatId.is_in(chat_ids.clone()))
        .exec(&txn)
        .await
        .map_err(|e| {
            tracing::error!(
                "Failed to delete chat-file upload relations for cleanup: {}",
                e
            );
            ActorProcessingErr::from(e)
        })?;

    if chat_file_uploads_delete_result.rows_affected > 0 {
        tracing::info!(
            "Deleted {} chat-file upload relations to allow chat deletion (file uploads preserved).",
            chat_file_uploads_delete_result.rows_affected
        );
    }

    messages::Entity::delete_many()
        .filter(messages::Column::ChatId.is_in(chat_ids.clone()))
        .exec(&txn)
        .await
        .map_err(|e| {
            tracing::error!("Failed to delete messages for cleanup: {}", e);
            ActorProcessingErr::from(e)
        })?;

    chats::Entity::delete_many()
        .filter(chats::Column::Id.is_in(chat_ids))
        .exec(&txn)
        .await
        .map_err(|e| {
            tracing::error!("Failed to delete chats for cleanup: {}", e);
            ActorProcessingErr::from(e)
        })?;

    txn.commit().await.map_err(|e| {
        tracing::error!("Failed to commit transaction for cleanup: {}", e);
        ActorProcessingErr::from(e)
    })?;

    tracing::info!("Cleanup complete.");
    Ok(())
}

impl Actor for CleanupWorker {
    type Msg = CleanupWorkerMessage;
    type State = CleanupWorkerArgs;
    type Arguments = CleanupWorkerArgs;

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
            CleanupWorkerMessage::Tick => {
                cleanup_archived_chats(&state.db, state.cleanup_archived_max_age_days).await?;
            }
        }
        Ok(())
    }
}
