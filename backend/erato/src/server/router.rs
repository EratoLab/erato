use super::api::v1beta::ApiV1ApiDoc;
#[cfg(all(feature = "profiling", target_os = "linux"))]
use crate::profiling::{memory_profile_flamegraph, memory_profile_pprof};
use crate::state::AppState;
use axum::extract::{Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use serde::Deserialize;
use std::path::PathBuf;
// use utoipa::openapi::OpenApiBuilder;
use url::Url;
use utoipa::{IntoParams, OpenApi};
use utoipa_axum::router::OpenApiRouter;
// use utoipa_axum::routes;

/// Get health of the API.
#[utoipa::path(
    method(get, head),
    path = "health",
    responses(
        (status = OK, description = "Success", body = str, content_type = "text/plain")
    )
)]
async fn health() -> &'static str {
    "OK"
}

const OFFICE_ADDIN_MANIFEST_DEFAULT_BASE_URL: &str = "https://localhost:3002";

#[derive(Debug, Deserialize, IntoParams)]
struct OfficeAddinManifestQuery {
    /// Optional externally reachable deployment base URL used to rewrite the manifest.
    /// Example: https://app.example.com
    base_url: Option<String>,
}

fn normalize_manifest_base_url(base_url: &str) -> Result<String, String> {
    let mut url = Url::parse(base_url).map_err(|err| format!("invalid base_url: {err}"))?;
    url.set_query(None);
    url.set_fragment(None);

    let normalized = url.to_string();
    Ok(normalized.trim_end_matches('/').to_string())
}

fn derive_manifest_base_url(headers: &HeaderMap) -> Result<String, String> {
    let host = headers
        .get("x-forwarded-host")
        .or_else(|| headers.get(header::HOST))
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| {
            "missing host header and no base_url query parameter was supplied".to_string()
        })?;
    let scheme = headers
        .get("x-forwarded-proto")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("https");
    let prefix = headers
        .get("x-forwarded-prefix")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .trim_end_matches('/');

    normalize_manifest_base_url(&format!("{scheme}://{host}{prefix}"))
}

fn render_office_addin_manifest(template: &str, base_url: &str) -> String {
    let office_addin_base_url = format!("{}/office-addin", base_url.trim_end_matches('/'));
    let office_addin_asset_base_url = format!("{office_addin_base_url}/assets");

    template
        .replace(OFFICE_ADDIN_MANIFEST_DEFAULT_BASE_URL, base_url)
        .replace("{{BASE_URL}}", base_url)
        .replace("{{OFFICE_ADDIN_BASE_URL}}", &office_addin_base_url)
        .replace(
            "{{OFFICE_ADDIN_ASSET_BASE_URL}}",
            &office_addin_asset_base_url,
        )
}

/// Get the Office add-in manifest with runtime URL substitutions.
#[utoipa::path(
    get,
    path = "/office-addin/manifest.xml",
    params(OfficeAddinManifestQuery),
    responses(
        (status = OK, description = "Rendered Office add-in manifest", body = str, content_type = "application/xml"),
        (status = NOT_FOUND, description = "Office add-in is disabled or manifest is unavailable", body = str),
        (status = BAD_REQUEST, description = "Invalid base_url query parameter", body = str),
        (status = INTERNAL_SERVER_ERROR, description = "Failed to render manifest", body = str)
    )
)]
async fn office_addin_manifest(
    State(app_state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<OfficeAddinManifestQuery>,
) -> Response {
    if !app_state.config.integrations.ms_office.addin.enabled {
        return (StatusCode::NOT_FOUND, "Office add-in is disabled").into_response();
    }

    let base_url = match query.base_url {
        Some(base_url) => match normalize_manifest_base_url(&base_url) {
            Ok(base_url) => base_url,
            Err(message) => return (StatusCode::BAD_REQUEST, message).into_response(),
        },
        None => match derive_manifest_base_url(&headers) {
            Ok(base_url) => base_url,
            Err(message) => return (StatusCode::BAD_REQUEST, message).into_response(),
        },
    };

    let manifest_path = PathBuf::from(
        &app_state
            .config
            .integrations
            .ms_office
            .addin
            .frontend_bundle_path,
    )
    .join("manifest.xml");
    let manifest_template = match std::fs::read_to_string(&manifest_path) {
        Ok(contents) => contents,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return (
                StatusCode::NOT_FOUND,
                format!(
                    "Office add-in manifest not found at {}",
                    manifest_path.display()
                ),
            )
                .into_response();
        }
        Err(err) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to read Office add-in manifest: {err}"),
            )
                .into_response();
        }
    };

    let rendered_manifest = render_office_addin_manifest(&manifest_template, &base_url);
    (
        [(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/xml; charset=utf-8"),
        )],
        rendered_manifest,
    )
        .into_response()
}

pub fn router(app_state: AppState) -> OpenApiRouter<AppState> {
    // build our application with a route

    let router = OpenApiRouter::new()
        .route("/health", get(health).head(health))
        .route("/office-addin/manifest.xml", get(office_addin_manifest))
        .nest("/api/v1beta", crate::server::api::v1beta::router(app_state));

    #[cfg(all(feature = "profiling", target_os = "linux"))]
    let router = router
        .route("/debug/pprof/allocs", get(memory_profile_pprof))
        .route(
            "/debug/pprof/allocs/flamegraph",
            get(memory_profile_flamegraph),
        );

    router
}

#[derive(OpenApi)]
#[openapi(
    paths(health, office_addin_manifest),
    nest(
        (path = "api/v1beta", api = ApiV1ApiDoc)
    )
)]
pub struct MainRouterApiDoc;

pub const MAIN_ROUTER_DOC: &str = r#"The main API structure

- `/api/v1beta/` <- Most of the API is nested under here. All of the resources there are scoped to what is accessible by the authenticated identity.
- `/api/v1beta/me` <- Everything under this path is scoped to the subject of the authenticated identity.
This means that the identity may be authorized to view more resources, but this is the default view for them.
E.g. the chats route scoped under there will only list the chats created by the user, but the user may be authorized to also view chats shared by other users.
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_office_addin_manifest_rewrites_taskpane_and_asset_urls() {
        let template = r#"
        <OfficeApp>
          <IconUrl DefaultValue="https://localhost:3002/office-addin/assets/color-icon-192x192.png" />
          <SourceLocation DefaultValue="https://localhost:3002/office-addin/" />
        </OfficeApp>
        "#;

        let rendered = render_office_addin_manifest(template, "https://app.example.com/base");

        assert!(
            rendered.contains(
                "https://app.example.com/base/office-addin/assets/color-icon-192x192.png"
            )
        );
        assert!(rendered.contains("https://app.example.com/base/office-addin/"));
        assert!(!rendered.contains(OFFICE_ADDIN_MANIFEST_DEFAULT_BASE_URL));
    }

    #[test]
    fn normalize_manifest_base_url_drops_query_and_fragment() {
        let normalized =
            normalize_manifest_base_url("https://app.example.com/base/?foo=bar#fragment")
                .expect("base URL should parse");

        assert_eq!(normalized, "https://app.example.com/base");
    }
}
