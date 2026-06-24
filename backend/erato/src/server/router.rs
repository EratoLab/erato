use super::api::v1beta::ApiV1ApiDoc;
use crate::config::MsOfficeAddinManifestConfig;
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
const OFFICE_ADDIN_MANIFEST_DEFAULT_FRONTEND_BASE_URL: &str =
    "https://localhost:3002/public/platform-office-addin";
const OFFICE_ADDIN_MANIFEST_DEFAULT_ASSET_BASE_URL: &str =
    "https://localhost:3002/public/platform-office-addin/assets";
const OFFICE_ADDIN_MANIFEST_FRONTEND_MOUNT_PATH: &str = "/office-addin";
const OFFICE_ADDIN_MANIFEST_ASSET_MOUNT_PATH: &str = "/public/platform-office-addin/assets";
const OFFICE_ADDIN_MANIFEST_BUNDLE_MOUNT_PATH: &str = "/public/platform-office-addin";
const OFFICE_ADDIN_MANIFEST_VERSION_PLACEHOLDER: &str = "{{OFFICE_ADDIN_MANIFEST_VERSION}}";
const OFFICE_ADDIN_ID_PLACEHOLDER: &str = "{{OFFICE_ADDIN_ID}}";

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

fn xml_escape(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&apos;"),
            _ => escaped.push(character),
        }
    }
    escaped
}

fn office_addin_manifest_asset_url(base_url: &str, path_or_url: &str) -> String {
    let trimmed = path_or_url.trim();
    if Url::parse(trimmed)
        .map(|url| matches!(url.scheme(), "http" | "https"))
        .unwrap_or(false)
    {
        return trimmed.to_string();
    }

    let normalized_base_url = base_url.trim_end_matches('/');
    if trimmed.starts_with('/') {
        return format!("{normalized_base_url}{trimmed}");
    }

    format!(
        "{normalized_base_url}{OFFICE_ADDIN_MANIFEST_BUNDLE_MOUNT_PATH}/{}",
        trimmed.trim_start_matches('/')
    )
}

