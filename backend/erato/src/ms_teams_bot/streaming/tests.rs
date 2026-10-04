use super::*;
use axum::{
    Json, Router,
    extract::{OriginalUri, State},
    http::{Method, StatusCode},
    response::IntoResponse,
    routing::post,
};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
struct Endpoint {
    requests: Arc<Mutex<Vec<(Method, String, Value)>>>,
    responses: Arc<Mutex<VecDeque<(StatusCode, Value)>>>,
}

async fn receive(
    State(state): State<Endpoint>,
    method: Method,
    uri: OriginalUri,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let multiple_activities = method == Method::PUT
        && body["attachments"].as_array().is_some_and(|attachments| {
            attachments.len() > 1
                || (!attachments.is_empty()
                    && body["text"].as_str().is_some_and(|text| !text.is_empty()))
        });
    state
        .requests
        .lock()
        .unwrap()
        .push((method, uri.0.path().to_string(), body));
    // Real Teams rejects editing text and a card together: those expand into
    // multiple Skype activities. Our old permissive mock missed this bug.
    if multiple_activities {
        return (
            StatusCode::BAD_REQUEST,
            [("Retry-After", "3")],
            Json(json!({
                "error": {"code": "BadSyntax", "message": "Activity resulted into multiple skype activities"}
            })),
        );
    }
    let (status, response) = state
        .responses
        .lock()
        .unwrap()
        .pop_front()
        .unwrap_or((StatusCode::OK, json!({"id": "reply-1"})));
    (status, [("Retry-After", "3")], Json(response))
}

struct Harness {
    connector: Connector,
    base: String,
    endpoint: Endpoint,
    server: tokio::task::JoinHandle<()>,
}

impl Harness {
    async fn new() -> Self {
        let endpoint = Endpoint::default();
        let router = Router::new()
            .route("/v3/conversations/{conversation}/activities", post(receive))
            .route(
                "/v3/conversations/{conversation}/activities/{activity}",
                post(receive).put(receive),
            )
            .with_state(endpoint.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        Self {
            connector: Connector::with_test_token(reqwest::Client::new()),
            base,
            endpoint,
            server,
        }
    }

    fn target(&self) -> ReplyTarget<'_> {
        ReplyTarget {
            connector: &self.connector,
            service_url: &self.base,
            conversation_id: "conversation",
            reply_to_id: None,
            mention: None,
        }
    }

    fn requests(&self) -> Vec<(Method, String, Value)> {
        self.endpoint.requests.lock().unwrap().clone()
    }

    fn fail_next(&self, status: StatusCode, code: &str, message: &str) {
        self.endpoint
            .responses
            .lock()
            .unwrap()
            .push_back((status, json!({"error": {"code": code, "message": message}})));
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        self.server.abort();
    }
}

fn ready(reply: &mut StreamingReply<'_>) {
    reply.next_update = Instant::now();
}

#[tokio::test]
async fn native_status_and_text_coalesce_and_flush_without_another_model_event() {
    let h = Harness::new().await;
    let target = h.target();
    let mut reply = StreamingReply::new(&target, true);
    reply.informative("Working…").await;
    reply.informative("Preparing search…").await;
    reply.informative("Searching documents…").await;
    assert_eq!(
        h.requests().len(),
        1,
        "informative updates obey the throttle too"
    );
    ready(&mut reply);
    reply.flush().await;
    reply.update("Hello").await;
    assert_eq!(h.requests().len(), 2);
    ready(&mut reply);
    reply.flush().await;
    ready(&mut reply);
    reply.finish("Hello world").await.unwrap();
    let requests = h.requests();
    assert_eq!(requests.len(), 4);
    for (index, (_, _, body)) in requests[..3].iter().enumerate() {
        assert_eq!(body["entities"][0]["streamSequence"], index + 1);
    }
    assert_eq!(requests[1].2["text"], "Searching documents…");
    assert_eq!(requests[2].2["text"], "Hello");
    let final_body = &requests[3].2;
    assert_eq!(final_body["entities"][0]["streamId"], "reply-1");
    assert_eq!(final_body["entities"][0]["streamType"], "final");
    assert!(final_body["entities"][0].get("streamSequence").is_none());
    assert_eq!(final_body["text"], "Hello world");
}

