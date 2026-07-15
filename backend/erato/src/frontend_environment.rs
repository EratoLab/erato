//! Inlined version of the frontend-environment crate (to simplify dependency version alignment)
pub use self::axum::serve_files_with_script;
use crate::config::{AppConfig, TranslationPoCompilationMode};
use crate::translation_po::TranslationPoCache;
use ::axum::http::HeaderValue;
use lol_html::html_content::ContentType;
use lol_html::{HtmlRewriter, Settings, element};
use ordered_multimap::ListOrderedMultimap;
use serde::Deserialize;
use serde_json::Value;
use std::fmt::Write;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

// Default maximum body limit in bytes (20MB) - must match DEFAULT_MAX_BODY_LIMIT_BYTES in server/api/v1beta/mod.rs
const DEFAULT_MAX_BODY_LIMIT_BYTES: u64 = 20 * 1024 * 1024;

// The following keys are aligned with the `env.ts` of the frontend.
// If you change the keys, you must also update them in the frontend.
const FRONTEND_ENV_KEY_API_ROOT_URL: &str = "API_ROOT_URL";
const FRONTEND_ENV_KEY_FRONTEND_PLATFORM: &str = "FRONTEND_PLATFORM";
const FRONTEND_ENV_KEY_FRONTEND_PUBLIC_BASE_PATH: &str = "FRONTEND_PUBLIC_BASE_PATH";
const FRONTEND_ENV_KEY_COMMON_PUBLIC_BASE_PATH: &str = "COMMON_PUBLIC_BASE_PATH";
const FRONTEND_ENV_KEY_THEME_CUSTOMER_NAME: &str = "THEME_CUSTOMER_NAME";
const FRONTEND_ENV_KEY_DISABLE_UPLOAD: &str = "DISABLE_UPLOAD";
const FRONTEND_ENV_KEY_DISABLE_CHAT_INPUT_AUTOFOCUS: &str = "DISABLE_CHAT_INPUT_AUTOFOCUS";
const FRONTEND_ENV_KEY_CHAT_INPUT_EMPTY_STATE_LAYOUT: &str = "CHAT_INPUT_EMPTY_STATE_LAYOUT";
const FRONTEND_ENV_KEY_DISABLE_LOGOUT: &str = "DISABLE_LOGOUT";
const FRONTEND_ENV_KEY_ASSISTANTS_ENABLED: &str = "ASSISTANTS_ENABLED";
const FRONTEND_ENV_KEY_ASSISTANTS_SHOW_RECENT_ITEMS: &str = "ASSISTANTS_SHOW_RECENT_ITEMS";
const FRONTEND_ENV_KEY_ASSISTANTS_CONTEXT_WARNING_THRESHOLD: &str =
    "ASSISTANTS_CONTEXT_WARNING_THRESHOLD";
const FRONTEND_ENV_KEY_ASSISTANTS_CONTEXT_FILE_CONTRIBUTOR_THRESHOLD: &str =
    "ASSISTANTS_CONTEXT_FILE_CONTRIBUTOR_THRESHOLD";
const FRONTEND_ENV_KEY_ASSISTANTS_MAX_SYSTEM_PROMPT_LENGTH: &str =
    "ASSISTANTS_MAX_SYSTEM_PROMPT_LENGTH";
const FRONTEND_ENV_KEY_STARTER_PROMPTS_ENABLED: &str = "STARTER_PROMPTS_ENABLED";
const FRONTEND_ENV_KEY_PROMPT_OPTIMIZER_ENABLED: &str = "PROMPT_OPTIMIZER_ENABLED";
const FRONTEND_ENV_KEY_USER_PREFERENCES_ENABLED: &str = "USER_PREFERENCES_ENABLED";
const FRONTEND_ENV_KEY_USER_PREFERENCES_DATA_TAB_ENABLED: &str =
    "USER_PREFERENCES_DATA_TAB_ENABLED";
const FRONTEND_ENV_KEY_MCP_SERVERS_TAB_ENABLED: &str = "MCP_SERVERS_TAB_ENABLED";
const FRONTEND_ENV_KEY_SHAREPOINT_ENABLED: &str = "SHAREPOINT_ENABLED";
const FRONTEND_ENV_KEY_SHAREPOINT_SHOW_DISCLAIMER: &str = "SHAREPOINT_SHOW_DISCLAIMER";
const FRONTEND_ENV_KEY_CHAT_SHARING_ENABLED: &str = "CHAT_SHARING_ENABLED";
const FRONTEND_ENV_KEY_MESSAGE_FEEDBACK_ENABLED: &str = "MESSAGE_FEEDBACK_ENABLED";
const FRONTEND_ENV_KEY_MESSAGE_FEEDBACK_COMMENTS_ENABLED: &str =
    "MESSAGE_FEEDBACK_COMMENTS_ENABLED";
const FRONTEND_ENV_KEY_MESSAGE_FEEDBACK_EDIT_TIME_LIMIT_SECONDS: &str =
    "MESSAGE_FEEDBACK_EDIT_TIME_LIMIT_SECONDS";
const FRONTEND_ENV_KEY_SHOW_VERBOSE_ASSISTANT_ERRORS: &str = "SHOW_VERBOSE_ASSISTANT_ERRORS";
const FRONTEND_ENV_KEY_SHOW_COPY_ERROR_REPORT: &str = "SHOW_COPY_ERROR_REPORT";
const FRONTEND_ENV_KEY_ERROR_REPORT_TEMPLATE: &str = "ERROR_REPORT_TEMPLATE";
const FRONTEND_ENV_KEY_ERROR_REPORT_ENVIRONMENT: &str = "ERROR_REPORT_ENVIRONMENT";
const FRONTEND_ENV_KEY_MAX_UPLOAD_SIZE_BYTES: &str = "MAX_UPLOAD_SIZE_BYTES";
const FRONTEND_ENV_KEY_AUDIO_TRANSCRIPTION_ENABLED: &str = "AUDIO_TRANSCRIPTION_ENABLED";
const FRONTEND_ENV_KEY_AUDIO_TRANSCRIPTION_MAX_RECORDING_DURATION_SECONDS: &str =
    "AUDIO_TRANSCRIPTION_MAX_RECORDING_DURATION_SECONDS";
const FRONTEND_ENV_KEY_AUDIO_DICTATION_ENABLED: &str = "AUDIO_DICTATION_ENABLED";
const FRONTEND_ENV_KEY_AUDIO_DICTATION_MAX_RECORDING_DURATION_SECONDS: &str =
    "AUDIO_DICTATION_MAX_RECORDING_DURATION_SECONDS";
const FRONTEND_ENV_KEY_AUDIO_CONVERSATIONAL_ENABLED: &str = "AUDIO_CONVERSATIONAL_ENABLED";
const FRONTEND_ENV_KEY_AUDIO_CONVERSATIONAL_MAX_RECORDING_DURATION_SECONDS: &str =
    "AUDIO_CONVERSATIONAL_MAX_RECORDING_DURATION_SECONDS";
const FRONTEND_ENV_KEY_SIDEBAR_COLLAPSED_MODE: &str = "SIDEBAR_COLLAPSED_MODE";
const FRONTEND_ENV_KEY_SIDEBAR_LOGO_PATH: &str = "SIDEBAR_LOGO_PATH";
const FRONTEND_ENV_KEY_SIDEBAR_LOGO_DARK_PATH: &str = "SIDEBAR_LOGO_DARK_PATH";
const FRONTEND_ENV_KEY_SIDEBAR_CHAT_HISTORY_SHOW_METADATA: &str =
    "SIDEBAR_CHAT_HISTORY_SHOW_METADATA";
const FRONTEND_ENV_KEY_MSAL_CLIENT_ID: &str = "MSAL_CLIENT_ID";
const FRONTEND_ENV_KEY_MSAL_AUTHORITY: &str = "MSAL_AUTHORITY";
const FRONTEND_ENV_KEY_MASK_REASONING_TRACE_TEXT: &str = "MASK_REASONING_TRACE_TEXT";
const COMPONENT_KITS_PUBLIC_MOUNT_BASE: &str = "/public/component-kits";
// Frontend bundles built before ERMAIN-460 used this stable runtime path.
const LEGACY_COMPONENT_KIT_REACT_RUNTIME_SCRIPT_PATH: &str =
    "/public/common/assets/component-kit-react-runtime.js";
