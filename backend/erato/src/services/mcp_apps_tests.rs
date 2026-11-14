//! MCP Apps views read from the mock server's apps endpoint, in both
//! protocol eras.
use super::*;
use mock_mcp_server::{
    COUNTER_TOOL_NAME, COUNTER_VIEW_HTML, COUNTER_VIEW_URI, OVERSIZED_VIEW_URI, SLOW_VIEW_URI,
    WRONG_TYPE_VIEW_URI, counter_view_ui_meta,
};
use serde_json::{Value, json};

const ERAS: [&str; 2] = ["legacy", "stateless"];

/// The mock server, and the path of every `resources/read` it received.
async fn serve_counting_reads() -> (String, Arc<std::sync::Mutex<Vec<String>>>) {
    let reads = Arc::new(std::sync::Mutex::new(Vec::new()));
    let seen = reads.clone();
    let app = mock_mcp_server::app().layer(axum::middleware::from_fn(
        move |request: axum::extract::Request, next: axum::middleware::Next| {
            let seen = seen.clone();
            async move {
                let (parts, body) = request.into_parts();
                let bytes = axum::body::to_bytes(body, usize::MAX).await.unwrap();
                if serde_json::from_slice::<Value>(&bytes)
                    .is_ok_and(|message| message["method"] == "resources/read")
                {
                    seen.lock().unwrap().push(parts.uri.path().to_string());
                }
                next.run(axum::extract::Request::from_parts(parts, bytes.into()))
                    .await
            }
        },
    ));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (url, reads)
}

/// One server per protocol era on the apps endpoint, named after its era.
fn apps_config(url: &str, enabled: bool) -> AppConfig {
    let mut config = AppConfig::default();
    for era in ERAS {
        let server = serde_json::from_value(json!({
            "transport_type": "streamable_http",
            "url": format!("{url}/mcp/{era}/apps"),
            "protocol_mode": era,
            "mcp_apps": {"enabled": enabled, "sandbox_origin": "https://mcp-apps.example.com"},
        }))
        .unwrap();
        config.mcp_servers.insert(era.to_string(), server);
    }
    config
}

fn reads_of(reads: &std::sync::Mutex<Vec<String>>, era: &str) -> usize {
    let prefix = format!("/mcp/{era}/");
    reads
        .lock()
        .unwrap()
        .iter()
        .filter(|path| path.starts_with(&prefix))
        .count()
}