#[tokio::test]
async fn channel_progress_edits_the_original_thread_reply_and_keeps_the_mention() {
    let h = Harness::new().await;
    let mut target = h.target();
    target.reply_to_id = Some("user-message");
    target.mention = Some(render::Mention {
        id: "29:user".into(),
        name: "Daniel".into(),
    });
    let mut reply = StreamingReply::new(&target, false);
    reply.preparing("Reading attachments…").await;
    ready(&mut reply);
    reply.update("Partial answer").await;
    ready(&mut reply);
    reply.informative("Searching… (2/5)").await;
    ready(&mut reply);
    reply.finish("Final answer").await.unwrap();
    let requests = h.requests();
    assert_eq!(requests[0].0, Method::POST);
    assert!(requests[0].1.ends_with("/user-message"));
    assert_eq!(requests.len(), 4);
    for (method, path, body) in &requests[1..] {
        assert_eq!(method, Method::PUT);
        assert!(path.ends_with("/reply-1"));
        assert_eq!(body["id"], "reply-1");
        assert_eq!(body["entities"][0]["mentioned"]["id"], "29:user");
    }
    assert!(
        requests[2].2["text"]
            .as_str()
            .unwrap()
            .contains("**Working…**\n\nSearching… (2/5)\n\nPartial answer")
    );
    assert_eq!(requests[3].2["text"], "<at>Daniel</at> Final answer");
}

#[tokio::test]
async fn tool_after_text_closes_the_stream_then_edits_that_same_message() {
    let h = Harness::new().await;
    let target = h.target();
    let mut reply = StreamingReply::new(&target, true);
    reply.update("I will check.").await;
    ready(&mut reply);
    reply.update("").await;
    reply.informative("Searching documents…").await;
    let requests = h.requests();
    assert_eq!(requests[1].2["entities"][0]["streamType"], "final");
    assert_eq!(requests[1].2["text"], "I will check.");
    ready(&mut reply);
    reply.flush().await;
    ready(&mut reply);
    reply
        .finish_with_details("Here is the result.", "I will check.")
        .await
        .unwrap();
    let requests = h.requests();
    assert_eq!(requests.len(), 5);
    assert_eq!(requests[2].0, Method::PUT);
    assert_eq!(
        requests[2].2["text"],
        "**Working…**\n\nSearching documents…"
    );
    assert_eq!(requests[3].0, Method::PUT);
    assert_eq!(requests[3].2["text"], "Here is the result.");
    assert!(requests[3].1.ends_with("/reply-1"));
    assert!(requests[3].2.get("attachments").is_none());
    assert_eq!(requests[4].0, Method::POST);
    assert!(requests[4].2.get("text").is_none());
    assert_eq!(requests[4].2["summary"], "Earlier steps: I will check.");
    let action = &requests[4].2["attachments"][0]["content"]["actions"][0];
    assert_eq!(action["type"], "Action.ShowCard");
    assert_eq!(action["card"]["body"][0]["text"], "I will check.");
    assert!(requests[2].2.get("attachments").is_none());
}

#[tokio::test]
async fn final_answer_and_details_are_separate_activities_even_on_delivery_fallback() {
    for fallback in [false, true] {
        let h = Harness::new().await;
        let target = h.target();
        let mut reply = StreamingReply::new(&target, !fallback);
        reply.informative("Working…").await;
        if fallback {
            h.fail_next(StatusCode::NOT_FOUND, "NotFound", "Message unavailable");
        }
        ready(&mut reply);
        reply
            .finish_with_details("Answer", "Earlier finding")
            .await
            .unwrap();
        let requests = h.requests();
        let last = &requests.last().unwrap().2;
        let answer = &requests[requests.len() - 2].2;
        assert_eq!(answer["text"], "Answer");
        assert!(answer.get("attachments").is_none());
        assert!(last.get("text").is_none());
        assert_eq!(
            last["attachments"][0]["content"]["actions"][0]["card"]["body"][0]["text"],
            "Earlier finding"
        );
        if !fallback {
            assert_eq!(answer["entities"][0]["streamType"], "final");
        }
    }
}

#[tokio::test]
async fn rejected_details_card_keeps_the_answer_settled_and_preserves_earlier_text() {
    let h = Harness::new().await;
    let target = h.target();
    let mut reply = StreamingReply::new(&target, false);
    reply.informative("Working…").await;
    h.endpoint.responses.lock().unwrap().extend([
        (StatusCode::OK, json!({"id": "reply-1"})),
        (
            StatusCode::BAD_REQUEST,
            json!({"error": {"code": "BadSyntax", "message": "Card rejected"}}),
        ),
    ]);
    ready(&mut reply);
    reply
        .finish_with_details("Final answer", "Earlier finding")
        .await
        .unwrap();
    let requests = h.requests();
    assert_eq!(requests.len(), 4);
    assert_eq!(requests[1].0, Method::PUT);
    assert!(requests[1].1.ends_with("/reply-1"));
    assert_eq!(requests[1].2["text"], "Final answer");
    assert!(requests[1].2.get("attachments").is_none());
    assert_eq!(
        requests[3].2["text"],
        "**Earlier steps**\n\nEarlier finding"
    );
}