const COMPONENT_KIT_REACT_RUNTIME_SCRIPT_PATH_PREFIX: &str =
    "/public/common/assets/component-kit-react-runtime-";
const OUTLOOK_OFFICE_FRAME_ANCESTORS: &[&str] = &[
    "https://outlook.office.com",
    "https://outlook.cloud.microsoft",
];

#[derive(Debug, Clone, Default)]
/// Map of values that will be provided as environment-variable-like global variables to the frontend.
///
/// Values can be injected from AppConfig.frontend.additional_environment, and can be strings or maps (string key, string value).
/// The values are only ordered, so that we have control over whether our keys or the user-provided keys have priority.
/// The values provided by users are not guaranteed to be in the order provided in the config file.
pub struct FrontedEnvironment {
    pub additional_environment: ListOrderedMultimap<String, Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FrontendKind {
    Web,
    OfficeAddin,
}

#[derive(Debug, Clone)]
pub struct ServedFrontend {
    pub bundle_path: String,
    pub environment: FrontedEnvironment,
    pub mount_path: String,
    pub enabled: bool,
    pub fallback_to_404: bool,
    pub inject_environment: bool,
    pub component_kit_assets: Vec<ComponentKitAsset>,
    pub content_security_policy: Option<HeaderValue>,
    /// Pre-serialized import map injected as the first `<head>` child so
    /// component kits resolve shared bare specifiers to app-bundle chunks.
    /// Only set for the web frontend.
    pub import_map_json: Option<String>,
}

#[derive(Debug, Clone)]
pub struct FrontendRegistry {
    frontends: Vec<ServedFrontend>,
    translation_po_compilation_mode: TranslationPoCompilationMode,
    translation_po_cache: Arc<TranslationPoCache>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComponentKitAsset {
    pub name: String,
    pub directory_path: String,
    pub mount_path: String,
    pub script_path: Option<String>,
    pub stylesheet_path: Option<String>,
}

impl FrontendRegistry {
    fn resolve(&self, request_path: &str) -> Option<&ServedFrontend> {
        if let Some(frontend) = self
            .frontends
            .iter()
            .filter(|frontend| frontend.mount_path != "/")
            .find(|frontend| matches_mount_path(request_path, &frontend.mount_path))
        {
            return frontend.enabled.then_some(frontend);
        }

        self.frontends
            .iter()
            .find(|frontend| frontend.mount_path == "/" && frontend.enabled)
    }
}

pub fn build_frontend_registry(config: &AppConfig) -> FrontendRegistry {
    let component_kit_assets = discover_component_kits(&config.frontend.component_kits.directory);
    let content_security_policy = build_content_security_policy(config);
    let web_import_map_json = load_import_map_json(&config.frontend.web_frontend_bundle_path, "/");
    let addin_import_map_json = load_import_map_json(
        &config.integrations.ms_office.addin.frontend_bundle_path,
        "/public/platform-office-addin",
    );
    let addin_legacy_import_map_json = load_import_map_json(
        &config.integrations.ms_office.addin.frontend_bundle_path,
        "/office-addin",
    );
    let mut frontends = vec![ServedFrontend {
        bundle_path: config
            .integrations
            .ms_office
            .addin
            .frontend_bundle_path
            .clone(),
        environment: build_frontend_environment(config, FrontendKind::OfficeAddin),
        mount_path: "/public/platform-office-addin".to_string(),
        enabled: config.integrations.ms_office.addin.enabled,
        fallback_to_404: true,
        inject_environment: true,
        component_kit_assets: component_kit_assets.clone(),
        content_security_policy: content_security_policy.clone(),
        import_map_json: addin_import_map_json,
    }];

    if config.integrations.ms_office.addin.serve_bundle_legacy_path {
        frontends.push(ServedFrontend {
            bundle_path: config
                .integrations
                .ms_office
                .addin
                .frontend_bundle_path
                .clone(),
            environment: build_frontend_environment(config, FrontendKind::OfficeAddin),
            mount_path: "/office-addin".to_string(),
            enabled: config.integrations.ms_office.addin.enabled,
            fallback_to_404: true,
            inject_environment: true,
            component_kit_assets: component_kit_assets.clone(),
            content_security_policy: content_security_policy.clone(),
            import_map_json: addin_legacy_import_map_json,
        });
    }

    frontends.push(ServedFrontend {
        bundle_path: config.frontend.web_frontend_bundle_path.clone(),
        environment: build_frontend_environment(config, FrontendKind::Web),
        mount_path: "/".to_string(),
        enabled: true,
        fallback_to_404: true,
        inject_environment: true,
        component_kit_assets: component_kit_assets.clone(),
        content_security_policy: content_security_policy.clone(),
        import_map_json: web_import_map_json,
    });

    for component_kit in component_kit_assets {
        frontends.push(ServedFrontend {
            bundle_path: component_kit.directory_path,
            environment: FrontedEnvironment::default(),
            mount_path: component_kit.mount_path,
            enabled: true,
            fallback_to_404: false,
            inject_environment: false,
            component_kit_assets: Vec::new(),
            content_security_policy: content_security_policy.clone(),
            import_map_json: None,
        });
    }

    FrontendRegistry {
        frontends,
        translation_po_compilation_mode: config.frontend.translation_po_compilation_mode,
        translation_po_cache: Arc::new(TranslationPoCache::default()),
    }
}

const IMPORT_MAP_MANIFEST_FILE_NAME: &str = "import-map.manifest.json";

/// Loads the shared-module import map emitted by the web frontend build
/// (`import-map.manifest.json`, specifier -> hashed chunk URL). Absent or
/// invalid manifests disable injection rather than failing startup so older
/// bundles keep serving.
fn load_import_map_json(bundle_path: &str, mount_path: &str) -> Option<String> {
    let manifest_path = Path::new(bundle_path).join(IMPORT_MAP_MANIFEST_FILE_NAME);
    let contents = match fs::read_to_string(&manifest_path) {
        Ok(contents) => contents,
        Err(error) => {
            tracing::info!(
                manifest_path = %manifest_path.display(),
                "No shared-module import map manifest found; skipping import map injection: {error}"
            );
            return None;
        }
    };
    match serde_json::from_str::<serde_json::Value>(&contents) {
        Ok(manifest) => match manifest.get("imports").and_then(|i| i.as_object()) {
            Some(imports) => Some(serialize_import_map(imports, mount_path)),
            None => {
                tracing::warn!(
                    manifest_path = %manifest_path.display(),
                    "Import map manifest is missing an \"imports\" object; skipping injection"
                );
                None
            }
        },
        Err(error) => {
            tracing::warn!(
                manifest_path = %manifest_path.display(),
                "Failed to parse import map manifest; skipping injection: {error}"
            );
            None
        }
    }
}

/// Manifest entries are bundle-relative so one bundle can serve under any
/// mount (the add-in bundle is mounted twice). Absolute entries pass through
/// unchanged.
fn serialize_import_map(
    imports: &serde_json::Map<String, serde_json::Value>,
    mount_path: &str,
) -> String {
    let mount_prefix = mount_path.trim_end_matches('/');
    let prefixed: serde_json::Map<String, serde_json::Value> = imports
        .iter()
        .map(|(specifier, url)| {
            let prefixed_url = match url.as_str() {
                Some(url) if !url.starts_with('/') => {
                    let relative = url.trim_start_matches("./");
                    serde_json::Value::String(format!("{mount_prefix}/{relative}"))
                }
                _ => url.clone(),
            };
            (specifier.clone(), prefixed_url)
        })
        .collect();
    serde_json::json!({ "imports": prefixed }).to_string()
}

fn build_content_security_policy(config: &AppConfig) -> Option<HeaderValue> {
    if config.frontend.allow_any_frame_ancestor {
        return None;
    }

    let mut frame_ancestors = vec!["'self'".to_string()];
    if config.integrations.ms_office.addin.enabled {
        frame_ancestors.extend(
            OUTLOOK_OFFICE_FRAME_ANCESTORS
                .iter()
                .map(ToString::to_string),
        );
    }
    frame_ancestors.extend(
        config
            .frontend
            .extra_frame_ancestors
            .iter()
            .map(|ancestor| ancestor.trim())
            .filter(|ancestor| !ancestor.is_empty())
            .map(ToOwned::to_owned),
    );

    let content_security_policy = format!("frame-ancestors {}", frame_ancestors.join(" "));
    Some(
        HeaderValue::from_str(&content_security_policy)
            .expect("generated Content-Security-Policy header should be valid"),
    )
}

fn is_valid_component_kit_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
        && name != "."
        && name != ".."
}

fn is_valid_component_kit_asset_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
        && !name.starts_with('.')
}

