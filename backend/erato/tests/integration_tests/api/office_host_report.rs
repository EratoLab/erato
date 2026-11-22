//! Office add-in pane start reports.

use axum::Router;
use axum::http::StatusCode;
use axum_test::TestServer;
use erato::server::router::router;
use metrics::{
    Counter, CounterFn, Gauge, Histogram, Key, KeyName, Metadata, Recorder, SharedString, Unit,
};
use serde_json::json;
use sqlx::Pool;
use sqlx::postgres::Postgres;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use crate::test_app_state;
use crate::test_utils::{TEST_JWT_TOKEN, TestRequestAuthExt, setup_mock_llm_server};

#[derive(Default, Clone)]
struct CountingRecorder(Arc<Mutex<BTreeMap<String, u64>>>);

struct Cell(String, Arc<Mutex<BTreeMap<String, u64>>>);

impl CounterFn for Cell {
    fn increment(&self, value: u64) {
        *self.1.lock().unwrap().entry(self.0.clone()).or_default() += value;
    }
    fn absolute(&self, _value: u64) {}
}

impl Recorder for CountingRecorder {
    fn describe_counter(&self, _: KeyName, _: Option<Unit>, _: SharedString) {}
    fn describe_gauge(&self, _: KeyName, _: Option<Unit>, _: SharedString) {}
    fn describe_histogram(&self, _: KeyName, _: Option<Unit>, _: SharedString) {}
    fn register_counter(&self, key: &Key, _: &Metadata<'_>) -> Counter {
        let labels: Vec<String> = key
            .labels()
            .map(|label| format!("{}={}", label.key(), label.value()))
            .collect();
        let name = format!("{}{{{}}}", key.name(), labels.join(","));
        Counter::from_arc(Arc::new(Cell(name, self.0.clone())))
    }
    fn register_gauge(&self, _: &Key, _: &Metadata<'_>) -> Gauge {
        Gauge::noop()
    }
    fn register_histogram(&self, _: &Key, _: &Metadata<'_>) -> Histogram {
        Histogram::noop()
    }
}

/// A signed-in pane start is counted once; unauthenticated and malformed reports are not.
///
/// # Test Categories
/// - `uses-db`
/// - `auth-required`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn office_host_report_counts_signed_in_pane_starts_only(pool: Pool<Postgres>) {
    let (app_config, _server) = setup_mock_llm_server(None).await;
    let app_state = test_app_state(app_config, pool).await;
    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state);
    let server = TestServer::new(app.into_make_service()).expect("Failed to create test server");
    let recorder = CountingRecorder::default();
    // The test runtime and axum-test's mock transport run the handler on this thread.
    let _guard = metrics::set_default_local_recorder(&recorder);
    let path = "/api/v1beta/me/office-host-report";
    let report = json!({"host": "PowerPoint", "platform": "PC", "api_set": "1.5", "tier": "basic"});

    server
        .post(path)
        .json(&report)
        .await
        .assert_status(StatusCode::UNAUTHORIZED);
    server
        .post(path)
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"host": "PowerPoint", "version": "16.0.20527.20000"}))
        .await
        .assert_status(StatusCode::UNPROCESSABLE_ENTITY);
    server
        .post(path)
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"platform": "PC"}))
        .await
        .assert_status(StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(recorder.0.lock().unwrap().clone(), BTreeMap::new());

    server
        .post(path)
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&report)
        .await
        .assert_status(StatusCode::NO_CONTENT);
    server
        .post(path)
        .with_bearer_token(TEST_JWT_TOKEN)
        .json(&json!({"host": "Outlook", "platform": "Mac"}))
        .await
        .assert_status(StatusCode::NO_CONTENT);
    assert_eq!(
        recorder.0.lock().unwrap().clone(),
        BTreeMap::from([
            (
                "erato_office_addin_pane_starts_total{host=Outlook,platform=Mac,api_set=,tier=}"
                    .to_string(),
                1
            ),
            (
                "erato_office_addin_pane_starts_total{host=PowerPoint,platform=PC,api_set=1.5,tier=basic}"
                    .to_string(),
                1
            ),
        ])
    );
}