fn render_office_addin_manifest(
    template: &str,
    base_url: &str,
    addin_id: &str,
    manifest_config: &MsOfficeAddinManifestConfig,
    deployment_version: Option<&str>,
) -> String {
    let normalized_base_url = base_url.trim_end_matches('/');
    let office_addin_base_url =
        format!("{normalized_base_url}{OFFICE_ADDIN_MANIFEST_FRONTEND_MOUNT_PATH}");
    let office_addin_asset_base_url =
        format!("{normalized_base_url}{OFFICE_ADDIN_MANIFEST_ASSET_MOUNT_PATH}");
    let manifest_version = office_addin_manifest_version(deployment_version);

    template
        .replace("{{BASE_URL}}", base_url)
        .replace("{{OFFICE_ADDIN_BASE_URL}}", &office_addin_base_url)
        .replace(OFFICE_ADDIN_ID_PLACEHOLDER, addin_id)
        .replace(OFFICE_ADDIN_MANIFEST_VERSION_PLACEHOLDER, &manifest_version)
        .replace(
            "{{OFFICE_ADDIN_ASSET_BASE_URL}}",
            &office_addin_asset_base_url,
        )
        .replace(
            OFFICE_ADDIN_MANIFEST_DEFAULT_ASSET_BASE_URL,
            &office_addin_asset_base_url,
        )
        .replace(
            OFFICE_ADDIN_MANIFEST_DEFAULT_FRONTEND_BASE_URL,
            &office_addin_base_url,
        )
        .replace(OFFICE_ADDIN_MANIFEST_DEFAULT_BASE_URL, base_url)
        .replace(
            "{{OFFICE_ADDIN_MANIFEST_PROVIDER_NAME}}",
            &xml_escape(&manifest_config.provider_name),
        )
        .replace(
            "{{OFFICE_ADDIN_MANIFEST_DISPLAY_NAME}}",
            &xml_escape(&manifest_config.display_name),
        )
        .replace(
            "{{OFFICE_ADDIN_MANIFEST_DESCRIPTION}}",
            &xml_escape(&manifest_config.description),
        )
        .replace(
            "{{OFFICE_ADDIN_MANIFEST_SUPPORT_URL}}",
            &xml_escape(&manifest_config.support_url),
        )
        .replace(
            "{{OFFICE_ADDIN_MANIFEST_GROUP_LABEL}}",
            &xml_escape(&manifest_config.group_label),
        )
        .replace(
            "{{OFFICE_ADDIN_MANIFEST_BUTTON_LABEL}}",
            &xml_escape(&manifest_config.button_label),
        )
        .replace(
            "{{OFFICE_ADDIN_MANIFEST_BUTTON_DESCRIPTION}}",
            &xml_escape(&manifest_config.button_description),
        )
        .replace(
            "{{OFFICE_ADDIN_MANIFEST_ICON_URL}}",
            &xml_escape(&office_addin_manifest_asset_url(
                normalized_base_url,
                &manifest_config.icon_path,
            )),
        )
        .replace(
            "{{OFFICE_ADDIN_MANIFEST_HIGH_RESOLUTION_ICON_URL}}",
            &xml_escape(&office_addin_manifest_asset_url(
                normalized_base_url,
                &manifest_config.high_resolution_icon_path,
            )),
        )
        .replace(
            "{{OFFICE_ADDIN_MANIFEST_ICON_16_URL}}",
            &xml_escape(&office_addin_manifest_asset_url(
                normalized_base_url,
                &manifest_config.icon_16_path,
            )),
        )
        .replace(
            "{{OFFICE_ADDIN_MANIFEST_ICON_32_URL}}",
            &xml_escape(&office_addin_manifest_asset_url(
                normalized_base_url,
                &manifest_config.icon_32_path,
            )),
        )
        .replace(
            "{{OFFICE_ADDIN_MANIFEST_ICON_80_URL}}",
            &xml_escape(&office_addin_manifest_asset_url(
                normalized_base_url,
                &manifest_config.icon_80_path,
            )),
        )
}

fn office_addin_manifest_path(frontend_bundle_path: &str, manifest_name: &str) -> PathBuf {
    PathBuf::from(frontend_bundle_path).join(manifest_name)
}

async fn office_addin_manifest_response(
    app_state: AppState,
    deployment_version: DeploymentVersion,
    headers: HeaderMap,
    query: OfficeAddinManifestQuery,
    manifest_name: &'static str,
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

    let manifest_path = office_addin_manifest_path(
        &app_state
            .config
            .integrations
            .ms_office
            .addin
            .frontend_bundle_path,
        manifest_name,
    );
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
        &app_state.config.integrations.ms_office.addin.addin_id,
        &app_state.config.integrations.ms_office.addin.manifest,
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
    office_addin_manifest_response(
        app_state,
        deployment_version,
        headers,
        query,
        "manifest.xml",
    )
    .await
}