fn sorted_root_files(directory: &Path) -> io::Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_file() {
            files.push(entry.path());
        }
    }
    files.sort();
    Ok(files)
}

fn root_file_name(path: &Path) -> Option<String> {
    path.file_name()
        .and_then(|file_name| file_name.to_str())
        .map(ToOwned::to_owned)
}

fn discover_component_kit_entrypoint(directory: &Path) -> io::Result<Option<String>> {
    let entrypoints = sorted_root_files(directory)?
        .into_iter()
        .filter_map(|path| {
            let file_name = root_file_name(&path)?;
            (file_name.starts_with("index-")
                && file_name.ends_with(".js")
                && is_valid_component_kit_asset_name(&file_name))
            .then_some(file_name)
        })
        .collect::<Vec<_>>();

    if entrypoints.len() > 1 {
        tracing::warn!(
            component_kit_path = %directory.display(),
            entrypoints = ?entrypoints,
            selected_entrypoint = %entrypoints[0],
            "Component kit has multiple root index-*.js entrypoints; using the first sorted entrypoint"
        );
    }

    Ok(entrypoints.into_iter().next())
}

fn discover_component_kit_stylesheet(directory: &Path) -> io::Result<Option<String>> {
    let stylesheets = sorted_root_files(directory)?
        .into_iter()
        .filter_map(|path| {
            let file_name = root_file_name(&path)?;
            (file_name.ends_with(".css") && is_valid_component_kit_asset_name(&file_name))
                .then_some(file_name)
        })
        .collect::<Vec<_>>();

    if stylesheets.len() > 1 {
        tracing::warn!(
            component_kit_path = %directory.display(),
            stylesheets = ?stylesheets,
            selected_stylesheet = %stylesheets[0],
            "Component kit has multiple root .css files; using the first sorted stylesheet"
        );
    }

    Ok(stylesheets.into_iter().next())
}

fn discover_component_kits(directory: &str) -> Vec<ComponentKitAsset> {
    let component_kits_directory = Path::new(directory);
    if !component_kits_directory.exists() {
        tracing::debug!(
            component_kits_directory = %component_kits_directory.display(),
            "Component kits directory does not exist; no component kits loaded"
        );
        return Vec::new();
    }

    let mut directories = match fs::read_dir(component_kits_directory) {
        Ok(entries) => entries
            .filter_map(|entry| match entry {
                Ok(entry) => Some(entry),
                Err(err) => {
                    tracing::warn!(
                        component_kits_directory = %component_kits_directory.display(),
                        error = %err,
                        "Failed to read component kit directory entry"
                    );
                    None
                }
            })
            .filter_map(|entry| match entry.file_type() {
                Ok(file_type) if file_type.is_dir() => Some(entry.path()),
                Ok(_) => None,
                Err(err) => {
                    tracing::warn!(
                        component_kit_path = %entry.path().display(),
                        error = %err,
                        "Failed to inspect component kit directory entry"
                    );
                    None
                }
            })
            .collect::<Vec<_>>(),
        Err(err) => {
            tracing::warn!(
                component_kits_directory = %component_kits_directory.display(),
                error = %err,
                "Failed to read component kits directory"
            );
            return Vec::new();
        }
    };
    directories.sort();

    directories
        .into_iter()
        .filter_map(|directory| {
            let Some(name) = root_file_name(&directory) else {
                tracing::warn!(
                    component_kit_path = %directory.display(),
                    "Skipping component kit with non-Unicode directory name"
                );
                return None;
            };

            if !is_valid_component_kit_name(&name) {
                tracing::warn!(
                    component_kit = %name,
                    component_kit_path = %directory.display(),
                    "Skipping component kit with URL-unsafe directory name"
                );
                return None;
            }

            let script_path = match discover_component_kit_entrypoint(&directory) {
                Ok(entrypoint) => entrypoint.map(|file_name| {
                    format!("{COMPONENT_KITS_PUBLIC_MOUNT_BASE}/{name}/{file_name}")
                }),
                Err(err) => {
                    tracing::warn!(
                        component_kit = %name,
                        component_kit_path = %directory.display(),
                        error = %err,
                        "Failed to inspect component kit entrypoint"
                    );
                    None
                }
            };

            if script_path.is_none() {
                tracing::warn!(
                    component_kit = %name,
                    component_kit_path = %directory.display(),
                    "Component kit is missing a root index-<hash>.js entrypoint"
                );
            }

            let stylesheet_path = match discover_component_kit_stylesheet(&directory) {
                Ok(stylesheet) => stylesheet.map(|file_name| {
                    format!("{COMPONENT_KITS_PUBLIC_MOUNT_BASE}/{name}/{file_name}")
                }),
                Err(err) => {
                    tracing::warn!(
                        component_kit = %name,
                        component_kit_path = %directory.display(),
                        error = %err,
                        "Failed to inspect component kit stylesheet"
                    );
                    None
                }
            };

            let mount_path = format!("{COMPONENT_KITS_PUBLIC_MOUNT_BASE}/{name}");
            tracing::info!(
                component_kit = %name,
                component_kit_path = %directory.display(),
                mount_path = %mount_path,
                script_path = ?script_path,
                stylesheet_path = ?stylesheet_path,
                "Discovered component kit"
            );

            Some(ComponentKitAsset {
                name,
                directory_path: directory.to_string_lossy().into_owned(),
                mount_path,
                script_path,
                stylesheet_path,
            })
        })
        .collect()
}

