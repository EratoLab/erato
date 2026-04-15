use crate::test_utils::hermetic_app_config;
use erato::db::entity::{chats, share_links};
use erato::policy::engine::PolicyEngine;
use erato::policy::types::Subject;
use sea_orm::ActiveValue::Set;
use sea_orm::prelude::Uuid;
use sea_orm::{EntityTrait, SqlxPostgresConnector};
use sqlx::Pool;
use sqlx::postgres::Postgres;

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_authorize_chat_view_via_query(pool: Pool<Postgres>) {
    let db = SqlxPostgresConnector::from_sqlx_postgres_pool(pool);
    let engine = PolicyEngine::new();

    let owned_chat_id = Uuid::new_v4();
    let shared_chat_id = Uuid::new_v4();
    let denied_chat_id = Uuid::new_v4();

    chats::Entity::insert(chats::ActiveModel {
        id: Set(owned_chat_id),
        owner_user_id: Set("owner-user".to_string()),
        ..Default::default()
    })
    .exec(&db)
    .await
    .unwrap();

    chats::Entity::insert(chats::ActiveModel {
        id: Set(shared_chat_id),
        owner_user_id: Set("another-owner".to_string()),
        ..Default::default()
    })
    .exec(&db)
    .await
    .unwrap();

    chats::Entity::insert(chats::ActiveModel {
        id: Set(denied_chat_id),
        owner_user_id: Set("different-owner".to_string()),
        ..Default::default()
    })
    .exec(&db)
    .await
    .unwrap();

    share_links::Entity::insert(share_links::ActiveModel {
        id: Set(Uuid::new_v4()),
        resource_type: Set("chat".to_string()),
        resource_id: Set(shared_chat_id.to_string()),
        enabled: Set(true),
        ..Default::default()
    })
    .exec(&db)
    .await
    .unwrap();

    let owner_subject = Subject::User("owner-user".to_string());
    let viewer_subject = Subject::User("viewer-user".to_string());

    let mut sharing_enabled = hermetic_app_config(None, None);
    sharing_enabled.chat_sharing.enabled = true;

    let mut sharing_disabled = hermetic_app_config(None, None);
    sharing_disabled.chat_sharing.enabled = false;

    engine
        .authorize_chat_view_via_query(
            &db,
            &sharing_enabled,
            &owner_subject,
            &owned_chat_id.to_string(),
        )
        .await
        .unwrap();

    engine
        .authorize_chat_view_via_query(
            &db,
            &sharing_enabled,
            &viewer_subject,
            &shared_chat_id.to_string(),
        )
        .await
        .unwrap();

    assert!(
        engine
            .authorize_chat_view_via_query(
                &db,
                &sharing_disabled,
                &viewer_subject,
                &shared_chat_id.to_string(),
            )
            .await
            .is_err()
    );

    assert!(
        engine
            .authorize_chat_view_via_query(
                &db,
                &sharing_enabled,
                &viewer_subject,
                &denied_chat_id.to_string(),
            )
            .await
            .is_err()
    );
}
