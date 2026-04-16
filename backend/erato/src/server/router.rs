use super::api::v1beta::ApiV1ApiDoc;
use crate::frontend_environment::DeploymentVersion;
#[cfg(all(feature = "profiling", target_os = "linux"))]
use crate::profiling::{memory_profile_flamegraph, memory_profile_pprof};
use crate::state::AppState;
use axum::Extension;
use axum::extract::{Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use serde::Deserialize;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
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
const OFFICE_ADDIN_MANIFEST_VERSION_PLACEHOLDER: &str = "{{OFFICE_ADDIN_MANIFEST_VERSION}}";

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

fn parse_manifest_version_prefix(version: &str) -> (u16, u16, u16) {
    let mut parts = version.split('.');
    let parse_part = |part: Option<&str>| -> u16 {
        part.unwrap_or("0")
            .chars()
            .take_while(|char| char.is_ascii_digit())
            .collect::<String>()
            .parse::<u16>()
            .unwrap_or(0)
    };

    (
        parse_part(parts.next()),
        parse_part(parts.next()),
        parse_part(parts.next()),
    )
}

fn deployment_version_component(deployment_version: Option<&str>) -> u16 {
    let Some(deployment_version) = deployment_version.filter(|value| !value.is_empty()) else {
        return 0;
    };

    if let Ok(parsed) = deployment_version.parse::<u16>() {
        return parsed;
    }

    deployment_version.bytes().fold(0_u16, |accumulator, byte| {
        accumulator.wrapping_mul(31).wrapping_add(u16::from(byte))
    })
}

fn office_addin_manifest_version(deployment_version: Option<&str>) -> String {
    let (major, minor, patch) = parse_manifest_version_prefix(env!("CARGO_PKG_VERSION"));
    let deployment = deployment_version_component(deployment_version);
    format!("{major}.{minor}.{patch}.{deployment}")
}

fn render_office_addin_manifest(
    template: &str,
    base_url: &str,
    deployment_version: Option<&str>,
) -> String {
    let office_addin_base_url = format!(
        "{}/public/platform-office-addin",
        base_url.trim_end_matches('/')
    );
    let office_addin_asset_base_url = format!("{office_addin_base_url}/assets");
    let manifest_version = office_addin_manifest_version(deployment_version);

    template
        .replace(OFFICE_ADDIN_MANIFEST_DEFAULT_BASE_URL, base_url)
        .replace("{{BASE_URL}}", base_url)
        .replace("{{OFFICE_ADDIN_BASE_URL}}", &office_addin_base_url)
        .replace(OFFICE_ADDIN_MANIFEST_VERSION_PLACEHOLDER, &manifest_version)
        .replace(
            "{{OFFICE_ADDIN_ASSET_BASE_URL}}",
            &office_addin_asset_base_url,
        )
}

/// Get the Office add-in manifest with runtime URL substitutions.
#[utoipa::path(
    get,
    path = "office-addin/manifest.xml",
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
    Extension(deployment_version): Extension<DeploymentVersion>,
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

    let rendered_manifest = render_office_addin_manifest(
        &manifest_template,
        &base_url,
        deployment_version.0.as_deref(),
    );
    (
        [(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/xml; charset=utf-8"),
        )],
        rendered_manifest,
    )
        .into_response()
}

fn favicon_candidate_paths(bundle_root: &Path, theme: Option<&str>, path: &str) -> Vec<PathBuf> {
    let theme_favicon_names = match path {
        "favicon.ico" => ["favicon.ico", "favicon.svg"],
        "favicon.svg" => ["favicon.svg", "favicon.ico"],
        _ => [path, path],
    };
    let mut candidate_paths = Vec::new();

    if let Some(theme) = theme {
        for favicon_name in theme_favicon_names {
            candidate_paths.push(
                bundle_root
                    .join("custom-theme")
                    .join(theme)
                    .join(favicon_name),
            );
            candidate_paths.push(
                bundle_root
                    .join("public")
                    .join("common")
                    .join("custom-theme")
                    .join(theme)
                    .join(favicon_name),
            );
        }
    }

    candidate_paths.push(bundle_root.join(path));
    candidate_paths.push(bundle_root.join("public").join(path));

    candidate_paths
}

async fn favicon(State(app_state): State<AppState>, path: &'static str) -> Response {
    let bundle_root = PathBuf::from(&app_state.config.frontend.web_frontend_bundle_path);
    for candidate in favicon_candidate_paths(
        &bundle_root,
        app_state.config.frontend.theme.as_deref(),
        path,
    ) {
        match std::fs::read(&candidate) {
            Ok(contents) => {
                let content_type = match candidate.extension().and_then(OsStr::to_str) {
                    Some("svg") => "image/svg+xml",
                    _ => "image/x-icon",
                };
                return (
                    [(header::CONTENT_TYPE, HeaderValue::from_static(content_type))],
                    contents,
                )
                    .into_response();
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
            Err(err) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to read favicon: {err}"),
                )
                    .into_response();
            }
        }
    }

    (StatusCode::NOT_FOUND, "Favicon not found").into_response()
}

