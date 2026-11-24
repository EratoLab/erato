//! One approval, decided more than once: two taps at the same moment, a tap
//! and a spoken "Ich bestätige", a tap repeated because the answer to the
//! first was lost, two tabs or two replicas. However the decisions meet, the
//! approved call runs at most once and every decision after the one that was
//! taken is refused with a `409` the card answers by reading the row again.

use super::*;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

const ASK: &str = "Set the record to Done";
const DENIED: &str = "The user denied this tool call.";
const CHANGE: &str = "CHANGE nimm stattdessen Review";

/// How long the records server takes to write, as a CRM write takes a moment.
const WRITE_TAKES: Duration = Duration::from_millis(300);

/// Rounds of each simultaneous case: enough to see a race, run one after
/// another inside this test.
const ROUNDS: usize = 8;

/// The records server, counting each `update_record` call it receives.
struct Records {
    base_url: String,
    calls: Arc<AtomicUsize>,
}

impl Records {
    async fn serve() -> Self {
        let calls = Arc::new(AtomicUsize::new(0));
        let counted = calls.clone();
        let app = mock_mcp_server::app().layer(axum::middleware::from_fn(
            move |request: axum::extract::Request, next: axum::middleware::Next| {
                let counted = counted.clone();
                async move {
                    let (parts, body) = request.into_parts();
                    let bytes = axum::body::to_bytes(body, 1024 * 1024).await.unwrap();
                    let text = String::from_utf8_lossy(&bytes);
                    if text.contains("tools/call") && text.contains("update_record") {
                        counted.fetch_add(1, Ordering::SeqCst);
                        tokio::time::sleep(WRITE_TAKES).await;
                    }
                    next.run(axum::extract::Request::from_parts(
                        parts,
                        axum::body::Body::from(bytes),
                    ))
                    .await
                }
            },
        ));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Self { base_url, calls }
    }

    fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
}

/// One replica of the app on `pool`, gated by the restrictive preset, with
/// deciding by voice on. `exclusive` turns on one of the settings that make
/// the chat's lease refuse a second holder.
async fn replica(
    pool: Pool<Postgres>,
    records: &Records,
    exclusive: bool,
) -> (erato::state::AppState, TestServer) {
    let mut mocks = MockSet::new();
    answers_with(
        &mut mocks,
        &[CHANGE],
        &[],
        build_openai_text_streaming_response(&["CHANGED"]),
    );
    answers_with(
        &mut mocks,
        &["updated to"],
        &[],
        build_openai_text_streaming_response(&["DONE"]),
    );
    answers_with(
        &mut mocks,
        &[DENIED],
        &[],
        build_openai_text_streaming_response(&["AFTER"]),
    );
    answers_with(
        &mut mocks,
        &[ASK],
        &["updated to", DENIED],
        build_openai_tool_calls_streaming_response(&[(
            "call_update",
            "update_record",
            json!({"id": mock_mcp_server::RECORD_ID, "status": "Done"}),
        )]),
    );
    let (mut config, _llm) = setup_mock_llm_server_with_mocks(mocks).await;
    config.mcp_servers.insert(
        "records".to_string(),
        mcp_server_config(
            &records.base_url,
            "/mcp/records",
            McpServerAuthenticationConfig::None,
        ),
    );
    config.mcp_server_permissions.rules.insert(
        "allow-records".to_string(),
        erato::config::McpServerPermissionRule::AllowAll {
            mcp_server_ids: vec!["records".to_string()],
        },
    );
    config.mcp_servers_global.approval = erato::config::McpToolApprovalConfig {
        enabled: true,
        preset: erato::config::McpToolApprovalPreset::Restrictive,
        allow_always: false,
    };
    config.approval_voice_commands.enabled = true;
    config.approval_voice_decisions.enabled = true;
    config.chat_history_compaction.enabled = exclusive;
    let app_state = test_app_state(config, pool).await;
    get_or_create_user(&app_state.db, TEST_USER_ISSUER, TEST_USER_SUBJECT, None)
        .await
        .unwrap();
    let server = app_server(app_state.clone());
    (app_state, server)
}