#[tokio::test]
async fn a_failed_new_post_is_not_sent_again() {
    let h = Harness::new().await;
    h.fail_next(StatusCode::BAD_GATEWAY, "BadGateway", "Upstream timed out");
    let target = h.target();
    let mut reply = StreamingReply::new(&target, false);
    assert!(reply.finish("Answer").await.is_err());
    assert_eq!(h.requests().len(), 1);
}

#[tokio::test]
async fn silent_long_tool_closes_before_the_deadline_and_remains_editable() {
    let h = Harness::new().await;
    let target = h.target();
    let mut reply = StreamingReply::new(&target, true);
    reply.informative("Running tool…").await;
    reply.started = Some(Instant::now() - MAX_STREAM_DURATION);
    ready(&mut reply);
    reply.flush().await;
    assert!(!reply.native);
    assert_eq!(h.requests()[1].2["entities"][0]["streamType"], "final");
    ready(&mut reply);
    reply.finish("Done").await.unwrap();
    assert_eq!(h.requests()[2].0, Method::PUT);
    assert_eq!(h.requests()[2].2["text"], "Done");
}

#[tokio::test]
async fn throttling_retains_the_latest_status_and_reuses_the_sequence() {
    let h = Harness::new().await;
    h.fail_next(
        StatusCode::TOO_MANY_REQUESTS,
        "TooManyRequests",
        "Slow down",
    );
    let target = h.target();
    let mut reply = StreamingReply::new(&target, true);
    reply.informative("Working…").await;
    assert!(reply.next_update.duration_since(Instant::now()) > Duration::from_secs(2));
    reply.informative("Searching…").await;
    assert_eq!(h.requests().len(), 1);
    ready(&mut reply);
    reply.flush().await;
    assert!(reply.native);
    assert_eq!(h.requests()[1].2["entities"][0]["streamSequence"], 1);
    assert_eq!(h.requests()[1].2["text"], "Searching…");
}

#[tokio::test]
async fn user_stop_never_creates_a_fallback_or_final_answer() {
    for message in [
        "Content stream was canceled by user.",
        "Content stream was cancelled by user.",
    ] {
        let h = Harness::new().await;
        let target = h.target();
        let mut reply = StreamingReply::new(&target, true);
        reply.update("Hello").await;
        h.fail_next(StatusCode::FORBIDDEN, "ContentStreamNotAllowed", message);
        ready(&mut reply);
        reply.update("Hello world").await;
        assert!(reply.is_cancelled());
        ready(&mut reply);
        reply
            .finish_with_details("Hello world, finished", "Earlier finding")
            .await
            .unwrap();
        reply.flush().await;
        reply.finish_stopped().await.unwrap();
        assert!(reply.is_cancelled());
        assert!(!reply.native_stop_available());
        assert_eq!(h.requests().len(), 2);
    }
}

#[tokio::test]
async fn native_stop_exists_only_until_the_stream_switches_to_editable_progress() {
    let h = Harness::new().await;
    let target = h.target();
    let mut reply = StreamingReply::new(&target, true);
    assert!(!reply.native_stop_available());
    reply.update("I am checking…").await;
    assert!(reply.native_stop_available());
    ready(&mut reply);
    reply.informative("Reading the file…").await;
    assert!(!reply.native_stop_available());
    assert_eq!(
        h.requests().last().unwrap().2["entities"][0]["streamType"],
        "final"
    );
}

#[tokio::test]
async fn custom_stop_settles_editable_progress_with_partial_answer() {
    let h = Harness::new().await;
    let target = h.target();
    let mut reply = StreamingReply::new(&target, false);
    reply.update("Partial answer").await;
    ready(&mut reply);
    reply.finish_stopped().await.unwrap();
    let requests = h.requests();
    assert_eq!(requests.last().unwrap().0, Method::PUT);
    assert_eq!(
        requests.last().unwrap().2["text"],
        "**Stopped.**\n\nPartial answer"
    );
}

#[tokio::test]
async fn unavailable_streaming_falls_back_to_one_editable_reply() {
    let h = Harness::new().await;
    h.fail_next(
        StatusCode::FORBIDDEN,
        "ContentStreamNotAllowed",
        "Content stream is not allowed",
    );
    let target = h.target();
    let mut reply = StreamingReply::new(&target, true);
    reply.informative("Working…").await;
    ready(&mut reply);
    reply.flush().await;
    ready(&mut reply);
    reply.finish("Done").await.unwrap();
    let requests = h.requests();
    assert_eq!(requests[1].2["type"], "message");
    assert_eq!(requests[2].0, Method::PUT);
    assert_eq!(requests[2].2["text"], "Done");
}

