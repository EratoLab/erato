use super::*;
use futures::StreamExt;
use sea_orm::{ConnectionTrait, TransactionTrait};

async fn serve(state: &erato::state::AppState) -> (String, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}/api/v1beta", listener.local_addr().unwrap());
    let app = router(state.clone())
        .split_for_parts()
        .0
        .with_state(state.clone());
    (
        base,
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        }),
    )
}

fn interactive(base: &str, path: &str) -> reqwest::RequestBuilder {
    reqwest::Client::new()
        .post(format!("{base}{path}"))
        .bearer_auth(TEST_JWT_TOKEN)
        .header("Accept", "text/event-stream")
        .header("X-Erato-Client-Tools", TOOL)
        .header(
            "X-Erato-Executor",
            serde_json::to_string(&mailbox()).unwrap(),
        )
}

async fn next_call<S, B>(stream: &mut S) -> (Uuid, String)
where
    S: futures::Stream<Item = Result<B, reqwest::Error>> + Unpin,
    B: AsRef<[u8]>,
{
    tokio::time::timeout(Duration::from_secs(15), async {
        let mut buffer = String::new();
        while let Some(bytes) = stream.next().await {
            buffer.push_str(&String::from_utf8_lossy(bytes.unwrap().as_ref()));
            for line in buffer.lines() {
                if let Some(data) = line.strip_prefix("data:")
                    && let Ok(value) = serde_json::from_str::<Value>(data.trim())
                    && value["message_type"] == "client_tool_call"
                {
                    return (
                        value["message_id"].as_str().unwrap().parse().unwrap(),
                        value["tool_call_id"].as_str().unwrap().into(),
                    );
                }
            }
        }
        panic!("stream ended without a client call: {buffer}");
    })
    .await
    .expect("live client call")
}

async fn wait_park(setup: &Setup, count: usize) -> OperationRequest {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let rows = chat_attempts(&setup.state, setup.chat_id).await;
            let chat = chats::Entity::find_by_id(setup.chat_id)
                .one(&setup.state.db)
                .await
                .unwrap()
                .unwrap();
            if rows.len() == count && chat.generation_state.as_deref() == Some("awaiting_approval")
            {
                let row = rows
                    .into_iter()
                    .find(|row| row.state == AttemptState::Pending)
                    .unwrap();
                return serde_json::from_value(row.request).unwrap();
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("durable park")
}

async fn drop_first(setup: &Setup, base: &str) -> OperationRequest {
    let response = interactive(base, "/me/messages/submitstream")
        .json(
            &json!({"existing_chat_id":setup.chat_id,"user_message":"Read my availability twice."}),
        )
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success());
    let mut stream = response.bytes_stream();
    next_call(&mut stream).await;
    drop(stream);
    wait_park(setup, 1).await
}

