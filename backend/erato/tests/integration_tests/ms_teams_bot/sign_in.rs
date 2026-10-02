use super::*;
use erato::db::entity::ms_teams_pending_sign_ins as pending;
use erato::ms_teams_bot::activity::Activity;
use erato::ms_teams_bot::user_token::{SignInScope, UserTokenClient};
use sea_orm::{ActiveModelTrait, ActiveValue::Set, IntoActiveModel};
use serde_json::json;

fn request(id: &str) -> Activity {
    serde_json::from_value(json!({
        "type": "message", "id": id, "text": "test",
        "from": {"id": "29:user", "aadObjectId": OID},
        "recipient": {"id": "28:bot"},
        "conversation": {"id": "a:personal", "tenantId": "tenant-1", "conversationType": "personal"},
        "serviceUrl": "https://smba.example/", "channelId": "msteams"
    })).unwrap()
}

fn scope(activity: &Activity) -> SignInScope {
    UserTokenClient::new(
        "https://token.botframework.com",
        "graph-sso".into(),
        "bot".into(),
    )
    .sign_in_scope(activity)
    .unwrap()
}

/// # Test Categories
/// - `uses-db`
/// - `uses-mocked-llm`
#[sqlx::test(migrator = "MIGRATOR")]
async fn sso_resumes_original_question_once_across_clients_and_replicas(pool: Pool<Postgres>) {
    let (config, _server) = setup_mock_llm_server(Some(MockLlmConfig {
        chunks: vec!["Hello from Teams".into()],
        delay_ms: 1,
        ..Default::default()
    }))
    .await;
    let state = test_app_state(config, pool).await;
    let host = Host::new(state.clone());
    let other_replica = Host::new(state.clone());
    let activity = request("first-question");
    let scope = scope(&activity);
    assert!(
        host.remember_sign_in(&scope, Some("exchange-1"), &activity)
            .await
            .unwrap()
    );
    // Retrying the incoming Connector activity must not replace its exchange ID.
    assert!(
        !host
            .remember_sign_in(&scope, Some("exchange-retry"), &activity)
            .await
            .unwrap()
    );
    let (desktop, web) = tokio::join!(
        host.claim_pending_sign_ins(&scope, Some("exchange-1")),
        other_replica.claim_pending_sign_ins(&scope, Some("exchange-1"))
    );
    let resumed: Vec<_> = desktop.unwrap().into_iter().chain(web.unwrap()).collect();
    assert_eq!(resumed.len(), 1);
    assert_eq!(
        serde_json::to_value(&resumed[0]).unwrap(),
        serde_json::to_value(&activity).unwrap()
    );
    assert!(host.has_sign_in_request(&scope, &activity).await.unwrap());
    // A later interactive completion shares the same claim as silent SSO.
    assert!(
        host.claim_pending_sign_ins(&scope, None)
            .await
            .unwrap()
            .is_empty()
    );
    let stored = pending::Entity::find()
        .one(&state.db)
        .await
        .unwrap()
        .unwrap();
    assert!(
        stored.activity.is_none(),
        "clear the message payload immediately after claiming it"
    );

    let user = get_or_create_user(&state.db, "https://issuer.example", "subject-1", None)
        .await
        .unwrap();
    record_entra_object_id(&state.db, &user, OID).await.unwrap();
    let session = host
        .session(
            &user,
            &identity(),
            Vec::new(),
            "graph-token".into(),
            None,
            "tenant-1",
        )
        .await
        .unwrap();
    let original = &resumed[0];
    let conversation = host
        .upsert_conversation(
            original.conversation_id().unwrap(),
            original.conversation_kind(),
            user.id,
            original.service_url.as_deref().unwrap(),
            &original.from.as_ref().unwrap().id,
        )
        .await
        .unwrap();
    let (chat_id, _) = host
        .ensure_chat(&session, &conversation, None)
        .await
        .unwrap();
    let updates = host
        .submit(
            &session,
            chat_id,
            original.text_without_bot_mention(),
            Vec::new(),
        )
        .await
        .unwrap();
    let (answer, _) = completion(updates).await;
    assert_eq!(answer.text, "Hello from Teams");
    let messages = Messages::find()
        .filter(messages::Column::ChatId.eq(chat_id))
        .all(&state.db)
        .await
        .unwrap();
    assert_eq!(
        messages.len(),
        2,
        "one question and one answer without user resubmission"
    );
}

