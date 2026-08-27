use super::api::v1beta::ApiV1ApiDoc;
use crate::config::MsOfficeAddinConfig;
use crate::distribution::frontend_bundles::OfficeAddinFrontendBundle;
use crate::distribution::runtime::translation_filename;
use crate::frontend_environment::DeploymentVersion;
#[cfg(all(feature = "profiling", target_os = "linux"))]
use crate::profiling::{memory_profile_flamegraph, memory_profile_pprof};
use crate::state::AppState;
use crate::translation_po::TranslationPoCache;
use axum::Extension;
use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use eyre::{Report, eyre};
use serde::Deserialize;
use std::ffi::OsStr;
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
const OFFICE_ADDIN_MANIFEST_FILE_NAME: &str = "manifest.xml";
const OFFICE_ADDIN_EXCHANGE_SERVER_MANIFEST_FILE_NAME: &str = "manifest-exchange-server.xml";
// The launch event placeholders sit in element-only content models
// (`Host`, `DesktopFormFactor`, `bt:Urls`), where bare character data is not
// schema-valid. Wrapping them in XML comments keeps the shipped template
// valid for `office-addin-manifest validate` while leaving the substitution
// unchanged: an unconfigured deployment drops the whole line either way.
const OFFICE_ADDIN_MANIFEST_LAUNCH_EVENT_RUNTIMES_PLACEHOLDER: &str =
    "<!--{{OFFICE_ADDIN_MANIFEST_LAUNCH_EVENT_RUNTIMES}}-->";
const OFFICE_ADDIN_MANIFEST_LAUNCH_EVENT_EXTENSION_POINT_PLACEHOLDER: &str =
    "<!--{{OFFICE_ADDIN_MANIFEST_LAUNCH_EVENT_EXTENSION_POINT}}-->";
const OFFICE_ADDIN_MANIFEST_LAUNCH_EVENT_URLS_PLACEHOLDER: &str =
    "<!--{{OFFICE_ADDIN_MANIFEST_LAUNCH_EVENT_URLS}}-->";
const OFFICE_ADDIN_MANIFEST_LAUNCH_EVENT_PLACEHOLDERS: [&str; 3] = [
    OFFICE_ADDIN_MANIFEST_LAUNCH_EVENT_RUNTIMES_PLACEHOLDER,
    OFFICE_ADDIN_MANIFEST_LAUNCH_EVENT_EXTENSION_POINT_PLACEHOLDER,
    OFFICE_ADDIN_MANIFEST_LAUNCH_EVENT_URLS_PLACEHOLDER,
];
const OFFICE_ADDIN_MANIFEST_LAUNCH_EVENT_EXTENSION_POINT_TAG: &str =
    r#"<ExtensionPoint xsi:type="LaunchEvent">"#;

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

/// Whether a manifest variant has the `VersionOverridesV1_1` container that can
/// host Outlook launch events. The Exchange Server variant is limited to
/// `VersionOverridesV1_0` and structurally cannot express them.
fn manifest_supports_launch_events(manifest_name: &str) -> bool {
    manifest_name == OFFICE_ADDIN_MANIFEST_FILE_NAME
}

/// Launch event XML generated for a single manifest variant.
///
/// The blocks are inserted into the manifest verbatim, so each scalar that is
/// interpolated into them is escaped on its own.
#[derive(Default)]
struct OfficeAddinManifestLaunchEventBlocks {
    runtimes: String,
    extension_point: String,
    urls: String,
}