/// A new turn parked on the update's card: its message and approval id.
async fn park(server: &TestServer, app_state: &erato::state::AppState) -> (Uuid, String) {
    let response = server
        .post("/api/v1beta/me/messages/submitstream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({ "user_message": ASK }))
        .await;
    response.assert_status_ok();
    let message_id = Uuid::parse_str(&assistant_message_id_from_events(&parse_sse_events(
        &response,
    )))
    .unwrap();
    let content = message_content(app_state, message_id).await;
    let stop = content
        .iter()
        .find(|part| part["content_type"] == "tool_approval_request")
        .expect("parked on the update");
    let approval_id = stop["approvals"][0]["approval_id"]
        .as_str()
        .unwrap()
        .to_string();
    (message_id, approval_id)
}

/// A receipt for "Ich bestätige" said on the card.
async fn receipt(server: &TestServer, message_id: Uuid, approval_id: &str) -> Value {
    let response = server
        .post(&format!(
            "/api/v1beta/me/messages/{message_id}/approval-voice-command"
        ))
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({
            "transcript": "Ich bestätige.",
            "language": "de",
            "pieces": [
                {"id": "what", "role": "what", "state": "heard"},
                {"id": "request", "role": "request", "state": "heard"},
            ],
            "approval_id": approval_id,
            "signals": {
                "voice_stopped_at_ms": 1_700_000_000_000u64,
                "request_heard_at_ms": 1_699_999_999_000u64,
                "recording_started_at_ms": 1_700_000_000_050u64,
                "recording_ended_at_ms": 1_700_000_002_000u64,
                "first_speech_at_ms": 1_700_000_000_600u64,
                "speech_ms": 900,
                "recorded_ms": 1_900,
            },
        }))
        .await;
    response.assert_status_ok();
    let answer = response.json::<Value>();
    assert_eq!(answer["decision"]["status"], "accepted", "{answer}");
    answer["decision"]["receipt"].clone()
}

/// `decision` on the card, by tap, or by voice with `voice_receipt`.
async fn decide(
    server: &TestServer,
    message_id: Uuid,
    approval_id: &str,
    decision: &str,
    voice_receipt: Option<Value>,
) -> axum_test::TestResponse {
    let mut item = json!({"approval_id": approval_id, "decision": decision});
    if decision == "request_change" {
        item["change_request"] = json!(CHANGE);
    }
    if let Some(receipt) = voice_receipt {
        item["voice_receipt"] = receipt;
    }
    server
        .post("/api/v1beta/me/messages/continuestream")
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"message_id": message_id, "decisions": [item]}))
        .await
}

/// What one decision got: its status, and the refusal's code on a `409`.
fn outcome(response: &axum_test::TestResponse) -> String {
    let status = response.status_code().as_u16();
    if status == 409 {
        let code = serde_json::from_str::<Value>(&response.text())
            .ok()
            .and_then(|body| body["code"].as_str().map(str::to_string))
            .unwrap_or_else(|| response.text());
        format!("409 {code}")
    } else {
        status.to_string()
    }
}

/// What the settled row says: the decisions it holds for the card, and how
/// many of the call's results say the record was updated.
#[derive(Debug)]
struct Row {
    decisions: Vec<String>,
    updated: usize,
}

async fn settled(app_state: &erato::state::AppState, message_id: Uuid) -> Row {
    let content = message_content(app_state, message_id).await;
    let decisions = content
        .iter()
        .filter_map(|part| part["content_type"].as_str())
        .filter(|kind| *kind == "tool_approval" || *kind == "tool_rejection")
        .map(str::to_string)
        .collect();
    let updated = content
        .iter()
        .filter(|part| {
            part["content_type"] == "tool_use" && part.to_string().contains("updated to Done")
        })
        .count();
    Row { decisions, updated }
}