/// Get the Office add-in manifest for Exchange Server with runtime URL substitutions.
#[utoipa::path(
    get,
    path = "office-addin/manifest-exchange-server.xml",
    params(OfficeAddinManifestQuery),
    responses(
        (status = OK, description = "Rendered Exchange Server Office add-in manifest", body = str, content_type = "application/xml"),
        (status = NOT_FOUND, description = "Office add-in is disabled or manifest is unavailable", body = str),
        (status = BAD_REQUEST, description = "Invalid base_url query parameter", body = str),
        (status = INTERNAL_SERVER_ERROR, description = "Failed to render manifest", body = str)
    )
)]
async fn office_addin_exchange_server_manifest(
    State(app_state): State<AppState>,
    Extension(deployment_version): Extension<DeploymentVersion>,
    headers: HeaderMap,
    Query(query): Query<OfficeAddinManifestQuery>,
) -> Response {
    office_addin_manifest_response(
        app_state,
        deployment_version,
        headers,
        query,
        "manifest-exchange-server.xml",
    )
    .await
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
        .route(
            "/office-addin/manifest-exchange-server.xml",
            get(office_addin_exchange_server_manifest),
        )
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
    paths(health, office_addin_manifest, office_addin_exchange_server_manifest),
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

    fn manifest_version_prefix() -> (u16, u16, u16) {
        parse_manifest_version_prefix(env!("CARGO_PKG_VERSION"))
    }

    #[test]
    fn render_office_addin_manifest_rewrites_taskpane_and_asset_urls() {
        let template = r#"
        <OfficeApp>
          <Id>{{OFFICE_ADDIN_ID}}</Id>
          <Version>{{OFFICE_ADDIN_MANIFEST_VERSION}}</Version>
          <IconUrl DefaultValue="https://localhost:3002/public/platform-office-addin/assets/color-icon-192x192.png" />
          <SourceLocation DefaultValue="https://localhost:3002/public/platform-office-addin/" />
          <bt:Url id="taskPaneUrl" DefaultValue="https://localhost:3002/public/platform-office-addin/" />
        </OfficeApp>
        "#;

        let rendered = render_office_addin_manifest(
            template,
            "https://app.example.com/base",
            "custom-addin-id",
            &MsOfficeAddinManifestConfig::default(),
            Some("42"),
        );
        let (major, minor, patch) = manifest_version_prefix();
        let expected_version = format!("{major}.{minor}.{patch}.42");

        assert!(rendered.contains("<Id>custom-addin-id</Id>"));
        assert!(!rendered.contains(OFFICE_ADDIN_ID_PLACEHOLDER));

        assert!(
            rendered.contains(
                "https://app.example.com/base/public/platform-office-addin/assets/color-icon-192x192.png"
            )
        );
        assert!(rendered.contains(
            r#"<SourceLocation DefaultValue="https://app.example.com/base/office-addin/" />"#
        ));
        assert!(rendered.contains(
            r#"<bt:Url id="taskPaneUrl" DefaultValue="https://app.example.com/base/office-addin/" />"#
        ));
        assert!(!rendered.contains(
            r#"<bt:Url id="taskPaneUrl" DefaultValue="https://app.example.com/base/public/platform-office-addin/" />"#
        ));
        assert!(rendered.contains(&format!("<Version>{expected_version}</Version>")));
        assert!(!rendered.contains(OFFICE_ADDIN_MANIFEST_DEFAULT_BASE_URL));
    }

    #[test]
    fn render_office_addin_manifest_applies_branding_and_escapes_xml() {
        let template = r#"
        <OfficeApp>
          <ProviderName>{{OFFICE_ADDIN_MANIFEST_PROVIDER_NAME}}</ProviderName>
          <DisplayName DefaultValue="{{OFFICE_ADDIN_MANIFEST_DISPLAY_NAME}}" />
          <Description DefaultValue="{{OFFICE_ADDIN_MANIFEST_DESCRIPTION}}" />
          <SupportUrl DefaultValue="{{OFFICE_ADDIN_MANIFEST_SUPPORT_URL}}" />
          <bt:String id="groupLabel" DefaultValue="{{OFFICE_ADDIN_MANIFEST_GROUP_LABEL}}" />
          <bt:String id="buttonLabel" DefaultValue="{{OFFICE_ADDIN_MANIFEST_BUTTON_LABEL}}" />
          <bt:String id="buttonDesc" DefaultValue="{{OFFICE_ADDIN_MANIFEST_BUTTON_DESCRIPTION}}" />
        </OfficeApp>
        "#;
        let manifest_config = MsOfficeAddinManifestConfig {
            provider_name: "Contoso & Co".to_string(),
            display_name: "Contoso \"Office\"".to_string(),
            description: "Assistant <for> Outlook".to_string(),
            support_url: "https://example.com/support?team=office&brand=contoso".to_string(),
            group_label: "Contoso".to_string(),
            button_label: "Open Contoso".to_string(),
            button_description: "Open Contoso's assistant".to_string(),
            ..MsOfficeAddinManifestConfig::default()
        };

        let rendered = render_office_addin_manifest(
            template,
            "https://app.example.com/base",
            "custom-addin-id",
            &manifest_config,
            None,
        );

        assert!(rendered.contains("<ProviderName>Contoso &amp; Co</ProviderName>"));
        assert!(rendered.contains(r#"DefaultValue="Contoso &quot;Office&quot;""#));
        assert!(rendered.contains(r#"DefaultValue="Assistant &lt;for&gt; Outlook""#));
        assert!(rendered.contains(
            r#"DefaultValue="https://example.com/support?team=office&amp;brand=contoso""#
        ));
        assert!(rendered.contains(r#"DefaultValue="Open Contoso""#));
        assert!(rendered.contains(r#"DefaultValue="Open Contoso&apos;s assistant""#));
    }

    #[test]
    fn render_office_addin_manifest_resolves_brand_icon_paths() {
        let template = r#"
        <OfficeApp>
          <IconUrl DefaultValue="{{OFFICE_ADDIN_MANIFEST_ICON_URL}}" />
          <HighResolutionIconUrl DefaultValue="{{OFFICE_ADDIN_MANIFEST_HIGH_RESOLUTION_ICON_URL}}" />
          <bt:Image id="icon16" DefaultValue="{{OFFICE_ADDIN_MANIFEST_ICON_16_URL}}" />
          <bt:Image id="icon32" DefaultValue="{{OFFICE_ADDIN_MANIFEST_ICON_32_URL}}" />
          <bt:Image id="icon80" DefaultValue="{{OFFICE_ADDIN_MANIFEST_ICON_80_URL}}" />
        </OfficeApp>
        "#;
        let manifest_config = MsOfficeAddinManifestConfig {
            icon_path: "assets/contoso-color.png".to_string(),
            high_resolution_icon_path: "/public/common/custom-theme/contoso/contoso-hires.png"
                .to_string(),
            icon_16_path:
                "https://localhost:3002/public/platform-office-addin/assets/absolute-16.png"
                    .to_string(),
            icon_32_path: "/public/platform-office-addin/assets/contoso-32.png".to_string(),
            icon_80_path: "assets/contoso-80.png".to_string(),
            ..MsOfficeAddinManifestConfig::default()
        };

        let rendered = render_office_addin_manifest(
            template,
            "https://app.example.com/base",
            "custom-addin-id",
            &manifest_config,
            None,
        );

        assert!(rendered.contains(
            r#"DefaultValue="https://app.example.com/base/public/platform-office-addin/assets/contoso-color.png""#
        ));
        assert!(rendered.contains(
            r#"DefaultValue="https://app.example.com/base/public/common/custom-theme/contoso/contoso-hires.png""#
        ));
        assert!(rendered.contains(
            r#"DefaultValue="https://localhost:3002/public/platform-office-addin/assets/absolute-16.png""#
        ));
        assert!(rendered.contains(
            r#"DefaultValue="https://app.example.com/base/public/platform-office-addin/assets/contoso-32.png""#
        ));
        assert!(rendered.contains(
            r#"DefaultValue="https://app.example.com/base/public/platform-office-addin/assets/contoso-80.png""#
        ));
    }

    #[test]
    fn office_addin_manifest_version_hashes_non_numeric_deployment_version() {
        let (major, minor, patch) = manifest_version_prefix();
        let expected = format!("{major}.{minor}.{patch}.15030");
        assert_eq!(office_addin_manifest_version(Some("dev-build")), expected);
    }

    #[test]
    fn office_addin_manifest_version_defaults_deployment_component_to_zero() {
        let (major, minor, patch) = manifest_version_prefix();
        assert_eq!(
            office_addin_manifest_version(None),
            format!("{major}.{minor}.{patch}.0")
        );
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