/// Everything logged while `run` runs, with what it returns.
async fn logged<T>(run: impl std::future::Future<Output = T>) -> (T, String) {
    #[derive(Clone, Default)]
    struct Capture(Arc<std::sync::Mutex<Vec<u8>>>);
    impl std::io::Write for Capture {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let capture = Capture::default();
    let writer = capture.clone();
    let subscriber = tracing_subscriber::fmt()
        .with_ansi(false)
        .with_writer(move || writer.clone())
        .finish();
    let output = {
        let _guard = tracing::subscriber::set_default(subscriber);
        run.await
    };
    let log = String::from_utf8(capture.0.lock().unwrap().clone()).unwrap();
    (output, log)
}

/// The tool list keeps each tool's view URI, and a view is read once per
/// server and URI: later calls, in any chat, are served from the cache until
/// the server's configuration changes.
#[tokio::test]
async fn a_view_is_read_once_per_server_and_uri_in_both_protocol_eras() {
    let (url, reads) = serve_counting_reads().await;
    let config = apps_config(&url, true);
    let manager = McpSessionManager::new(&config);
    let auth = McpRequestAuthContext::default();
    let chat = Uuid::new_v4();
    let tools = manager.list_tools(chat, &auth).await.unwrap();
    for era in ERAS {
        let counter = tools
            .iter()
            .find(|tool| tool.server_id == era && tool.tool.name == COUNTER_TOOL_NAME)
            .unwrap();
        assert_eq!(view_uri(&counter.tool), Some(COUNTER_VIEW_URI), "{era}");

        let named = Some(ToolResultView {
            server_id: era.to_string(),
            uri: COUNTER_VIEW_URI.to_string(),
            structured_content: None,
        });
        // Calls that ask at once share one read, and later ones find it kept.
        let at_once = join_all(
            [chat, chat, Uuid::new_v4()]
                .map(|chat| manager.app_view_for_call(chat, era, COUNTER_VIEW_URI, &auth)),
        )
        .await;
        assert_eq!(at_once, vec![named.clone(); 3], "{era}");
        for chat in [chat, Uuid::new_v4()] {
            assert_eq!(
                manager
                    .app_view_for_call(chat, era, COUNTER_VIEW_URI, &auth)
                    .await,
                named,
                "{era}"
            );
        }
        let view = manager
            .read_app_view(ENUMERATION_CHAT_ID, era, COUNTER_VIEW_URI, &auth)
            .await
            .unwrap();
        assert_eq!(view.html, COUNTER_VIEW_HTML, "{era}");
        assert_eq!(view.ui, Some(counter_view_ui_meta()), "{era}");
        assert_eq!(reads_of(&reads, era), 1, "{era}");
    }

    let mut next = McpRuntimeConfig::from_app_config(&config);
    next.mcp_servers.get_mut("legacy").unwrap().display_name = Some("Charts".into());
    assert_eq!(manager.reconfigure(&next).await, vec!["legacy"]);
    for era in ERAS {
        manager
            .read_app_view(chat, era, COUNTER_VIEW_URI, &auth)
            .await
            .unwrap();
    }
    assert_eq!(reads_of(&reads, "legacy"), 2, "a reload drops the view");
    assert_eq!(reads_of(&reads, "stateless"), 1);
}

/// A view of the wrong type or too large is refused with a log line and the
/// call is shown without a view. The refusal is remembered, so later calls do
/// not read the view again until `VIEW_FAILURE_RETRY_AFTER` has passed.
#[tokio::test]
async fn a_view_of_the_wrong_type_or_too_large_is_refused_with_a_log_line() {
    let (url, reads) = serve_counting_reads().await;
    let manager = McpSessionManager::new(&apps_config(&url, true));
    let auth = McpRequestAuthContext::default();
    let chat = Uuid::new_v4();
    for era in ERAS {
        for _call in 0..2 {
            for (uri, reason) in [
                (WRONG_TYPE_VIEW_URI, "MIME type"),
                (OVERSIZED_VIEW_URI, "more than the 8388608 kept"),
            ] {
                let (view, log) = logged(manager.app_view_for_call(chat, era, uri, &auth)).await;
                assert_eq!(view, None, "{era} {uri}");
                assert!(log.contains("MCP Apps view refused"), "{era} {uri}: {log}");
                assert!(log.contains(uri) && log.contains(reason), "{era}: {log}");
            }
        }
        assert_eq!(reads_of(&reads, era), 2, "{era}");
        // As if `VIEW_FAILURE_RETRY_AFTER` had passed.
        manager.app_view_failures.invalidate_all();
        assert_eq!(
            manager
                .app_view_for_call(chat, era, WRONG_TYPE_VIEW_URI, &auth)
                .await,
            None
        );
        assert_eq!(reads_of(&reads, era), 3, "{era}");
        assert!(!manager.app_views.iter().any(|(key, _)| key.0 == era));
        // A URI no tool declares is never read.
        assert!(
            manager
                .read_app_view(chat, era, "ui://mock/undeclared", &auth)
                .await
                .is_err()
        );
        assert_eq!(reads_of(&reads, era), 3, "{era}");
    }
}

/// A view whose read never answers is given up after `VIEW_READ_TIMEOUT`
/// with a log line, so the call settles without a view, in both eras. Only
/// the first call waits: the next ones are told at once.
#[tokio::test]
async fn a_view_that_never_answers_is_given_up_with_a_log_line() {
    let (url, reads) = serve_counting_reads().await;
    let manager = McpSessionManager::new(&apps_config(&url, true));
    let auth = McpRequestAuthContext::default();
    let chat = Uuid::new_v4();
    let started = tokio::time::Instant::now();
    let (views, log) =
        logged(join_all(ERAS.map(|era| {
            manager.app_view_for_call(chat, era, SLOW_VIEW_URI, &auth)
        })))
        .await;
    assert!(
        started.elapsed() < VIEW_READ_TIMEOUT + Duration::from_secs(5),
        "{:?}",
        started.elapsed()
    );
    assert_eq!(views, vec![None, None]);
    assert_eq!(log.matches("MCP Apps view refused").count(), 2, "{log}");
    assert!(
        log.contains(SLOW_VIEW_URI) && log.contains("not read within"),
        "{log}"
    );
    let again = tokio::time::Instant::now();
    for era in ERAS {
        assert_eq!(
            manager
                .app_view_for_call(Uuid::new_v4(), era, SLOW_VIEW_URI, &auth)
                .await,
            None
        );
        assert!(
            manager
                .read_app_view(ENUMERATION_CHAT_ID, era, SLOW_VIEW_URI, &auth)
                .await
                .is_err()
        );
    }
    assert!(
        again.elapsed() < Duration::from_secs(2),
        "{:?}",
        again.elapsed()
    );
    for era in ERAS {
        assert_eq!(reads_of(&reads, era), 1, "{era}");
    }
    assert!(manager.app_views.iter().next().is_none());
}

/// With MCP Apps off, no view is read and none is offered.
#[tokio::test]
async fn with_mcp_apps_off_no_view_is_read() {
    let (url, reads) = serve_counting_reads().await;
    let manager = McpSessionManager::new(&apps_config(&url, false));
    let auth = McpRequestAuthContext::default();
    let chat = Uuid::new_v4();
    for era in ERAS {
        assert_eq!(
            manager
                .app_view_for_call(chat, era, COUNTER_VIEW_URI, &auth)
                .await,
            None
        );
        assert!(
            manager
                .read_app_view(chat, era, COUNTER_VIEW_URI, &auth)
                .await
                .is_err()
        );
    }
    assert!(reads.lock().unwrap().is_empty());
}
