use crate::db::entity::{chat_file_uploads, chats, messages};
use crate::models::share_link;
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
    /// Whether the operator opted into the data-retention half of the tick.
    /// Carried on the args rather than re-read from config because the tick has
    /// halves with different gating: deleting data is opt-in, and the parts that
    /// delete nothing must not inherit that opt-in.
    pub cleanup_enabled: bool,
    pub cleanup_archived_max_age_days: u32,
    pub delegated_run_auto_archive_after_days: u32,
    pub generation_stale_after_secs: u64,
    /// The bound the delivery backstop truncates a delivered result to. Read
    /// here so the sweep reuses the awaited path's one truncation rule rather
    /// than growing a second.
    pub result_max_chars: usize,
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

    share_link::delete_share_links_for_resources(&txn, "chat", &chat_ids)
        .await
        .map_err(|e| {
            tracing::error!("Failed to delete share links for cleanup: {}", e);
            ActorProcessingErr::from(e.to_string())
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

/// One cleanup tick, callable without an actor system.
///
/// The body lives here rather than inside `Actor::handle` so that tests can
/// drive a tick directly: a tick that can only be reached by waiting five
/// minutes for a cron actor is a tick nobody can assert on — and the delivery
/// backstop it now carries is crash recovery, which has to be testable.
pub async fn run_cleanup_tick(args: &CleanupWorkerArgs) -> Result<(), ActorProcessingErr> {
    // FIRST, and unconditional. This is the crash-recovery half: it delivers
    // any `async` task result whose live delivery a dying replica dropped, and
    // it deletes nothing, so it must not sit behind the retention opt-in below.
    // It returns no `Result` precisely so that the pre-existing `?`s further
    // down can never skip it, and so that one unreachable child cannot take the
    // retention pass with it.
    let swept = crate::services::task_delivery::sweep_task_result_deliveries(
        &args.db,
        args.result_max_chars,
        args.generation_stale_after_secs,
    )
    .await;
    if swept.touched() {
        tracing::info!(?swept, "Backstop swept task result deliveries");
    }

    // Also crash recovery, and above the opt-in line for the same reason: it
    // deletes nothing, and a row whose tool call will never be answered is
    // not something an operator should have to opt into repairing.
    let settled = crate::services::interrupted_parts::sweep_interrupted_tool_parts(
        &args.db,
        args.generation_stale_after_secs,
    )
    .await;
    if settled.touched() {
        tracing::info!(?settled, "Backstop settled interrupted tool parts");
    }

    // The retention half is the operator's opt-in to deleting data. Anything in
    // this tick that deletes nothing belongs above this line.
    if !args.cleanup_enabled {
        return Ok(());
    }

    let archived = crate::models::chat::auto_archive_stale_delegated_runs(
        &args.db,
        args.delegated_run_auto_archive_after_days,
        args.generation_stale_after_secs,
    )
    .await
    .map_err(|e| {
        tracing::error!("Failed to auto-archive stale delegated runs: {}", e);
        ActorProcessingErr::from(e.to_string())
    })?;
    if archived > 0 {
        tracing::info!("Auto-archived {} stale delegated runs.", archived);
    }

    cleanup_archived_chats(&args.db, args.cleanup_archived_max_age_days).await?;

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
            CleanupWorkerMessage::Tick => run_cleanup_tick(state).await?,
        }
        Ok(())
    }
}