fn build_frontend_environment(
    config: &AppConfig,
    frontend_kind: FrontendKind,
) -> FrontedEnvironment {
    let mut env = FrontedEnvironment::default();

    let api_root_url = "/api/".to_string();

    env.additional_environment.insert(
        FRONTEND_ENV_KEY_API_ROOT_URL.to_string(),
        Value::String(api_root_url.clone()),
    );
    let (frontend_platform, frontend_public_base_path) = match frontend_kind {
        FrontendKind::Web => ("common", "/public/common"),
        FrontendKind::OfficeAddin => ("platform-office-addin", "/public/platform-office-addin"),
    };
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_FRONTEND_PLATFORM.to_string(),
        Value::String(frontend_platform.to_string()),
    );
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_FRONTEND_PUBLIC_BASE_PATH.to_string(),
        Value::String(frontend_public_base_path.to_string()),
    );
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_COMMON_PUBLIC_BASE_PATH.to_string(),
        Value::String("/public/common".to_string()),
    );
    if let Some(theme) = &config.frontend.theme {
        env.additional_environment.insert(
            FRONTEND_ENV_KEY_THEME_CUSTOMER_NAME.to_string(),
            Value::String(theme.clone()),
        );
    }

    // Inject frontend configuration flags
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_DISABLE_UPLOAD.to_string(),
        Value::Bool(config.frontend.disable_upload),
    );
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_DISABLE_CHAT_INPUT_AUTOFOCUS.to_string(),
        Value::Bool(config.frontend.disable_chat_input_autofocus),
    );
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_CHAT_INPUT_EMPTY_STATE_LAYOUT.to_string(),
        Value::String(config.frontend.chat_input_empty_state_layout.clone()),
    );
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_DISABLE_LOGOUT.to_string(),
        Value::Bool(config.frontend.disable_logout),
    );
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_ASSISTANTS_ENABLED.to_string(),
        Value::Bool(config.assistants.enabled),
    );
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_ASSISTANTS_SHOW_RECENT_ITEMS.to_string(),
        Value::Bool(config.assistants.show_recent_items),
    );
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_ASSISTANTS_CONTEXT_WARNING_THRESHOLD.to_string(),
        Value::from(config.assistants.context_warning_threshold),
    );
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_ASSISTANTS_CONTEXT_FILE_CONTRIBUTOR_THRESHOLD.to_string(),
        Value::from(config.assistants.context_file_contributor_threshold),
    );
    if let Some(max_length) = config.assistants.max_system_prompt_length {
        env.additional_environment.insert(
            FRONTEND_ENV_KEY_ASSISTANTS_MAX_SYSTEM_PROMPT_LENGTH.to_string(),
            Value::Number(max_length.into()),
        );
    }
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_STARTER_PROMPTS_ENABLED.to_string(),
        Value::Bool(config.starter_prompts.enabled),
    );
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_PROMPT_OPTIMIZER_ENABLED.to_string(),
        Value::Bool(config.prompt_optimizer.enabled),
    );
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_USER_PREFERENCES_ENABLED.to_string(),
        Value::Bool(config.user_preferences.enabled),
    );
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_USER_PREFERENCES_DATA_TAB_ENABLED.to_string(),
        Value::Bool(config.user_preferences.data_tab_enabled),
    );
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_MCP_SERVERS_TAB_ENABLED.to_string(),
        Value::Bool(config.mcp_servers_global.show_frontend_tab),
    );
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_SHAREPOINT_ENABLED.to_string(),
        Value::Bool(
            config.integrations.experimental_sharepoint.enabled
                && config
                    .integrations
                    .experimental_sharepoint
                    .file_upload_enabled,
        ),
    );
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_SHAREPOINT_SHOW_DISCLAIMER.to_string(),
        Value::Bool(config.integrations.experimental_sharepoint.show_disclaimer),
    );
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_CHAT_SHARING_ENABLED.to_string(),
        Value::Bool(config.chat_sharing.enabled),
    );
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_MESSAGE_FEEDBACK_ENABLED.to_string(),
        Value::Bool(config.frontend.enable_message_feedback),
    );
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_MESSAGE_FEEDBACK_COMMENTS_ENABLED.to_string(),
        Value::Bool(config.frontend.enable_message_feedback_comments),
    );
    if let Some(limit) = config.frontend.message_feedback_edit_time_limit_seconds {
        env.additional_environment.insert(
            FRONTEND_ENV_KEY_MESSAGE_FEEDBACK_EDIT_TIME_LIMIT_SECONDS.to_string(),
            Value::Number(limit.into()),
        );
    }
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_SHOW_VERBOSE_ASSISTANT_ERRORS.to_string(),
        Value::Bool(config.frontend.error_report.show_verbose_assistant_errors),
    );
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_SHOW_COPY_ERROR_REPORT.to_string(),
        Value::Bool(config.frontend.error_report.show_copy_error_report),
    );
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_ERROR_REPORT_TEMPLATE.to_string(),
        Value::String(config.frontend.error_report.error_report_template.clone()),
    );
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_ERROR_REPORT_ENVIRONMENT.to_string(),
        Value::String(config.environment.clone()),
    );
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_AUDIO_TRANSCRIPTION_ENABLED.to_string(),
        Value::Bool(config.audio_transcription.enabled),
    );
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_AUDIO_TRANSCRIPTION_MAX_RECORDING_DURATION_SECONDS.to_string(),
        Value::Number(
            config
                .audio_transcription
                .max_recording_duration_seconds
                .into(),
        ),
    );
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_AUDIO_DICTATION_ENABLED.to_string(),
        Value::Bool(config.audio_dictation.enabled),
    );
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_AUDIO_DICTATION_MAX_RECORDING_DURATION_SECONDS.to_string(),
        Value::Number(config.audio_dictation.max_recording_duration_seconds.into()),
    );
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_AUDIO_CONVERSATIONAL_ENABLED.to_string(),
        Value::Bool(config.audio_conversational.enabled),
    );
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_AUDIO_CONVERSATIONAL_MAX_RECORDING_DURATION_SECONDS.to_string(),
        Value::Number(
            config
                .audio_conversational
                .max_recording_duration_seconds
                .into(),
        ),
    );
    // Always inject max upload size (use configured value or default)
    let max_upload_size = config
        .max_upload_size_bytes()
        .unwrap_or(DEFAULT_MAX_BODY_LIMIT_BYTES);
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_MAX_UPLOAD_SIZE_BYTES.to_string(),
        Value::Number(max_upload_size.into()),
    );

    // Inject sidebar configuration
    env.additional_environment.insert(
        FRONTEND_ENV_KEY_SIDEBAR_COLLAPSED_MODE.to_string(),
        Value::String(config.frontend.sidebar_collapsed_mode.clone()),
    );

    if let Some(path) = &config.frontend.sidebar_logo_path {
        env.additional_environment.insert(
            FRONTEND_ENV_KEY_SIDEBAR_LOGO_PATH.to_string(),
            Value::String(path.clone()),
        );
    }

    if let Some(path) = &config.frontend.sidebar_logo_dark_path {
        env.additional_environment.insert(
            FRONTEND_ENV_KEY_SIDEBAR_LOGO_DARK_PATH.to_string(),
            Value::String(path.clone()),
        );
    }

    env.additional_environment.insert(
        FRONTEND_ENV_KEY_SIDEBAR_CHAT_HISTORY_SHOW_METADATA.to_string(),
        Value::Bool(config.frontend.sidebar_chat_history_show_metadata),
    );

    env.additional_environment.insert(
        FRONTEND_ENV_KEY_MASK_REASONING_TRACE_TEXT.to_string(),
        Value::Bool(config.frontend.mask_reasoning_trace_text),
    );

    // Inject pairs from frontend.additional_environment
    for (key, value) in &config.additional_frontend_environment() {
        env.additional_environment
            .insert(key.clone(), value.clone());
    }

    if frontend_kind == FrontendKind::OfficeAddin {
        if let Some(msal_client_id) = &config.integrations.ms_office.addin.msal_client_id {
            env.additional_environment.insert(
                FRONTEND_ENV_KEY_MSAL_CLIENT_ID.to_string(),
                Value::String(msal_client_id.clone()),
            );
        }
        env.additional_environment.insert(
            FRONTEND_ENV_KEY_MSAL_AUTHORITY.to_string(),
            Value::String(config.integrations.ms_office.addin.msal_authority.clone()),
        );
    }

    env
}

#[derive(Debug, Clone)]
pub struct DeploymentVersion(pub Option<String>, pub String);

impl DeploymentVersion {
    /// Read the deployment version from the ERATO_DEPLOYMENT_VERSION environment variable.
    /// This bypasses the config.rs mechanism and reads directly from the environment.
    pub fn from_env() -> Self {
        let version = std::env::var("ERATO_DEPLOYMENT_VERSION").ok();
        Self(version, random_hex_string())
    }

    fn etag_value_for_path(
        &self,
        request_path: &str,
        translation_po_compilation_mode: TranslationPoCompilationMode,
    ) -> Option<String> {
        self.0.as_ref().map(|version| {
            let etag_seed = if translation_po_compilation_mode
                == TranslationPoCompilationMode::JustInTime
                && is_i18n_messages_json(request_path)
            {
                format!("{version}-{}", self.1)
            } else {
                version.clone()
            };
            format!("\"{etag_seed}\"")
        })
    }
}

fn random_hex_string() -> String {
    let bytes: [u8; 16] = rand::random();
    let mut hex = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(hex, "{byte:02x}").unwrap();
    }
    hex
}

#[derive(Debug, Deserialize)]
struct ServerConfig {
    rewrites: Vec<RewriteRule>,
}

#[derive(Debug, Deserialize)]
struct RewriteRule {
    source: String,
    destination: String,
}