impl OfficeAddinManifestLaunchEventBlocks {
    /// Generates the launch event XML for `manifest_name`. Variants that cannot
    /// host launch events and deployments that declare none render empty blocks.
    fn render(
        normalized_base_url: &str,
        addin_config: &MsOfficeAddinConfig,
        manifest_name: &str,
    ) -> Self {
        if !manifest_supports_launch_events(manifest_name) || addin_config.launch_events.is_empty()
        {
            return Self::default();
        }

        // Configuration validation rejects launch events without a runtime.
        let Some(runtime) = &addin_config.launch_event_runtime else {
            return Self::default();
        };

        let launch_events = addin_config
            .launch_events
            .iter()
            .map(|launch_event| {
                format!(
                    r#"    <LaunchEvent Type="{}" FunctionName="{}"/>"#,
                    xml_escape(launch_event.event.as_str()),
                    xml_escape(&launch_event.function_name),
                )
            })
            .collect::<Vec<_>>()
            .join("\n");

        // Runtime paths are validated to be relative to the deployment base URL.
        let page_url = xml_escape(&format!("{normalized_base_url}{}", runtime.page_path));
        let script_url = xml_escape(&format!("{normalized_base_url}{}", runtime.script_path));

        Self {
            runtimes: r#"<Runtimes>
  <Runtime resid="launchEventPageUrl">
    <Override type="javascript" resid="launchEventScriptUrl"/>
  </Runtime>
</Runtimes>"#
                .to_string(),
            extension_point: format!(
                r#"{OFFICE_ADDIN_MANIFEST_LAUNCH_EVENT_EXTENSION_POINT_TAG}
  <LaunchEvents>
{launch_events}
  </LaunchEvents>
  <SourceLocation resid="launchEventPageUrl"/>
</ExtensionPoint>"#
            ),
            urls: format!(
                r#"<bt:Url id="launchEventPageUrl" DefaultValue="{page_url}"/>
<bt:Url id="launchEventScriptUrl" DefaultValue="{script_url}"/>"#
            ),
        }
    }
}