/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn callback_must_match_every_identity_field_and_the_exchange(pool: Pool<Postgres>) {
    let (config, _server) = setup_mock_llm_server(None).await;
    let host = Host::new(test_app_state(config, pool).await);
    let activity = request("question");
    let original = scope(&activity);
    host.remember_sign_in(&original, Some("exchange-1"), &activity)
        .await
        .unwrap();
    for field in 0..6 {
        let mut wrong = original.clone();
        match field {
            0 => wrong.bot_app_id = "another-bot".into(),
            1 => wrong.tenant_id = "another-tenant".into(),
            2 => wrong.connection_name = "another-connection".into(),
            3 => wrong.conversation_id = "another-chat".into(),
            4 => wrong.ms_teams_user_id = "another-user".into(),
            _ => wrong.entra_object_id = "another-entra-user".into(),
        }
        assert!(
            host.claim_pending_sign_ins(&wrong, Some("exchange-1"))
                .await
                .unwrap()
                .is_empty()
        );
        assert!(
            host.claim_pending_sign_ins(&wrong, None)
                .await
                .unwrap()
                .is_empty()
        );
    }
    assert!(
        host.claim_pending_sign_ins(&original, Some("another-exchange"))
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        host.claim_pending_sign_ins(&original, Some("exchange-1"))
            .await
            .unwrap()
            .len(),
        1
    );
}

/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn interactive_callback_preserves_original_group_routing_and_attachments(
    pool: Pool<Postgres>,
) {
    let (config, _server) = setup_mock_llm_server(None).await;
    let host = Host::new(test_app_state(config, pool).await);
    let mut group = request("question");
    group.conversation.as_mut().unwrap().id = "19:group".into();
    group.conversation.as_mut().unwrap().conversation_type = Some("groupChat".into());
    group.attachments = serde_json::from_value(json!([{
        "contentType": "reference", "name": "report.docx", "contentUrl": "https://example.sharepoint.com/report.docx"
    }])).unwrap();
    let personal_scope = scope(&request("callback"));
    host.remember_sign_in(&personal_scope, None, &group)
        .await
        .unwrap();
    let resumed = host
        .claim_pending_sign_ins(&personal_scope, None)
        .await
        .unwrap();
    assert_eq!(resumed.len(), 1);
    assert_eq!(resumed[0].conversation_id(), Some("19:group"));
    assert_eq!(resumed[0].conversation_kind(), ConversationKind::GroupChat);
    assert_eq!(resumed[0].incoming_files(), group.incoming_files());
    assert!(
        host.has_sign_in_request(&scope(&group), &group)
            .await
            .unwrap()
    );
    assert!(
        host.claim_pending_sign_ins(&personal_scope, None)
            .await
            .unwrap()
            .is_empty()
    );
}

/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn expired_requests_are_not_resumed_and_new_sign_in_cleans_them_up(pool: Pool<Postgres>) {
    let (config, _server) = setup_mock_llm_server(None).await;
    let state = test_app_state(config, pool).await;
    let host = Host::new(state.clone());
    let activity = request("expired");
    let scope = scope(&activity);
    host.remember_sign_in(&scope, Some("old-exchange"), &activity)
        .await
        .unwrap();
    let mut expired = pending::Entity::find()
        .one(&state.db)
        .await
        .unwrap()
        .unwrap()
        .into_active_model();
    expired.expires_at = Set((chrono::Utc::now() - chrono::Duration::minutes(1)).into());
    expired.update(&state.db).await.unwrap();
    assert!(
        host.claim_pending_sign_ins(&scope, Some("old-exchange"))
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        host.claim_pending_sign_ins(&scope, None)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(!host.has_sign_in_request(&scope, &activity).await.unwrap());
    assert!(
        host.remember_sign_in(&scope, Some("new-exchange"), &request("fresh"))
            .await
            .unwrap()
    );
    let rows = pending::Entity::find().all(&state.db).await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].source_activity_id, "fresh");
}

/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "MIGRATOR")]
async fn card_failure_allows_retry_but_cannot_erase_a_consumed_claim(pool: Pool<Postgres>) {
    let (config, _server) = setup_mock_llm_server(None).await;
    let host = Host::new(test_app_state(config, pool).await);
    let activity = request("question");
    let scope = scope(&activity);
    host.remember_sign_in(&scope, Some("failed-exchange"), &activity)
        .await
        .unwrap();
    host.discard_sign_in(&scope, &activity).await.unwrap();
    assert!(!host.has_sign_in_request(&scope, &activity).await.unwrap());
    assert!(
        host.remember_sign_in(&scope, Some("working-exchange"), &activity)
            .await
            .unwrap()
    );
    assert_eq!(
        host.claim_pending_sign_ins(&scope, None)
            .await
            .unwrap()
            .len(),
        1
    );
    host.discard_sign_in(&scope, &activity).await.unwrap();
    assert!(host.has_sign_in_request(&scope, &activity).await.unwrap());
}