/// Waits until the records server has received `count` calls in all.
async fn until_called(records: &Records, count: usize) {
    for _ in 0..200 {
        if records.calls() >= count {
            return;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    panic!("the records server was never called");
}

/// Every way two decisions for one card can meet, `ROUNDS` times each where
/// they meet at the same moment. Returns a line per case for the report.
async fn decide_twice_everywhere(pool: Pool<Postgres>, exclusive: bool) -> Vec<String> {
    let records = Records::serve().await;
    let (app_state, server) = replica(pool.clone(), &records, exclusive).await;
    let (_other_state, other) = replica(pool, &records, exclusive).await;
    let mut report = Vec::new();
    let check =
        |case: &str, calls: usize, outcomes: Vec<String>, row: Row, report: &mut Vec<String>| {
            let taken = outcomes.iter().filter(|outcome| *outcome == "200").count();
            let refusals_read_again =
                outcomes
                    .iter()
                    .filter(|outcome| *outcome != "200")
                    .all(|refused| {
                        refused == "409 already_continued" || refused == "409 generation_running"
                    });
            // The row tells what happened: an approval exactly when the call ran,
            // and its result once.
            let row_true = match row.decisions.as_slice() {
                [kind] => (kind == "tool_approval") == (calls == 1) && row.updated == calls,
                _ => false,
            };
            let held = calls <= 1 && taken == 1 && refusals_read_again && row_true;
            report.push(format!(
                "{} {case}: calls={calls} outcomes={outcomes:?} row={:?} updated_on_row={}",
                if held { "ok  " } else { "FAIL" },
                row.decisions,
                row.updated,
            ));
        };

    for round in 0..ROUNDS {
        let (message_id, approval_id) = park(&server, &app_state).await;
        let before = records.calls();
        let (first, second) = tokio::join!(
            decide(&server, message_id, &approval_id, "approve", None),
            decide(&server, message_id, &approval_id, "approve", None),
        );
        check(
            &format!("tap and tap #{round}"),
            records.calls() - before,
            vec![outcome(&first), outcome(&second)],
            settled(&app_state, message_id).await,
            &mut report,
        );
    }

    for round in 0..ROUNDS {
        let (message_id, approval_id) = park(&server, &app_state).await;
        let spoken = receipt(&server, message_id, &approval_id).await;
        let before = records.calls();
        let (tap, voice) = tokio::join!(
            decide(&server, message_id, &approval_id, "approve", None),
            decide(&server, message_id, &approval_id, "approve", Some(spoken)),
        );
        check(
            &format!("tap and voice #{round}"),
            records.calls() - before,
            vec![outcome(&tap), outcome(&voice)],
            settled(&app_state, message_id).await,
            &mut report,
        );
    }

    for round in 0..ROUNDS {
        let (message_id, approval_id) = park(&server, &app_state).await;
        let before = records.calls();
        let (approve, reject) = tokio::join!(
            decide(&server, message_id, &approval_id, "approve", None),
            decide(&server, message_id, &approval_id, "reject", None),
        );
        check(
            &format!("approve and reject #{round}"),
            records.calls() - before,
            vec![outcome(&approve), outcome(&reject)],
            settled(&app_state, message_id).await,
            &mut report,
        );
    }

    for round in 0..ROUNDS {
        let (message_id, approval_id) = park(&server, &app_state).await;
        let before = records.calls();
        let (approve, change) = tokio::join!(
            decide(&server, message_id, &approval_id, "approve", None),
            decide(&server, message_id, &approval_id, "request_change", None),
        );
        check(
            &format!("approve and change request #{round}"),
            records.calls() - before,
            vec![outcome(&approve), outcome(&change)],
            settled(&app_state, message_id).await,
            &mut report,
        );
    }

    for round in 0..ROUNDS {
        let (message_id, approval_id) = park(&server, &app_state).await;
        let before = records.calls();
        let (here, there) = tokio::join!(
            decide(&server, message_id, &approval_id, "approve", None),
            decide(&other, message_id, &approval_id, "approve", None),
        );
        check(
            &format!("two replicas #{round}"),
            records.calls() - before,
            vec![outcome(&here), outcome(&there)],
            settled(&app_state, message_id).await,
            &mut report,
        );
    }

    // The answer to the first tap was lost while the write ran; the app
    // sends the tap again, to this replica and to another one.
    for (case, retry_on) in [
        ("retry while running", &server),
        ("retry elsewhere", &other),
    ] {
        let (message_id, approval_id) = park(&server, &app_state).await;
        let before = records.calls();
        let (first, retry) = tokio::join!(
            decide(&server, message_id, &approval_id, "approve", None),
            async {
                until_called(&records, before + 1).await;
                decide(retry_on, message_id, &approval_id, "approve", None).await
            },
        );
        check(
            case,
            records.calls() - before,
            vec![outcome(&first), outcome(&retry)],
            settled(&app_state, message_id).await,
            &mut report,
        );
    }

    let (message_id, approval_id) = park(&server, &app_state).await;
    let before = records.calls();
    let first = decide(&server, message_id, &approval_id, "approve", None).await;
    let second = decide(&server, message_id, &approval_id, "approve", None).await;
    check(
        "retry after the first finished",
        records.calls() - before,
        vec![outcome(&first), outcome(&second)],
        settled(&app_state, message_id).await,
        &mut report,
    );
    report
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn an_approval_decided_twice_runs_its_call_once(pool: Pool<Postgres>) {
    held_everywhere(decide_twice_everywhere(pool, false).await);
}

#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn an_approval_decided_twice_runs_its_call_once_on_an_exclusive_lease(pool: Pool<Postgres>) {
    held_everywhere(decide_twice_everywhere(pool, true).await);
}

/// Prints the report and fails on any case where the call ran more than once,
/// more or fewer than one decision was taken, or a refusal was not one the
/// card reads the row again on.
fn held_everywhere(report: Vec<String>) {
    let text = report.join("\n");
    println!("{text}");
    assert!(!text.contains("FAIL"), "{text}");
}