fn matches_mount_path(request_path: &str, mount_path: &str) -> bool {
    mount_path == "/"
        || request_path == mount_path
        || request_path
            .strip_prefix(mount_path)
            .is_some_and(|suffix| suffix.starts_with('/'))
}

fn is_component_kit_react_runtime_script_path(path: &str) -> bool {
    path == LEGACY_COMPONENT_KIT_REACT_RUNTIME_SCRIPT_PATH
        || (path.starts_with(COMPONENT_KIT_REACT_RUNTIME_SCRIPT_PATH_PREFIX)
            && path.ends_with(".js"))
}

fn load_server_config(bundle_path: String) -> Option<ServerConfig> {
    let config_path = Path::new(&bundle_path).join("serve.json");
    if !config_path.exists() {
        return None;
    }

    match fs::read_to_string(config_path) {
        Ok(contents) => serde_json::from_str(&contents).ok(),
        Err(_) => None,
    }
}

fn matches_rewrite_rule(path: &str, rule: &RewriteRule) -> bool {
    let pattern_parts: Vec<&str> = rule.source.split('/').collect();
    let path_parts: Vec<&str> = path.split('/').collect();

    if pattern_parts.len() != path_parts.len() {
        return false;
    }

    for (pattern, path_part) in pattern_parts.iter().zip(path_parts.iter()) {
        if pattern.starts_with(':') {
            continue; // This is a parameter, it matches anything
        }
        if pattern != path_part {
            return false;
        }
    }
    true
}

fn is_i18n_messages_json(path: &str) -> bool {
    path.ends_with("/messages.json") && path.contains("/locales/")
}

fn safe_request_file_path(bundle_dir_path: &Path, request_path: &str) -> Option<PathBuf> {
    let mut file_path = bundle_dir_path.to_path_buf();
    for segment in request_path.trim_start_matches('/').split('/') {
        if segment.is_empty() || segment == "." || segment == ".." {
            return None;
        }
        file_path.push(segment);
    }
    Some(file_path)
}

fn translation_po_path_for_messages_json(
    bundle_dir_path: &Path,
    request_path: &str,
) -> Option<PathBuf> {
    if !is_i18n_messages_json(request_path) {
        return None;
    }

    let mut file_path = safe_request_file_path(bundle_dir_path, request_path)?;
    file_path.set_extension("po");
    file_path.exists().then_some(file_path)
}

/// Rewrites HTML to inject a `<script>` tag (which contains global JS variables that act like environment variables)
/// into the `<head>` tag.
pub fn inject_environment_script_tag(
    input: &[u8],
    output: &mut Vec<u8>,
    frontend_env: &FrontedEnvironment,
    component_kit_assets: &[ComponentKitAsset],
    import_map_json: Option<&str>,
) -> io::Result<()> {
    let mut script_tag = String::new();
    script_tag.write_str("<script>\n").unwrap();
    // Writes a line with the content `window.KEY = "VALUE";` for every entry
    for (key, value) in &frontend_env.additional_environment {
        script_tag.write_str("window.").unwrap();
        script_tag.write_str(key).unwrap();
        script_tag.write_str(" = ").unwrap();
        script_tag
            .write_str(&serde_json::to_string(&value)?)
            .unwrap();
        script_tag.write_str(";\n").unwrap();
    }
    script_tag.write_str("</script>").unwrap();

    let mut component_kit_styles = String::new();
    let mut component_kit_scripts = String::new();
    for component_kit in component_kit_assets {
        if let Some(stylesheet_path) = &component_kit.stylesheet_path {
            write!(
                component_kit_styles,
                "<link rel=\"stylesheet\" href=\"{}\">",
                stylesheet_path
            )
            .unwrap();
        }
        if let Some(script_path) = &component_kit.script_path {
            write!(
                component_kit_scripts,
                "<script type=\"module\" src=\"{}\"></script>",
                script_path
            )
            .unwrap();
        }
    }
    let inserted_component_kit_scripts = std::cell::Cell::new(false);
    let component_kit_runtime_script_path = std::cell::RefCell::new(None);
    let mut rewriter = HtmlRewriter::new(
        Settings {
            element_content_handlers: vec![
                element!("head", |el| {
                    // The import map must precede every `<script type="module">`
                    // tag in document order, so prepend rather than append.
                    if let Some(import_map_json) = import_map_json {
                        el.prepend(
                            &format!("<script type=\"importmap\">{import_map_json}</script>"),
                            ContentType::Html,
                        );
                    }
                    el.append(&script_tag, ContentType::Html);
                    if !component_kit_styles.is_empty() {
                        el.append(&component_kit_styles, ContentType::Html);
                    }
                    Ok(())
                }),
                element!("link[rel=\"modulepreload\"][href]", |el| {
                    // Vite emits the runtime entry as a preload because the app imports it too.
                    if let Some(href) = el.get_attribute("href")
                        && is_component_kit_react_runtime_script_path(&href)
                    {
                        component_kit_runtime_script_path.replace(Some(href));
                    }
                    Ok(())
                }),
                element!(
                    "script[type=\"module\"][src][data-erato-component-kit-react-runtime]",
                    |el| {
                        if !component_kit_scripts.is_empty()
                            && !inserted_component_kit_scripts.get()
                        {
                            el.after(&component_kit_scripts, ContentType::Html);
                            inserted_component_kit_scripts.set(true);
                        }
                        Ok(())
                    }
                ),
                element!("script[type=\"module\"][src]", |el| {
                    let is_react_runtime_marker = el
                        .get_attribute("data-erato-component-kit-react-runtime")
                        .is_some();
                    if !component_kit_scripts.is_empty()
                        && !inserted_component_kit_scripts.get()
                        && !is_react_runtime_marker
                    {
                        let runtime_script_path = component_kit_runtime_script_path.borrow();
                        let runtime_script_path = runtime_script_path
                            .as_deref()
                            .unwrap_or(LEGACY_COMPONENT_KIT_REACT_RUNTIME_SCRIPT_PATH);
                        let component_kit_runtime_and_scripts = format!(
                            "<script type=\"module\" src=\"{runtime_script_path}\"></script>{component_kit_scripts}"
                        );
                        el.before(&component_kit_runtime_and_scripts, ContentType::Html);
                        inserted_component_kit_scripts.set(true);
                    }
                    Ok(())
                }),
            ],
            ..Settings::default()
        },
        |c: &[u8]| output.extend_from_slice(c),
    );

    rewriter.write(input).unwrap();
    rewriter.end().unwrap();
    Ok(())
}

pub mod axum {
    use super::*;
    use ::axum::body::{Body, Bytes};

    use ::axum::http::{HeaderMap, HeaderName, HeaderValue, Request, StatusCode, Uri};
    use ::axum::response::Response;
    use ::axum::{BoxError, Extension, http};
    use http_body_util::BodyExt;
    use http_body_util::combinators::UnsyncBoxBody;
    use std::convert::Infallible;
    use std::path::PathBuf;
    use tower_http::services::{ServeDir, ServeFile};

    fn insert_content_security_policy(
        headers: &mut HeaderMap,
        content_security_policy: Option<&HeaderValue>,
    ) {
        if let Some(content_security_policy) = content_security_policy {
            headers.insert(
                HeaderName::from_static("content-security-policy"),
                content_security_policy.clone(),
            );
        }
    }

    fn rewrite_request_path(req: Request<Body>, mount_path: &str) -> Request<Body> {
        if mount_path == "/" {
            return req;
        }

        let (mut parts, body) = req.into_parts();
        let stripped_path = parts
            .uri
            .path()
            .strip_prefix(mount_path)
            .unwrap_or(parts.uri.path());
        let normalized_path = if stripped_path.is_empty() {
            "/"
        } else {
            stripped_path
        };
        let path_and_query = match parts.uri.query() {
            Some(query) => format!("{normalized_path}?{query}"),
            None => normalized_path.to_string(),
        };
        parts.uri = path_and_query
            .parse::<Uri>()
            .expect("rewritten static asset path should be a valid URI");
        Request::from_parts(parts, body)
    }

    fn full_body(bytes: Bytes) -> UnsyncBoxBody<Bytes, BoxError> {
        http_body_util::Full::from(bytes)
            .map_err(|never| -> BoxError { match never {} })
            .boxed_unsync()
    }