async fn favicon_ico(State(app_state): State<AppState>) -> Response {
    favicon(State(app_state), "favicon.ico").await
}

async fn favicon_svg(State(app_state): State<AppState>) -> Response {
    favicon(State(app_state), "favicon.svg").await
}

pub fn router(app_state: AppState) -> OpenApiRouter<AppState> {
    // build our application with a route

    let router = OpenApiRouter::new()
        .route("/health", get(health).head(health))
        .route("/favicon.ico", get(favicon_ico))
        .route("/favicon.svg", get(favicon_svg))
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
    use tempfile::tempdir;

    #[test]
    fn render_office_addin_manifest_rewrites_taskpane_and_asset_urls() {
        let template = r#"
        <OfficeApp>
          <Version>{{OFFICE_ADDIN_MANIFEST_VERSION}}</Version>
          <IconUrl DefaultValue="https://localhost:3002/public/platform-office-addin/assets/color-icon-192x192.png" />
          <SourceLocation DefaultValue="https://localhost:3002/public/platform-office-addin/" />
        </OfficeApp>
        "#;

        let rendered =
            render_office_addin_manifest(template, "https://app.example.com/base", Some("42"));

        assert!(
            rendered.contains(
                "https://app.example.com/base/public/platform-office-addin/assets/color-icon-192x192.png"
            )
        );
        assert!(rendered.contains("https://app.example.com/base/public/platform-office-addin/"));
        assert!(rendered.contains("<Version>0.5.2.42</Version>"));
        assert!(!rendered.contains(OFFICE_ADDIN_MANIFEST_DEFAULT_BASE_URL));
    }

    #[test]
    fn office_addin_manifest_version_hashes_non_numeric_deployment_version() {
        assert_eq!(
            office_addin_manifest_version(Some("dev-build")),
            "0.5.2.15030"
        );
    }

    #[test]
    fn office_addin_manifest_version_defaults_deployment_component_to_zero() {
        assert_eq!(office_addin_manifest_version(None), "0.5.2.0");
    }

    #[test]
    fn normalize_manifest_base_url_drops_query_and_fragment() {
        let normalized =
            normalize_manifest_base_url("https://app.example.com/base/?foo=bar#fragment")
                .expect("base URL should parse");

        assert_eq!(normalized, "https://app.example.com/base");
    }

    #[test]
    fn favicon_candidate_paths_prefer_runtime_theme_mounts() {
        let bundle_root = PathBuf::from("/app/public");

        let paths = favicon_candidate_paths(&bundle_root, Some("acme-test"), "favicon.ico");

        assert_eq!(
            paths,
            vec![
                PathBuf::from("/app/public/custom-theme/acme-test/favicon.ico"),
                PathBuf::from("/app/public/public/common/custom-theme/acme-test/favicon.ico"),
                PathBuf::from("/app/public/custom-theme/acme-test/favicon.svg"),
                PathBuf::from("/app/public/public/common/custom-theme/acme-test/favicon.svg"),
                PathBuf::from("/app/public/favicon.ico"),
                PathBuf::from("/app/public/public/favicon.ico"),
            ]
        );
    }

    #[test]
    fn favicon_candidate_paths_support_runtime_theme_files() {
        let temp_dir = tempdir().expect("temp dir should be created");
        let runtime_theme_path = temp_dir
            .path()
            .join("custom-theme")
            .join("acme-test")
            .join("favicon.ico");
        std::fs::create_dir_all(runtime_theme_path.parent().expect("parent should exist"))
            .expect("theme directory should be created");
        std::fs::write(&runtime_theme_path, b"runtime-favicon").expect("favicon should be written");

        let candidates = favicon_candidate_paths(temp_dir.path(), Some("acme-test"), "favicon.ico");

        let resolved = candidates
            .into_iter()
            .find_map(|candidate| std::fs::read(&candidate).ok());

        assert_eq!(resolved, Some(b"runtime-favicon".to_vec()));
    }

    #[test]
    fn favicon_candidate_paths_allow_svg_theme_override_for_ico_request() {
        let bundle_root = PathBuf::from("/app/public");

        let paths = favicon_candidate_paths(&bundle_root, Some("acme-test"), "favicon.ico");

        assert_eq!(
            paths[0..4],
            [
                PathBuf::from("/app/public/custom-theme/acme-test/favicon.ico"),
                PathBuf::from("/app/public/public/common/custom-theme/acme-test/favicon.ico"),
                PathBuf::from("/app/public/custom-theme/acme-test/favicon.svg"),
                PathBuf::from("/app/public/public/common/custom-theme/acme-test/favicon.svg"),
            ]
        );
    }
}