async fn settle_fast(setup: &Setup, request: &OperationRequest) {
    let response = post_live(
        &setup.state,
        setup.chat_id,
        &(request.message_id, request.tool_call_id.clone()),
        json!({"result":availability()}),
        Some(&mailbox()),
    )
    .await;
    response.assert_status_ok();
    assert_eq!(response.json::<Value>()["stored"], true);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn second_availability_runs_live_in_one_attached_continuation(pool: Pool<Postgres>) {
    let setup = setup_reads(pool, 60_000, true, true, 2).await;
    let (base, server) = serve(&setup.state).await;
    let request = drop_first(&setup, &base).await;
    settle_fast(&setup, &request).await;
    let response = interactive(
        &base,
        &format!("/me/client-operations/{}/continue", request.attempt_id),
    )
    .send()
    .await
    .unwrap();
    assert_eq!(response.headers()["content-type"], "text/event-stream");
    let mut stream = response.bytes_stream();
    let call = next_call(&mut stream).await;
    assert!(call.1.ends_with("avail-call-2"));
    let result = post_live(
        &setup.state,
        setup.chat_id,
        &call,
        json!({"result":availability()}),
        Some(&mailbox()),
    )
    .await;
    result.assert_status_ok();
    assert_eq!(result.json::<Value>()["stored"], false);
    wait_completed(&setup.state, request.attempt_id).await;
    assert_eq!(chat_attempts(&setup.state, setup.chat_id).await.len(), 1);
    assert_eq!(turn_requests(&setup.recorder).len(), 3);
    assert!(
        assistant_message(&setup)
            .await
            .raw_message
            .to_string()
            .contains(ANSWER)
    );
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn attached_disconnect_reparks_without_recharging_or_replacing_results(pool: Pool<Postgres>) {
    let setup = setup_reads(pool, 60_000, true, true, 3).await;
    let (base, server) = serve(&setup.state).await;
    let first = drop_first(&setup, &base).await;
    settle_fast(&setup, &first).await;
    let response = interactive(
        &base,
        &format!("/me/client-operations/{}/continue", first.attempt_id),
    )
    .send()
    .await
    .unwrap();
    let mut stream = response.bytes_stream();
    let second_call = next_call(&mut stream).await;
    drop(stream);
    let second = wait_park(&setup, 2).await;
    assert_eq!(second.tool_call_id, second_call.1);
    assert_eq!(
        attempt(&setup.state, first.attempt_id).await.state,
        AttemptState::Completed
    );
    settle_fast(&setup, &second).await;
    settle_fast(&setup, &second).await;
    let response = interactive(
        &base,
        &format!("/me/client-operations/{}/continue", second.attempt_id),
    )
    .send()
    .await
    .unwrap();
    let mut stream = response.bytes_stream();
    let third = next_call(&mut stream).await;
    assert!(third.1.ends_with("avail-call-3"));
    post_live(
        &setup.state,
        setup.chat_id,
        &third,
        json!({"result":availability()}),
        Some(&mailbox()),
    )
    .await
    .assert_status_ok();
    wait_completed(&setup.state, second.attempt_id).await;
    let message = assistant_message(&setup).await;
    let consumption = &message.generation_parameters.as_ref().unwrap()["turn_consumption"];
    assert_eq!(consumption["tool_charges"].as_object().unwrap().len(), 3);
    assert_eq!(turn_requests(&setup.recorder).len(), 4);
    assert_eq!(chat_attempts(&setup.state, setup.chat_id).await.len(), 2);
    server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn other_replica_owns_resumestream_and_stale_release_cannot_displace_it(
    pool: Pool<Postgres>,
) {
    let setup = setup_reads(pool.clone(), 60_000, true, true, 3).await;
    let replica = test_app_state(setup.state.config.clone(), pool).await;
    let (base, server) = serve(&setup.state).await;
    let (remote, remote_server) = serve(&replica).await;
    let first = drop_first(&setup, &base).await;
    settle_fast(&setup, &first).await;
    let response = interactive(
        &base,
        &format!("/me/client-operations/{}/continue", first.attempt_id),
    )
    .send()
    .await
    .unwrap();
    let mut original = response.bytes_stream();
    let call = next_call(&mut original).await;
    let task = setup
        .state
        .background_tasks
        .get_task(&setup.chat_id)
        .await
        .unwrap();
    let old = transport::owner(&setup.state.db, task.generation_id)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    // Hold the next checkpoint while handing off between replicas: no timer
    // race with a pending durable call determines whether this test parks.
    let checkpoint = setup.state.db.begin().await.unwrap();
    checkpoint
        .query_one_raw(sea_orm::Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            "SELECT id FROM messages WHERE id = $1 FOR UPDATE",
            [first.message_id.into()],
        ))
        .await
        .unwrap();
    post_live(
        &setup.state,
        setup.chat_id,
        &call,
        json!({"result":availability()}),
        Some(&mailbox()),
    )
    .await
    .assert_status_ok();
    drop(original);
    tokio::time::timeout(Duration::from_secs(5), async {
        while transport::owner(&setup.state.db, task.generation_id)
            .await
            .unwrap()
            != Some(None)
        {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    let response = interactive(&remote, "/me/messages/resumestream")
        .json(&json!({"chat_id":setup.chat_id}))
        .send()
        .await
        .unwrap();
    let mut resumed = response.bytes_stream();
    let replay = next_call(&mut resumed).await;
    assert_eq!(replay, call);
    let owner = transport::owner(&setup.state.db, task.generation_id)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_ne!(owner, old);
    transport::renew(&setup.state.db, task.generation_id, old)
        .await
        .unwrap();
    transport::release(&setup.state.db, task.generation_id, old)
        .await
        .unwrap();
    assert_eq!(
        transport::owner(&setup.state.db, task.generation_id)
            .await
            .unwrap(),
        Some(Some(owner))
    );
    let observer = interactive(&base, "/me/messages/resumestream")
        .json(&json!({"chat_id":setup.chat_id}))
        .send()
        .await
        .unwrap();
    let mut observer = observer.bytes_stream();
    checkpoint.commit().await.unwrap();
    let third = next_call(&mut resumed).await;
    assert!(third.1.ends_with("avail-call-3"));
    post_live(
        &replica,
        setup.chat_id,
        &third,
        json!({"result":availability()}),
        Some(&mailbox()),
    )
    .await
    .assert_status_ok();
    let observed = tokio::time::timeout(Duration::from_secs(15), async {
        let mut data = String::new();
        while let Some(bytes) = observer.next().await {
            data.push_str(&String::from_utf8_lossy(&bytes.unwrap()));
            if data.contains("event: stream_end") {
                break;
            }
        }
        data
    })
    .await
    .unwrap();
    assert!(!observed.contains("event: client_tool_call"));
    wait_completed(&setup.state, first.attempt_id).await;
    assert_eq!(chat_attempts(&setup.state, setup.chat_id).await.len(), 1);
    assert_eq!(turn_requests(&setup.recorder).len(), 4);
    server.abort();
    remote_server.abort();
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn transport_lease_requires_binding_and_capability_and_fences_expired_owners(
    pool: Pool<Postgres>,
) {
    use erato::services::background_tasks::{Takeover, TaskOutcome};
    let setup = setup(pool, 60_000, true, true).await;
    let (_, task) = setup
        .state
        .background_tasks
        .try_start_task(setup.chat_id, Uuid::new_v4(), Takeover::TakeParked, 60)
        .await
        .unwrap();
    let db = &setup.state.db;
    transport::initialize(
        db,
        setup.chat_id,
        task.generation_id,
        &mailbox(),
        QUALIFIED,
        None,
    )
    .await
    .unwrap();
    let first = Uuid::new_v4();
    let second = Uuid::new_v4();
    let observer = erato::services::background_tasks::ClientStreamGuard::new(
        Some(db.clone()),
        task.generation_id,
        second,
        None,
    );
    assert!(!observer.allows_client_call(true).await);
    assert!(observer.allows_client_call(false).await);

    let registered = vec![TOOL.to_string()];
    assert!(
        !transport::acquire(
            db,
            setup.chat_id,
            task.generation_id,
            &mailbox_binding("other-device", 'a'),
            &registered,
            first
        )
        .await
        .unwrap()
    );
    assert!(
        !transport::acquire(
            db,
            setup.chat_id,
            task.generation_id,
            &mailbox_binding("device-one", 'b'),
            &registered,
            first
        )
        .await
        .unwrap()
    );
    assert!(
        !transport::acquire(
            db,
            setup.chat_id,
            task.generation_id,
            &mailbox(),
            &[],
            first
        )
        .await
        .unwrap()
    );
    assert!(
        transport::acquire(
            db,
            setup.chat_id,
            task.generation_id,
            &mailbox(),
            &registered,
            first
        )
        .await
        .unwrap()
    );
    assert!(
        !transport::acquire(
            db,
            setup.chat_id,
            task.generation_id,
            &mailbox(),
            &registered,
            second
        )
        .await
        .unwrap()
    );
    db.execute_unprepared(
        "UPDATE client_operation_transports SET expires_at = now() - interval '1 second'",
    )
    .await
    .unwrap();
    transport::renew(db, task.generation_id, first)
        .await
        .unwrap();
    assert_eq!(
        transport::owner(db, task.generation_id).await.unwrap(),
        Some(None)
    );
    assert!(
        transport::acquire(
            db,
            setup.chat_id,
            task.generation_id,
            &mailbox(),
            &registered,
            second
        )
        .await
        .unwrap()
    );
    transport::release(db, task.generation_id, first)
        .await
        .unwrap();
    transport::initialize(
        db,
        setup.chat_id,
        Uuid::new_v4(),
        &mailbox(),
        QUALIFIED,
        Some(first),
    )
    .await
    .unwrap();
    assert_eq!(
        transport::owner(db, task.generation_id).await.unwrap(),
        Some(Some(second))
    );
    assert!(observer.allows_client_call(true).await);
    setup
        .state
        .background_tasks
        .remove_task(&setup.chat_id, task.generation_id, TaskOutcome::Completed)
        .await;
    assert_eq!(
        transport::owner(db, task.generation_id).await.unwrap(),
        Some(None)
    );
    let (_, successor) = setup
        .state
        .background_tasks
        .try_start_task(setup.chat_id, Uuid::new_v4(), Takeover::TakeParked, 60)
        .await
        .unwrap();
    transport::initialize(
        db,
        setup.chat_id,
        successor.generation_id,
        &mailbox(),
        QUALIFIED,
        Some(Uuid::new_v4()),
    )
    .await
    .unwrap();
    assert!(!observer.allows_client_call(true).await);
    setup
        .state
        .background_tasks
        .remove_task(
            &setup.chat_id,
            successor.generation_id,
            TaskOutcome::Completed,
        )
        .await;
}