    fn not_found_response() -> Response<UnsyncBoxBody<Bytes, BoxError>> {
        Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header(http::header::CONTENT_TYPE, "text/plain; charset=utf-8")
            .body(full_body(Bytes::from_static(b"Not Found")))
            .unwrap()
    }

    fn internal_server_error_response() -> Response<UnsyncBoxBody<Bytes, BoxError>> {
        Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .header(http::header::CONTENT_TYPE, "text/plain; charset=utf-8")
            .body(full_body(Bytes::from_static(b"Internal Server Error")))
            .unwrap()
    }

    fn not_modified_response(
        etag_value: String,
        cache_control: &'static str,
        content_security_policy: Option<&HeaderValue>,
    ) -> Response<UnsyncBoxBody<Bytes, BoxError>> {
        let mut response = Response::builder()
            .status(StatusCode::NOT_MODIFIED)
            .header(http::header::ETAG, etag_value)
            .header(http::header::CACHE_CONTROL, cache_control)
            .body(
                http_body_util::Empty::new()
                    .map_err(|never| -> BoxError { match never {} })
                    .boxed_unsync(),
            )
            .unwrap();
        insert_content_security_policy(response.headers_mut(), content_security_policy);
        response
    }

    fn cache_control_for_path(request_path: &str) -> &'static str {
        if is_i18n_messages_json(request_path) {
            "no-cache"
        } else {
            "public, max-age=3600, stale-while-revalidate=604800"
        }
    }

    fn client_etag_matches(client_etag: Option<&HeaderValue>, etag_value: &str) -> bool {
        client_etag.and_then(|etag| etag.to_str().ok()) == Some(etag_value)
    }

    fn apply_non_html_cache_headers(
        res: &mut Response<UnsyncBoxBody<Bytes, BoxError>>,
        etag_value: Option<&str>,
        cache_control: &'static str,
    ) {
        if let Some(etag_value) = etag_value {
            res.headers_mut().insert(
                http::header::ETAG,
                HeaderValue::from_str(etag_value).unwrap(),
            );
            res.headers_mut().insert(
                http::header::CACHE_CONTROL,
                HeaderValue::from_static(cache_control),
            );
        } else {
            // No deployment version - use no-cache as a safe fallback
            res.headers_mut().insert(
                http::header::CACHE_CONTROL,
                HeaderValue::from_static("no-cache"),
            );
        }
    }

    /// Static file handler that injects a script tag with environment variables into HTML files.
    /// Also handles cache headers for static files based on deployment version.
    pub async fn serve_files_with_script(
        Extension(frontend_registry): Extension<FrontendRegistry>,
        Extension(deployment_version): Extension<DeploymentVersion>,
        req: Request<Body>,
    ) -> Result<Response<UnsyncBoxBody<Bytes, BoxError>>, Infallible> {
        let request_path = req.uri().path().to_string();
        let Some(frontend) = frontend_registry.resolve(&request_path) else {
            return Ok(not_found_response());
        };

        let frontend_environment = frontend.environment.clone();
        let component_kit_assets = frontend.component_kit_assets.clone();
        let import_map_json = frontend.import_map_json.clone();
        let content_security_policy = frontend.content_security_policy.clone();
        let should_inject_environment = frontend.inject_environment;
        let bundle_dir_path = PathBuf::from(frontend.bundle_path.clone())
            .canonicalize()
            .expect("Unable to normalize frontend bundle path");
        let fallback_path = frontend.fallback_to_404.then(|| {
            PathBuf::from(frontend.bundle_path.clone())
                .join("404.html")
                .canonicalize()
                .expect("Unable to normalize frontend bundle path for 404.html")
        });

        // Check if the client sent an If-None-Match header for ETag validation
        let client_etag = req.headers().get(http::header::IF_NONE_MATCH).cloned();

        // Check if we have any rewrite rules that match
        let stripped_path = req
            .uri()
            .path()
            .strip_prefix(&frontend.mount_path)
            .unwrap_or(req.uri().path())
            .to_string();
        let stripped_path = if stripped_path.is_empty() {
            "/".to_string()
        } else {
            stripped_path
        };
        let req = rewrite_request_path(req, &frontend.mount_path);
        let rewritten_request_path = req.uri().path().to_string();

        if frontend_registry.translation_po_compilation_mode
            == TranslationPoCompilationMode::JustInTime
            && let Some(po_path) =
                translation_po_path_for_messages_json(&bundle_dir_path, &rewritten_request_path)
        {
            match frontend_registry
                .translation_po_cache
                .compile_messages_json(&po_path)
            {
                Ok(body) => {
                    let cache_control = cache_control_for_path(&request_path);
                    let etag_value = deployment_version.etag_value_for_path(
                        &request_path,
                        frontend_registry.translation_po_compilation_mode,
                    );
                    if let Some(etag_value) = &etag_value
                        && client_etag_matches(client_etag.as_ref(), etag_value)
                    {
                        return Ok(not_modified_response(
                            etag_value.clone(),
                            cache_control,
                            content_security_policy.as_ref(),
                        ));
                    }

                    let mut res = Response::builder()
                        .status(StatusCode::OK)
                        .header(http::header::CONTENT_TYPE, "application/json")
                        .body(full_body(Bytes::from(body)))
                        .unwrap();
                    apply_non_html_cache_headers(&mut res, etag_value.as_deref(), cache_control);
                    insert_content_security_policy(
                        res.headers_mut(),
                        content_security_policy.as_ref(),
                    );
                    return Ok(res);
                }
                Err(error) => {
                    tracing::error!(
                        po_path = %po_path.display(),
                        "Failed to compile translation PO catalog just in time: {error}"
                    );
                    return Ok(internal_server_error_response());
                }
            }
        }

        let rewritten_path = if frontend.fallback_to_404 {
            if let Some(server_config) = load_server_config(frontend.bundle_path.clone()) {
                let matching_rule = server_config
                    .rewrites
                    .iter()
                    .find(|rule| matches_rewrite_rule(&stripped_path, rule));
                matching_rule.map(|rule| rule.destination.clone())
            } else {
                None
            }
        } else {
            None
        };

        // Create the static files service with the rewritten path if applicable
        let res = if let Some(rewritten_path) = rewritten_path {
            let rewritten_file_path = PathBuf::from(frontend.bundle_path.clone())
                .join(rewritten_path.trim_start_matches('/'))
                .canonicalize()
                .unwrap();
            ServeFile::new(rewritten_file_path.clone())
                .try_call(req)
                .await
                .unwrap()
        } else if let Some(fallback_path) = fallback_path {
            ServeDir::new(bundle_dir_path)
                .not_found_service(ServeFile::new(fallback_path))
                .try_call(req)
                .await
                .unwrap()
        } else {
            ServeDir::new(bundle_dir_path).try_call(req).await.unwrap()
        };

        let headers = res.headers().clone();
        let is_html =
            headers.get(http::header::CONTENT_TYPE) == Some(&HeaderValue::from_static("text/html"));

        if is_html && should_inject_environment {
            // HTML files: inject environment variables and prevent caching (for auth)
            let mut res = res.map(move |body| {
                let body_bytes = body.map_err(Into::into).boxed_unsync();
                // Inject variables into HTML files
                body_bytes
                    .map_frame(move |frame| {
                        frame.map_data({
                            let value = frontend_environment.clone();
                            let component_kit_assets = component_kit_assets.clone();
                            let import_map_json = import_map_json.clone();
                            move |bytes| {
                                let mut output = Vec::with_capacity(bytes.len() * 2);
                                inject_environment_script_tag(
                                    bytes.as_ref(),
                                    &mut output,
                                    &value,
                                    &component_kit_assets,
                                    import_map_json.as_deref(),
                                )
                                .unwrap();
                                output.into()
                            }
                        })
                    })
                    .boxed_unsync()
            });
            // Remove content-length, as we are extending the body, and with the smaller original content-length,
            // some clients stop reading before the end of the response.
            res.headers_mut().remove(http::header::CONTENT_LENGTH);
            // Prevent caching, or otherwise Cache might prevent proper auth.
            res.headers_mut().insert(
                http::header::CACHE_CONTROL,
                HeaderValue::from_static("no-cache, no-store, must-revalidate, private"),
            );
            res.headers_mut()
                .insert(http::header::PRAGMA, HeaderValue::from_static("no-cache"));
            res.headers_mut()
                .insert(http::header::EXPIRES, HeaderValue::from_static("0"));
            insert_content_security_policy(res.headers_mut(), content_security_policy.as_ref());

            Ok(res)
        } else {
            // Non-HTML files (theme files, locales, etc.): add cache headers based on deployment version
            let mut res = res.map(|body| body.map_err(Into::into).boxed_unsync());
            let cache_control = cache_control_for_path(&request_path);
            let etag_value = deployment_version.etag_value_for_path(
                &request_path,
                frontend_registry.translation_po_compilation_mode,
            );

            if let Some(etag_value) = &etag_value {
                // Check if the client's ETag matches our current version
                if client_etag_matches(client_etag.as_ref(), etag_value) {
                    // ETag matches - return 304 Not Modified
                    return Ok(not_modified_response(
                        etag_value.clone(),
                        cache_control,
                        content_security_policy.as_ref(),
                    ));
                }
            }
            apply_non_html_cache_headers(&mut res, etag_value.as_deref(), cache_control);
            insert_content_security_policy(res.headers_mut(), content_security_policy.as_ref());

            Ok(res)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn served_frontend(mount_path: &str, enabled: bool) -> ServedFrontend {
        ServedFrontend {
            bundle_path: "./public".to_string(),
            environment: FrontedEnvironment::default(),
            mount_path: mount_path.to_string(),
            enabled,
            fallback_to_404: true,
            inject_environment: true,
            component_kit_assets: Vec::new(),
            content_security_policy: Some(HeaderValue::from_static("frame-ancestors 'self'")),
            import_map_json: None,
        }
    }

    fn content_security_policy_str(config: &AppConfig) -> Option<String> {
        build_content_security_policy(config)
            .and_then(|value| value.to_str().ok().map(ToOwned::to_owned))
    }

    #[test]
    fn content_security_policy_defaults_to_self_frame_ancestor() {
        let config = AppConfig::default();

        assert_eq!(
            content_security_policy_str(&config).as_deref(),
            Some("frame-ancestors 'self'")
        );
    }

    #[test]
    fn content_security_policy_includes_outlook_when_office_addin_is_enabled() {
        let mut config = AppConfig::default();
        config.integrations.ms_office.addin.enabled = true;

        assert_eq!(
            content_security_policy_str(&config).as_deref(),
            Some(
                "frame-ancestors 'self' https://outlook.office.com https://outlook.cloud.microsoft"
            )
        );
    }

    #[test]
    fn content_security_policy_includes_extra_frame_ancestors() {
        let mut config = AppConfig::default();
        config.frontend.extra_frame_ancestors = vec![
            "https://outlook.cloud.microsoft".to_string(),
            " https://example.com ".to_string(),
            " ".to_string(),
        ];

        assert_eq!(
            content_security_policy_str(&config).as_deref(),
            Some("frame-ancestors 'self' https://outlook.cloud.microsoft https://example.com")
        );
    }

    #[test]
    fn content_security_policy_is_omitted_when_any_frame_ancestor_is_allowed() {
        let mut config = AppConfig::default();
        config.integrations.ms_office.addin.enabled = true;
        config.frontend.extra_frame_ancestors = vec!["https://example.com".to_string()];
        config.frontend.allow_any_frame_ancestor = true;

        assert_eq!(build_content_security_policy(&config), None);
    }

    #[test]
    fn error_report_template_and_environment_are_exposed_to_the_frontend() {
        let mut config = AppConfig {
            environment: "test-environment".to_string(),
            ..Default::default()
        };
        config.frontend.error_report.error_report_template =
            "environment={{environment}} error={{error}}".to_string();

        let env = build_frontend_environment(&config, FrontendKind::Web);

        assert!(env.additional_environment.iter().any(|(key, value)| {
            key == FRONTEND_ENV_KEY_ERROR_REPORT_TEMPLATE
                && value
                    == &Value::String("environment={{environment}} error={{error}}".to_string())
        }));
        assert!(env.additional_environment.iter().any(|(key, value)| {
            key == FRONTEND_ENV_KEY_ERROR_REPORT_ENVIRONMENT
                && value == &Value::String("test-environment".to_string())
        }));
    }

    #[test]
    fn specific_mount_path_matches_before_root() {
        let registry = FrontendRegistry {
            frontends: vec![
                served_frontend("/public/platform-office-addin", true),
                served_frontend("/office-addin", true),
                served_frontend("/", true),
            ],
            translation_po_compilation_mode: TranslationPoCompilationMode::Precompiled,
            translation_po_cache: Arc::new(TranslationPoCache::default()),
        };

        let frontend = registry
            .resolve("/office-addin/assets/app.js")
            .expect("office add-in route should resolve");
        assert_eq!(frontend.mount_path, "/office-addin");
    }

    #[test]
    fn disabled_specific_mount_path_does_not_fall_back_to_root() {
        let registry = FrontendRegistry {
            frontends: vec![
                served_frontend("/office-addin", false),
                served_frontend("/", true),
            ],
            translation_po_compilation_mode: TranslationPoCompilationMode::Precompiled,
            translation_po_cache: Arc::new(TranslationPoCache::default()),
        };

        assert!(registry.resolve("/office-addin").is_none());
    }

    #[test]
    fn import_map_entries_are_prefixed_per_mount() {
        let manifest: serde_json::Map<String, serde_json::Value> = serde_json::from_str(
            r#"{"react":"assets/shared-react-x.mjs","@erato/frontend/shared":"./shared-erato-y.mjs","legacy":"/public/common/assets/abs.js"}"#,
        )
        .expect("manifest fixture should parse");

        let web = serialize_import_map(&manifest, "/");
        assert!(web.contains(r#""react":"/assets/shared-react-x.mjs""#));
        assert!(web.contains(r#""@erato/frontend/shared":"/shared-erato-y.mjs""#));
        assert!(web.contains(r#""legacy":"/public/common/assets/abs.js""#));

        let addin = serialize_import_map(&manifest, "/public/platform-office-addin");
        assert!(
            addin.contains(r#""react":"/public/platform-office-addin/assets/shared-react-x.mjs""#)
        );
        assert!(addin.contains(
            r#""@erato/frontend/shared":"/public/platform-office-addin/shared-erato-y.mjs""#
        ));
    }

    #[test]
    fn injects_import_map_before_module_scripts() {
        let input = br#"<!doctype html><html><head><script type="module" src="/public/common/assets/app-abc.js"></script></head><body></body></html>"#;
        let mut output = Vec::new();
        let import_map = r#"{"imports":{"react":"/public/common/assets/shared-react-x.js"}}"#;

        inject_environment_script_tag(
            input,
            &mut output,
            &FrontedEnvironment::default(),
            &[],
            Some(import_map),
        )
        .expect("html injection should succeed");

        let output = String::from_utf8(output).expect("output should be utf8");
        let map_index = output
            .find(r#"<script type="importmap">{"imports":{"react":"/public/common/assets/shared-react-x.js"}}</script>"#)
            .expect("import map should be injected");
        let module_script_index = output
            .find(r#"<script type="module" src="/public/common/assets/app-abc.js"></script>"#)
            .expect("module script should remain");
        assert!(map_index < module_script_index);
        // Must be the first head child.
        let head_index = output.find("<head>").expect("head should exist");
        assert_eq!(map_index, head_index + "<head>".len());
    }

    #[test]
    fn injects_component_kit_assets_before_main_module_script() {
        let mut env = FrontedEnvironment::default();
        env.additional_environment.insert(
            "API_ROOT_URL".to_string(),
            Value::String("/api/".to_string()),
        );
        let component_kit_assets = vec![ComponentKitAsset {
            name: "example".to_string(),
            directory_path: "/app/component-kits/example".to_string(),
            mount_path: "/public/component-kits/example".to_string(),
            script_path: Some("/public/component-kits/example/index-abc.js".to_string()),
            stylesheet_path: Some("/public/component-kits/example/style.css".to_string()),
        }];
        let input = br#"<!doctype html><html><head></head><body><script type="module" src="/public/common/assets/index.js"></script></body></html>"#;
        let mut output = Vec::new();

        inject_environment_script_tag(input, &mut output, &env, &component_kit_assets, None)
            .expect("html injection should succeed");

        let output = String::from_utf8(output).expect("output should be utf8");
        assert!(output.contains(r#"window.API_ROOT_URL = "/api/";"#));
        assert!(output.contains(
            r#"<link rel="stylesheet" href="/public/component-kits/example/style.css">"#
        ));
        let runtime_script_index = output
            .find(r#"<script type="module" src="/public/common/assets/component-kit-react-runtime.js"></script>"#)
            .expect("runtime script should be injected");
        let kit_script_index = output
            .find(r#"<script type="module" src="/public/component-kits/example/index-abc.js"></script>"#)
            .expect("component kit script should be injected");
        let main_script_index = output
            .find(r#"<script type="module" src="/public/common/assets/index.js"></script>"#)
            .expect("main script should remain");
        assert!(runtime_script_index < kit_script_index);
        assert!(kit_script_index < main_script_index);
    }

    #[test]
    fn injects_component_kit_assets_after_hashed_react_runtime() {
        let component_kit_assets = vec![ComponentKitAsset {
            name: "example".to_string(),
            directory_path: "/app/component-kits/example".to_string(),
            mount_path: "/public/component-kits/example".to_string(),
            script_path: Some("/public/component-kits/example/index-abc.js".to_string()),
            stylesheet_path: None,
        }];
        let input = br#"<!doctype html><html><head><link rel="modulepreload" href="/public/common/assets/component-kit-react-runtime-AbCd1234.js"></head><body><script type="module" src="/public/common/assets/app-abc.js"></script></body></html>"#;
        let mut output = Vec::new();

        inject_environment_script_tag(
            input,
            &mut output,
            &FrontedEnvironment::default(),
            &component_kit_assets,
            None,
        )
        .expect("html injection should succeed");

        let output = String::from_utf8(output).expect("output should be utf8");
        let runtime_script_index = output
            .find(r#"<script type="module" src="/public/common/assets/component-kit-react-runtime-AbCd1234.js"></script>"#)
            .expect("hashed runtime script should be injected");
        let kit_script_index = output
            .find(r#"<script type="module" src="/public/component-kits/example/index-abc.js"></script>"#)
            .expect("component kit script should be injected");
        let main_script_index = output
            .find(r#"<script type="module" src="/public/common/assets/app-abc.js"></script>"#)
            .expect("main script should remain");
        assert!(runtime_script_index < kit_script_index);
        assert!(kit_script_index < main_script_index);
        assert!(!output.contains(LEGACY_COMPONENT_KIT_REACT_RUNTIME_SCRIPT_PATH));
    }

    #[test]
    fn injects_component_kit_scripts_after_react_runtime_when_marker_exists() {
        let component_kit_assets = vec![ComponentKitAsset {
            name: "example".to_string(),
            directory_path: "/app/component-kits/example".to_string(),
            mount_path: "/public/component-kits/example".to_string(),
            script_path: Some("/public/component-kits/example/index-abc.js".to_string()),
            stylesheet_path: None,
        }];
        let input = br#"<!doctype html><html><head></head><body><script type="module" src="/public/common/assets/componentKitReactRuntime.js" data-erato-component-kit-react-runtime></script><script type="module" src="/public/common/assets/index.js"></script></body></html>"#;
        let mut output = Vec::new();

        inject_environment_script_tag(
            input,
            &mut output,
            &FrontedEnvironment::default(),
            &component_kit_assets,
            None,
        )
        .expect("html injection should succeed");

        let output = String::from_utf8(output).expect("output should be utf8");
        let runtime_script_index = output
            .find(r#"<script type="module" src="/public/common/assets/componentKitReactRuntime.js" data-erato-component-kit-react-runtime></script>"#)
            .expect("runtime script should remain");
        let kit_script_index = output
            .find(r#"<script type="module" src="/public/component-kits/example/index-abc.js"></script>"#)
            .expect("component kit script should be injected");
        let main_script_index = output
            .find(r#"<script type="module" src="/public/common/assets/index.js"></script>"#)
            .expect("main script should remain");

        assert!(runtime_script_index < kit_script_index);
        assert!(kit_script_index < main_script_index);
    }

    #[test]
    fn discovers_component_kits_from_root_directory() {
        let tempdir = tempfile::tempdir().expect("tempdir should be created");
        let kit_dir = tempdir.path().join("example");
        std::fs::create_dir(&kit_dir).expect("kit dir should be created");
        std::fs::write(kit_dir.join("index-abc123.js"), "").expect("entrypoint should be written");
        std::fs::write(kit_dir.join("style.css"), "").expect("stylesheet should be written");

        let component_kits = discover_component_kits(
            tempdir
                .path()
                .to_str()
                .expect("tempdir path should be unicode"),
        );

        assert_eq!(
            component_kits,
            vec![ComponentKitAsset {
                name: "example".to_string(),
                directory_path: kit_dir.to_string_lossy().into_owned(),
                mount_path: "/public/component-kits/example".to_string(),
                script_path: Some("/public/component-kits/example/index-abc123.js".to_string()),
                stylesheet_path: Some("/public/component-kits/example/style.css".to_string()),
            }]
        );
    }

    #[test]
    fn i18n_messages_json_is_detected_by_path() {
        assert!(is_i18n_messages_json("/public/locales/en/messages.json"));
        assert!(is_i18n_messages_json(
            "/public/common/locales/de/messages.json"
        ));
        assert!(is_i18n_messages_json(
            "/public/custom-theme/example/locales/fr/messages.json"
        ));
        assert!(is_i18n_messages_json(
            "/public/component-kits/example/locales/en/messages.json"
        ));
        assert!(!is_i18n_messages_json("/assets/app.js"));
        assert!(!is_i18n_messages_json("/public/locales/en/readme.txt"));
    }

    #[test]
    fn translation_po_path_maps_messages_json_inside_bundle() {
        let tempdir = tempfile::tempdir().expect("tempdir should be created");
        let locale_dir = tempdir.path().join("public/common/locales/de");
        std::fs::create_dir_all(&locale_dir).expect("locale dir should be created");
        let po_path = locale_dir.join("messages.po");
        std::fs::write(&po_path, "").expect("po file should be written");

        assert_eq!(
            translation_po_path_for_messages_json(
                tempdir.path(),
                "/public/common/locales/de/messages.json"
            ),
            Some(po_path)
        );
        assert_eq!(
            translation_po_path_for_messages_json(
                tempdir.path(),
                "/public/common/locales/de/readme.json"
            ),
            None
        );
        assert_eq!(
            translation_po_path_for_messages_json(
                tempdir.path(),
                "/public/common/locales/../messages.json"
            ),
            None
        );
    }

    #[test]
    fn deployment_version_etag_for_jit_i18n_messages_json_uses_runtime_cache_buster() {
        let deployment_version =
            DeploymentVersion(Some("deployment-123".to_string()), "abcdef".to_string());

        assert_eq!(
            deployment_version
                .etag_value_for_path(
                    "/public/common/locales/de/messages.json",
                    TranslationPoCompilationMode::JustInTime
                )
                .as_deref(),
            Some("\"deployment-123-abcdef\"")
        );
        assert_eq!(
            deployment_version
                .etag_value_for_path(
                    "/public/common/locales/de/messages.json",
                    TranslationPoCompilationMode::Precompiled
                )
                .as_deref(),
            Some("\"deployment-123\"")
        );
        assert_eq!(
            deployment_version
                .etag_value_for_path(
                    "/public/common/assets/index.js",
                    TranslationPoCompilationMode::JustInTime
                )
                .as_deref(),
            Some("\"deployment-123\"")
        );
    }
}