/// Indents every line of a generated XML block to the placeholder's column.
fn indent_manifest_block(block: &str, indent: &str) -> String {
    block
        .lines()
        .map(|line| {
            if line.is_empty() {
                line.to_string()
            } else {
                format!("{indent}{line}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Substitutes a generated XML block for a placeholder that owns its line.
///
/// An empty block removes the placeholder line including its indentation, so a
/// manifest that renders no launch events is byte-identical to the manifest that
/// a template without the placeholders produces. Placeholders that share their
/// line with other markup are substituted as they are.
fn replace_manifest_block(template: &str, placeholder: &str, block: &str) -> String {
    let mut rendered = String::with_capacity(template.len() + block.len());
    let mut remainder = template;

    while let Some(placeholder_start) = remainder.find(placeholder) {
        let (before, after) = remainder.split_at(placeholder_start);
        let after = &after[placeholder.len()..];
        let line_start = before.rfind('\n').map_or(0, |newline| newline + 1);
        let indent = &before[line_start..];
        let line_end = after.find('\n').unwrap_or(after.len());

        let owns_line = indent
            .chars()
            .all(|character| character == ' ' || character == '\t')
            && after[..line_end].trim().is_empty();
        if !owns_line {
            rendered.push_str(before);
            rendered.push_str(block);
            remainder = after;
            continue;
        }

        rendered.push_str(&before[..line_start]);
        if block.is_empty() {
            remainder = after[line_end..].strip_prefix('\n').unwrap_or("");
            continue;
        }

        rendered.push_str(&indent_manifest_block(block, indent));
        remainder = &after[line_end..];
    }

    rendered.push_str(remainder);
    rendered
}

fn render_office_addin_manifest(
    template: &str,
    base_url: &str,
    addin_config: &MsOfficeAddinConfig,
    manifest_name: &str,
    deployment_version: Option<&str>,
) -> String {
    let manifest_config = &addin_config.manifest;
    let normalized_base_url = base_url.trim_end_matches('/');
    let office_addin_base_url =
        format!("{normalized_base_url}{OFFICE_ADDIN_MANIFEST_FRONTEND_MOUNT_PATH}");
    let office_addin_asset_base_url =
        format!("{normalized_base_url}{OFFICE_ADDIN_MANIFEST_ASSET_MOUNT_PATH}");
    let manifest_version = office_addin_manifest_version(deployment_version);
    let launch_event_blocks = OfficeAddinManifestLaunchEventBlocks::render(
        normalized_base_url,
        addin_config,
        manifest_name,
    );

    let rendered = template
        .replace("{{BASE_URL}}", base_url)
        .replace("{{OFFICE_ADDIN_BASE_URL}}", &office_addin_base_url)
        .replace(OFFICE_ADDIN_ID_PLACEHOLDER, &addin_config.addin_id)
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
        );

    // The generated blocks are substituted after the URL rewrites above so that
    // the URLs they already carry are not rewritten a second time.
    let rendered = replace_manifest_block(
        &rendered,
        OFFICE_ADDIN_MANIFEST_LAUNCH_EVENT_RUNTIMES_PLACEHOLDER,
        &launch_event_blocks.runtimes,
    );
    let rendered = replace_manifest_block(
        &rendered,
        OFFICE_ADDIN_MANIFEST_LAUNCH_EVENT_EXTENSION_POINT_PLACEHOLDER,
        &launch_event_blocks.extension_point,
    );
    replace_manifest_block(
        &rendered,
        OFFICE_ADDIN_MANIFEST_LAUNCH_EVENT_URLS_PLACEHOLDER,
        &launch_event_blocks.urls,
    )
}

/// Renders both Office add-in manifest variants once so a deployment that
/// declares launch events fails to start when its add-in bundle predates the
/// launch event placeholders, instead of silently serving a manifest without
/// them.
pub(crate) fn ensure_office_addin_manifests_support_launch_events(
    addin_config: &MsOfficeAddinConfig,
    office_addin_bundle: &OfficeAddinFrontendBundle,
) -> Result<(), Report> {
    if addin_config.launch_events.is_empty() || !office_addin_bundle.enabled() {
        return Ok(());
    }

    for manifest_name in [
        OFFICE_ADDIN_MANIFEST_FILE_NAME,
        OFFICE_ADDIN_EXCHANGE_SERVER_MANIFEST_FILE_NAME,
    ] {
        let manifest_path = office_addin_bundle.manifest_path(manifest_name);
        let manifest_template = match std::fs::read_to_string(&manifest_path) {
            Ok(manifest_template) => manifest_template,
            // A variant that cannot host launch events is not required to be
            // present: the route already answers 404 for a bundle that omits
            // it, and launch events are no reason to start refusing to boot.
            Err(err)
                if err.kind() == std::io::ErrorKind::NotFound
                    && !manifest_supports_launch_events(manifest_name) =>
            {
                continue;
            }
            Err(err) => {
                return Err(eyre!(
                    "Failed to read the Office add-in manifest at {} while validating the configured launch events. Check `integrations.ms_office.addin.frontend_bundle_path`: {err}",
                    manifest_path.display()
                ));
            }
        };

        if manifest_supports_launch_events(manifest_name) {
            for placeholder in OFFICE_ADDIN_MANIFEST_LAUNCH_EVENT_PLACEHOLDERS {
                if !manifest_template.contains(placeholder) {
                    return Err(eyre!(
                        "The Office add-in manifest at {} does not contain the {placeholder} placeholder. Update the Office add-in bundle to a version that supports `integrations.ms_office.addin.launch_events`.",
                        manifest_path.display()
                    ));
                }
            }
        }

        let rendered_manifest = render_office_addin_manifest(
            &manifest_template,
            OFFICE_ADDIN_MANIFEST_DEFAULT_BASE_URL,
            addin_config,
            manifest_name,
            None,
        );
        let renders_launch_events =
            rendered_manifest.contains(OFFICE_ADDIN_MANIFEST_LAUNCH_EVENT_EXTENSION_POINT_TAG);
        match (
            renders_launch_events,
            manifest_supports_launch_events(manifest_name),
        ) {
            (false, true) => {
                return Err(eyre!(
                    "The Office add-in manifest at {} does not render the configured launch events.",
                    manifest_path.display()
                ));
            }
            (true, false) => {
                return Err(eyre!(
                    "The Office add-in manifest at {} renders launch events, which this variant cannot express.",
                    manifest_path.display()
                ));
            }
            _ => {}
        }
    }

    Ok(())
}

async fn office_addin_manifest_response(
    app_state: AppState,
    deployment_version: DeploymentVersion,
    headers: HeaderMap,
    query: OfficeAddinManifestQuery,
    manifest_name: &'static str,
) -> Response {
    if !app_state
        .distribution
        .frontend_bundles
        .office_addin
        .enabled()
    {
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

    let manifest_path = app_state
        .distribution
        .frontend_bundles
        .office_addin
        .manifest_path(manifest_name);
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
        &app_state.config.integrations.ms_office.addin,
        manifest_name,
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
        OFFICE_ADDIN_MANIFEST_FILE_NAME,
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
        OFFICE_ADDIN_EXCHANGE_SERVER_MANIFEST_FILE_NAME,
    )
    .await
}

async fn favicon(State(app_state): State<AppState>, path: &'static str) -> Response {
    for candidate in app_state
        .distribution
        .frontend_bundles
        .main
        .favicon_candidates(app_state.config.frontend.theme.as_deref(), path)
    {
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

async fn runtime_translation(
    State(app_state): State<AppState>,
    Path(locale_path): Path<String>,
) -> Response {
    let Some(locale) = locale_path.strip_suffix(".json") else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(filename) = translation_filename(locale) else {
        return StatusCode::NOT_FOUND.into_response();
    };

    let reloadable = app_state.reloadable.read().await;
    let Some(file) = reloadable.distribution_bundle.file(&filename) else {
        return StatusCode::NOT_FOUND.into_response();
    };

    let body =
        match TranslationPoCache::default().compile_messages_json_from_contents(&file.contents) {
            Ok(body) => body,
            Err(error) => {
                tracing::error!(locale, %error, "Failed to compile runtime translation catalog");
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }
        };

    (
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/json"),
            ),
            (header::CACHE_CONTROL, HeaderValue::from_static("no-cache")),
        ],
        body,
    )
        .into_response()
}

async fn runtime_translation_index(State(app_state): State<AppState>) -> Response {
    let reloadable = app_state.reloadable.read().await;
    (
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"))],
        Json(serde_json::json!({
            "locales": reloadable.distribution_bundle.translation_locales(),
        })),
    )
        .into_response()
}

pub fn router(app_state: AppState) -> OpenApiRouter<AppState> {
    // build our application with a route

    let router = OpenApiRouter::new()
        .route("/health", get(health).head(health))
        .route(
            "/api/licenses",
            get(crate::server::license_notices::license_notices),
        )
        .route("/favicon.ico", get(favicon_ico))
        .route("/favicon.svg", get(favicon_svg))
        .route(
            "/public/common/overrides/index.json",
            get(runtime_translation_index),
        )
        .route(
            "/public/common/overrides/{locale}",
            get(runtime_translation),
        )
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
    paths(
        health,
        office_addin_manifest,
        office_addin_exchange_server_manifest,
        crate::server::license_notices::license_notices
    ),
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
    use crate::config::{
        MsOfficeAddinLaunchEventConfig, MsOfficeAddinLaunchEventRuntimeConfig,
        MsOfficeAddinLaunchEventType, MsOfficeAddinManifestConfig,
    };
    use std::path::PathBuf;
    use tempfile::tempdir;

    fn manifest_version_prefix() -> (u16, u16, u16) {
        parse_manifest_version_prefix(env!("CARGO_PKG_VERSION"))
    }

    fn addin_config(manifest: MsOfficeAddinManifestConfig) -> MsOfficeAddinConfig {
        MsOfficeAddinConfig {
            addin_id: "custom-addin-id".to_string(),
            manifest,
            ..MsOfficeAddinConfig::default()
        }
    }

    fn addin_config_with_launch_events(function_names: &[&str]) -> MsOfficeAddinConfig {
        MsOfficeAddinConfig {
            launch_event_runtime: Some(MsOfficeAddinLaunchEventRuntimeConfig {
                page_path: "/public/component-kits/example/commands.html".to_string(),
                script_path: "/public/component-kits/example/launchevent.js".to_string(),
            }),
            launch_events: function_names
                .iter()
                .map(|function_name| MsOfficeAddinLaunchEventConfig {
                    event: MsOfficeAddinLaunchEventType::OnNewMessageCompose,
                    function_name: (*function_name).to_string(),
                })
                .collect(),
            ..addin_config(MsOfficeAddinManifestConfig::default())
        }
    }

    /// The manifest template as it ships in the Office add-in bundle.
    fn stock_manifest_template(manifest_name: &str) -> String {
        let manifest_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../office-addin/manifests")
            .join(manifest_name);

        std::fs::read_to_string(&manifest_path).expect("stock manifest template should be readable")
    }

    /// The manifest template as it looked before the launch event placeholders
    /// were introduced: the placeholder lines removed, everything else untouched.
    fn manifest_template_without_launch_event_placeholders(template: &str) -> String {
        template
            .lines()
            .filter(|line| {
                !OFFICE_ADDIN_MANIFEST_LAUNCH_EVENT_PLACEHOLDERS
                    .contains(&line.trim_start_matches(' '))
            })
            .map(|line| format!("{line}\n"))
            .collect()
    }

    #[test]
    fn render_office_addin_manifest_without_launch_events_matches_the_previous_template() {
        for manifest_name in [
            OFFICE_ADDIN_MANIFEST_FILE_NAME,
            OFFICE_ADDIN_EXCHANGE_SERVER_MANIFEST_FILE_NAME,
        ] {
            let template = stock_manifest_template(manifest_name);
            let previous_template = manifest_template_without_launch_event_placeholders(&template);
            if !manifest_supports_launch_events(manifest_name) {
                assert_eq!(
                    previous_template, template,
                    "{manifest_name} must not carry launch event placeholders"
                );
            }

            let rendered = render_office_addin_manifest(
                &template,
                "https://app.example.com/base",
                &addin_config(MsOfficeAddinManifestConfig::default()),
                manifest_name,
                Some("42"),
            );
            let previously_rendered = render_office_addin_manifest(
                &previous_template,
                "https://app.example.com/base",
                &addin_config(MsOfficeAddinManifestConfig::default()),
                manifest_name,
                Some("42"),
            );

            assert_eq!(
                rendered, previously_rendered,
                "{manifest_name} must render unchanged without launch events"
            );
            for placeholder in OFFICE_ADDIN_MANIFEST_LAUNCH_EVENT_PLACEHOLDERS {
                assert!(!rendered.contains(placeholder));
            }
        }
    }

    #[test]
    fn render_office_addin_manifest_emits_configured_launch_events() {
        let rendered = render_office_addin_manifest(
            &stock_manifest_template(OFFICE_ADDIN_MANIFEST_FILE_NAME),
            "https://app.example.com/base",
            &addin_config_with_launch_events(&["onNewMessageComposeHandler"]),
            OFFICE_ADDIN_MANIFEST_FILE_NAME,
            None,
        );

        assert!(rendered.contains(
            r#"        <Host xsi:type="MailHost">
          <Runtimes>
            <Runtime resid="launchEventPageUrl">
              <Override type="javascript" resid="launchEventScriptUrl"/>
            </Runtime>
          </Runtimes>
          <DesktopFormFactor>
"#
        ));
        assert!(rendered.contains(
            r#"            <ExtensionPoint xsi:type="LaunchEvent">
              <LaunchEvents>
                <LaunchEvent Type="OnNewMessageCompose" FunctionName="onNewMessageComposeHandler"/>
              </LaunchEvents>
              <SourceLocation resid="launchEventPageUrl"/>
            </ExtensionPoint>
          </DesktopFormFactor>
"#
        ));
        assert!(rendered.contains(
            r#"          <bt:Url id="launchEventPageUrl" DefaultValue="https://app.example.com/base/public/component-kits/example/commands.html"/>
          <bt:Url id="launchEventScriptUrl" DefaultValue="https://app.example.com/base/public/component-kits/example/launchevent.js"/>
        </bt:Urls>
"#
        ));
    }

    #[test]
    fn render_office_addin_manifest_escapes_launch_event_values_inside_the_block() {
        let mut launch_event_config = addin_config_with_launch_events(&["onNewMessageCompose"]);
        launch_event_config
            .launch_event_runtime
            .as_mut()
            .expect("launch event runtime should be configured")
            .page_path = "/public/component-kits/example/commands.html?tenant=a&b".to_string();

        let rendered = render_office_addin_manifest(
            &stock_manifest_template(OFFICE_ADDIN_MANIFEST_FILE_NAME),
            "https://app.example.com/base",
            &launch_event_config,
            OFFICE_ADDIN_MANIFEST_FILE_NAME,
            None,
        );

        assert!(rendered.contains(
            r#"<bt:Url id="launchEventPageUrl" DefaultValue="https://app.example.com/base/public/component-kits/example/commands.html?tenant=a&amp;b"/>"#
        ));
        // The generated markup itself stays markup.
        assert!(rendered.contains(r#"<ExtensionPoint xsi:type="LaunchEvent">"#));
        assert!(!rendered.contains("&lt;ExtensionPoint"));
    }

    #[test]
    fn render_office_addin_exchange_server_manifest_never_emits_launch_events() {
        let template = stock_manifest_template(OFFICE_ADDIN_EXCHANGE_SERVER_MANIFEST_FILE_NAME);
        let rendered = render_office_addin_manifest(
            &template,
            "https://app.example.com/base",
            &addin_config_with_launch_events(&["onNewMessageComposeHandler"]),
            OFFICE_ADDIN_EXCHANGE_SERVER_MANIFEST_FILE_NAME,
            None,
        );

        assert!(!rendered.contains("LaunchEvent"));
        assert!(!rendered.contains("launchEventPageUrl"));
        assert!(!rendered.contains("<Runtimes>"));
        assert_eq!(
            rendered,
            render_office_addin_manifest(
                &template,
                "https://app.example.com/base",
                &addin_config(MsOfficeAddinManifestConfig::default()),
                OFFICE_ADDIN_EXCHANGE_SERVER_MANIFEST_FILE_NAME,
                None,
            )
        );
    }

    /// The Exchange Server variant is excluded by manifest name, not merely by
    /// the absence of the placeholders from its template: a template that does
    /// carry them still renders no launch events under that name.
    #[test]
    fn render_office_addin_manifest_keys_launch_events_on_the_manifest_name() {
        let template = stock_manifest_template(OFFICE_ADDIN_MANIFEST_FILE_NAME);
        for placeholder in OFFICE_ADDIN_MANIFEST_LAUNCH_EVENT_PLACEHOLDERS {
            assert!(
                template.contains(placeholder),
                "the template under test has to carry {placeholder}"
            );
        }

        let rendered = render_office_addin_manifest(
            &template,
            "https://app.example.com/base",
            &addin_config_with_launch_events(&["onNewMessageComposeHandler"]),
            OFFICE_ADDIN_EXCHANGE_SERVER_MANIFEST_FILE_NAME,
            None,
        );

        assert!(!rendered.contains("LaunchEvent"));
        assert!(!rendered.contains("launchEventPageUrl"));
        assert!(!rendered.contains("<Runtimes>"));
        assert_eq!(
            rendered,
            render_office_addin_manifest(
                &template,
                "https://app.example.com/base",
                &addin_config(MsOfficeAddinManifestConfig::default()),
                OFFICE_ADDIN_EXCHANGE_SERVER_MANIFEST_FILE_NAME,
                None,
            )
        );
    }

    #[test]
    fn ensure_office_addin_manifests_support_launch_events_rejects_an_outdated_bundle() {
        let bundle_dir = tempdir().expect("temp dir should be created");
        for manifest_name in [
            OFFICE_ADDIN_MANIFEST_FILE_NAME,
            OFFICE_ADDIN_EXCHANGE_SERVER_MANIFEST_FILE_NAME,
        ] {
            let template = manifest_template_without_launch_event_placeholders(
                &stock_manifest_template(manifest_name),
            );
            std::fs::write(bundle_dir.path().join(manifest_name), template)
                .expect("manifest should be written");
        }

        let mut config = crate::config::AppConfig::default();
        config.integrations.ms_office.addin =
            addin_config_with_launch_events(&["onNewMessageComposeHandler"]);
        config.integrations.ms_office.addin.enabled = true;
        config.integrations.ms_office.addin.frontend_bundle_path =
            bundle_dir.path().to_string_lossy().into_owned();
        let bundles = crate::distribution::frontend_bundles::FrontendBundles::from_config(&config);

        let error = ensure_office_addin_manifests_support_launch_events(
            &config.integrations.ms_office.addin,
            &bundles.office_addin,
        )
        .expect_err("an outdated add-in bundle should be rejected");
        assert!(
            error
                .to_string()
                .contains(OFFICE_ADDIN_MANIFEST_LAUNCH_EVENT_RUNTIMES_PLACEHOLDER)
        );

        std::fs::write(
            bundle_dir.path().join(OFFICE_ADDIN_MANIFEST_FILE_NAME),
            stock_manifest_template(OFFICE_ADDIN_MANIFEST_FILE_NAME),
        )
        .expect("manifest should be written");

        ensure_office_addin_manifests_support_launch_events(
            &config.integrations.ms_office.addin,
            &bundles.office_addin,
        )
        .expect("the shipped add-in bundle should support launch events");
    }

    #[test]
    fn ensure_office_addin_manifests_support_launch_events_tolerates_a_missing_exchange_variant() {
        let bundle_dir = tempdir().expect("temp dir should be created");
        std::fs::write(
            bundle_dir.path().join(OFFICE_ADDIN_MANIFEST_FILE_NAME),
            stock_manifest_template(OFFICE_ADDIN_MANIFEST_FILE_NAME),
        )
        .expect("manifest should be written");

        let mut config = crate::config::AppConfig::default();
        config.integrations.ms_office.addin =
            addin_config_with_launch_events(&["onNewMessageComposeHandler"]);
        config.integrations.ms_office.addin.enabled = true;
        config.integrations.ms_office.addin.frontend_bundle_path =
            bundle_dir.path().to_string_lossy().into_owned();
        let bundles = crate::distribution::frontend_bundles::FrontendBundles::from_config(&config);

        // The Exchange Server variant cannot host launch events, so a bundle
        // that omits it must still start: the route already answers 404 for it.
        ensure_office_addin_manifests_support_launch_events(
            &config.integrations.ms_office.addin,
            &bundles.office_addin,
        )
        .expect("a bundle without the Exchange Server variant should still start");
    }

    #[test]
    fn ensure_office_addin_manifests_support_launch_events_skips_deployments_without_events() {
        let mut config = crate::config::AppConfig::default();
        config.integrations.ms_office.addin.enabled = true;
        config.integrations.ms_office.addin.frontend_bundle_path = "./does-not-exist".to_string();
        let bundles = crate::distribution::frontend_bundles::FrontendBundles::from_config(&config);

        ensure_office_addin_manifests_support_launch_events(
            &config.integrations.ms_office.addin,
            &bundles.office_addin,
        )
        .expect("deployments without launch events should not need the manifest templates");
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
            &addin_config(MsOfficeAddinManifestConfig::default()),
            OFFICE_ADDIN_MANIFEST_FILE_NAME,
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
            &addin_config(manifest_config),
            OFFICE_ADDIN_MANIFEST_FILE_NAME,
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
            &addin_config(manifest_config),
            OFFICE_ADDIN_MANIFEST_FILE_NAME,
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
        let mut config = crate::config::AppConfig::default();
        config.frontend.web_frontend_bundle_path = bundle_root.to_string_lossy().into_owned();
        let bundles = crate::distribution::frontend_bundles::FrontendBundles::from_config(&config);

        let paths = bundles
            .main
            .favicon_candidates(Some("acme-test"), "favicon.ico");

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
        let mut config = crate::config::AppConfig::default();
        config.frontend.web_frontend_bundle_path = temp_dir.path().to_string_lossy().into_owned();
        let bundles = crate::distribution::frontend_bundles::FrontendBundles::from_config(&config);

        let candidates = bundles
            .main
            .favicon_candidates(Some("acme-test"), "favicon.ico");

        let resolved = candidates
            .into_iter()
            .find_map(|candidate| std::fs::read(&candidate).ok());

        assert_eq!(resolved, Some(b"runtime-favicon".to_vec()));
    }

    #[test]
    fn favicon_candidate_paths_allow_svg_theme_override_for_ico_request() {
        let bundle_root = PathBuf::from("/app/public");
        let mut config = crate::config::AppConfig::default();
        config.frontend.web_frontend_bundle_path = bundle_root.to_string_lossy().into_owned();
        let bundles = crate::distribution::frontend_bundles::FrontendBundles::from_config(&config);

        let paths = bundles
            .main
            .favicon_candidates(Some("acme-test"), "favicon.ico");

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