#[tokio::test]
async fn long_final_answer_keeps_all_chunks_and_replaces_the_progress_message() {
    let h = Harness::new().await;
    let target = h.target();
    let mut reply = StreamingReply::new(&target, false);
    reply.informative("Working…").await;
    ready(&mut reply);
    let answer = "界".repeat(MAX_MESSAGE_CHARS + 100);
    reply.finish(&answer).await.unwrap();
    let requests = h.requests();
    assert_eq!(requests[1].0, Method::PUT);
    assert_eq!(requests[2].0, Method::POST);
    assert_eq!(
        requests[1..]
            .iter()
            .map(|(_, _, body)| body["text"].as_str().unwrap())
            .collect::<String>(),
        answer
    );
    assert!(
        requests[1..]
            .iter()
            .all(|(_, _, body)| serde_json::to_vec(body).unwrap().len() < 28_000)
    );
}

fn citation_fixture() -> (String, Vec<FileSource>) {
    let id = "b5b55034-adb0-45f1-a841-6f2906f52a3c";
    (
        format!("Result from [Report](erato-file://{id}#page=2)."),
        vec![FileSource {
            id: id.into(),
            name: "Report.pdf".into(),
        }],
    )
}

fn assert_cited(body: &Value) {
    assert_eq!(body["text"], "Result from Report [1].");
    let root = body["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entity| entity["@type"] == "Message")
        .unwrap();
    assert_eq!(root["citation"][0]["appearance"]["name"], "Report.pdf");
    assert_eq!(root["citation"][0]["appearance"]["abstract"], "Page 2");
    assert!(
        root["citation"][0]["appearance"]["url"]
            .as_str()
            .unwrap()
            .ends_with("/preview#page=2")
    );
}

#[tokio::test]
async fn file_citations_survive_native_final_editable_final_and_rejected_edit_fallback() {
    for (native, rejected_edit) in [(true, false), (false, false), (false, true)] {
        let h = Harness::new().await;
        let target = h.target();
        let mut reply = StreamingReply::new(&target, native);
        reply.informative("Working…").await;
        if rejected_edit {
            h.fail_next(StatusCode::BAD_REQUEST, "BadSyntax", "Cannot edit");
        }
        ready(&mut reply);
        let (answer, sources) = citation_fixture();
        reply
            .finish_with_sources(
                &answer,
                "Earlier step",
                &sources,
                Some("https://erato.example"),
            )
            .await
            .unwrap();
        let requests = h.requests();
        let (_, _, final_answer) = &requests[requests.len() - 2];
        assert_cited(final_answer);
        if native {
            assert_eq!(final_answer["entities"][0]["streamType"], "final");
        }
        assert!(
            requests.last().unwrap().2["attachments"].is_array(),
            "details remain separate"
        );
        assert!(requests.last().unwrap().2.get("entities").is_none());
    }
}

#[tokio::test]
async fn citations_replace_already_streamed_file_links_in_the_same_activity() {
    let h = Harness::new().await;
    let target = h.target();
    let mut reply = StreamingReply::new(&target, true);
    let (answer, sources) = citation_fixture();
    reply.update(&answer).await;
    ready(&mut reply);
    reply
        .finish_with_sources(&answer, "", &sources, Some("https://erato.example"))
        .await
        .unwrap();
    let requests = h.requests();
    let (method, path, body) = requests.last().unwrap();
    assert_eq!(*method, Method::PUT);
    assert!(path.ends_with("/reply-1"));
    assert_eq!(body["id"], "reply-1");
    assert_cited(body);
}

#[tokio::test]
async fn split_cited_answers_keep_metadata_on_the_chunk_containing_the_reference() {
    let h = Harness::new().await;
    let target = h.target();
    let mut reply = StreamingReply::new(&target, false);
    let (answer, sources) = citation_fixture();
    let answer = format!("{}\n\n{answer}", "界".repeat(12_000));
    reply
        .finish_with_sources(&answer, "", &sources, Some("https://erato.example"))
        .await
        .unwrap();
    let requests = h.requests();
    assert!(requests.len() > 1);
    let cited: Vec<_> = requests
        .iter()
        .filter(|(_, _, body)| body.get("entities").is_some())
        .collect();
    assert_eq!(cited.len(), 1);
    assert!(cited[0].2["text"].as_str().unwrap().contains("Report [1]"));
    assert_eq!(cited[0].2["entities"][0]["citation"][0]["position"], 1);
    assert!(
        requests
            .iter()
            .all(|(_, _, body)| serde_json::to_vec(body).unwrap().len() < 28_000)
    );
}

#[test]
fn informative_text_is_bounded_by_utf8_bytes() {
    let status = short_status(&"界".repeat(1_000));
    assert!(status.len() <= MAX_STATUS_BYTES);
    assert!(status.ends_with('…'));
}
