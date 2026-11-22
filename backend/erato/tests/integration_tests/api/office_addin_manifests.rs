//! Office add-in manifest routes, exercised through the HTTP router.

use std::path::{Path, PathBuf};

use axum::http::StatusCode;
use axum::{Extension, Router};
use axum_test::TestServer;
use erato::frontend_environment::DeploymentVersion;
use erato::server::router::router;
use sqlx::Pool;
use sqlx::postgres::Postgres;
use tempfile::TempDir;

use crate::test_app_state;
use crate::test_utils::hermetic_app_config;

const PRESENTATION_MANIFEST_PATH: &str = "/office-addin/manifest-presentation.xml";
const BASE_URL_QUERY: &str = "base_url=https://app.example.com";

fn stock_manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../office-addin/manifests")
}

fn office_addin_bundle(manifest_names: &[&str]) -> TempDir {
    let bundle = tempfile::tempdir().expect("create bundle directory");
    for name in manifest_names {
        std::fs::copy(stock_manifest_dir().join(name), bundle.path().join(name))
            .expect("copy stock manifest template");
    }
    bundle
}

async fn manifest_server(pool: Pool<Postgres>, bundle_root: &Path) -> TestServer {
    let mut config = hermetic_app_config(None, None);
    config.integrations.ms_office.addin.enabled = true;
    config.integrations.ms_office.addin.frontend_bundle_path = bundle_root.display().to_string();
    let app_state = test_app_state(config, pool).await;
    let app: Router = router(app_state.clone())
        .split_for_parts()
        .0
        .with_state(app_state)
        .layer(Extension(DeploymentVersion(None)));

    TestServer::new(app.into_make_service()).expect("Failed to create test server")
}

/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_presentation_manifest_route_serves_both_distributions(pool: Pool<Postgres>) {
    let bundle = office_addin_bundle(&["manifest-presentation.xml"]);
    let server = manifest_server(pool, bundle.path()).await;

    let response = server
        .get(&format!("{PRESENTATION_MANIFEST_PATH}?{BASE_URL_QUERY}"))
        .await;
    response.assert_status_ok();
    assert_eq!(
        response.header("content-type"),
        "application/xml; charset=utf-8"
    );
    let standard = response.text();
    assert!(standard.contains(r#"<Host Name="Presentation" />"#));
    assert!(standard.contains("<Id>f13aa6d0-f017-46e3-8b17-a72159d689ea</Id>"));
    assert!(standard.contains(
        r#"<SourceLocation DefaultValue="https://app.example.com/office-addin/powerpoint" />"#
    ));
    assert!(standard.contains("<VersionOverrides"));
    assert!(!standard.contains("{{"));

    let response = server
        .get(&format!(
            "{PRESENTATION_MANIFEST_PATH}?{BASE_URL_QUERY}&distribution=sharepoint"
        ))
        .await;
    response.assert_status_ok();
    let sharepoint = response.text();
    assert!(sharepoint.contains(r#"<Host Name="Presentation" />"#));
    assert!(!sharepoint.contains("VersionOverrides"));
}

/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_presentation_manifest_route_rejects_an_unknown_distribution(pool: Pool<Postgres>) {
    let bundle = office_addin_bundle(&["manifest-presentation.xml"]);
    let server = manifest_server(pool, bundle.path()).await;

    let response = server
        .get(&format!(
            "{PRESENTATION_MANIFEST_PATH}?{BASE_URL_QUERY}&distribution=network-share"
        ))
        .await;
    response.assert_status(StatusCode::BAD_REQUEST);
}

/// An add-in bundle built before the PowerPoint template existed.
///
/// # Test Categories
/// - `uses-db`
#[sqlx::test(migrator = "crate::MIGRATOR")]
async fn test_presentation_manifest_route_is_not_found_without_its_template(pool: Pool<Postgres>) {
    let bundle = office_addin_bundle(&["manifest-document.xml"]);
    let server = manifest_server(pool, bundle.path()).await;

    server
        .get(&format!("{PRESENTATION_MANIFEST_PATH}?{BASE_URL_QUERY}"))
        .await
        .assert_status(StatusCode::NOT_FOUND);
    server
        .get(&format!(
            "/office-addin/manifest-document.xml?{BASE_URL_QUERY}"
        ))
        .await
        .assert_status_ok();
}
