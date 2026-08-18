//! Concrete descriptions of the frontend bundles shipped with Erato.
//!
//! This module owns bundle layout and build-manifest discovery. HTTP serving
//! code consumes these descriptions instead of reconstructing paths from
//! configuration values.

use std::fs;
use std::path::{Path, PathBuf};

use crate::config::AppConfig;
use serde::Deserialize;

pub const MAIN_FRONTEND_MOUNT_PATH: &str = "/";
pub const OFFICE_ADDIN_MOUNT_PATH: &str = "/public/platform-office-addin";
pub const OFFICE_ADDIN_LEGACY_MOUNT_PATH: &str = "/office-addin";

const IMPORT_MAP_MANIFEST_FILE_NAME: &str = "import-map.manifest.json";
const SERVER_CONFIG_FILE_NAME: &str = "serve.json";

/// The browser application bundle and its stable public layout.
#[derive(Clone, Debug)]
pub struct MainFrontendBundle {
    root: PathBuf,
    import_map_json: Option<String>,
    rewrites: Vec<FrontendRewrite>,
}

/// The Outlook/Office application bundle and its serving configuration.
#[derive(Clone, Debug)]
pub struct OfficeAddinFrontendBundle {
    root: PathBuf,
    enabled: bool,
    serve_legacy_path: bool,
    import_map_json: Option<String>,
    rewrites: Vec<FrontendRewrite>,
}

/// One SPA rewrite declared by a frontend bundle's `serve.json` file.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct FrontendRewrite {
    source: String,
    destination: String,
}

#[derive(Debug, Deserialize)]
struct FrontendServerConfig {
    rewrites: Vec<FrontendRewrite>,
}

/// All frontend bundles available in the application distribution.
#[derive(Clone, Debug)]
pub struct FrontendBundles {
    pub main: MainFrontendBundle,
    pub office_addin: OfficeAddinFrontendBundle,
}

impl FrontendBundles {
    #[must_use]
    pub fn from_config(config: &AppConfig) -> Self {
        let main_root = PathBuf::from(&config.frontend.web_frontend_bundle_path);
        let office_addin_root =
            PathBuf::from(&config.integrations.ms_office.addin.frontend_bundle_path);

        Self {
            main: MainFrontendBundle {
                import_map_json: load_import_map_json(&main_root, MAIN_FRONTEND_MOUNT_PATH),
                rewrites: load_rewrites(&main_root),
                root: main_root,
            },
            office_addin: OfficeAddinFrontendBundle {
                import_map_json: load_import_map_json(&office_addin_root, OFFICE_ADDIN_MOUNT_PATH),
                rewrites: load_rewrites(&office_addin_root),
                root: office_addin_root,
                enabled: config.integrations.ms_office.addin.enabled,
                serve_legacy_path: config.integrations.ms_office.addin.serve_bundle_legacy_path,
            },
        }
    }
}

impl MainFrontendBundle {
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    #[must_use]
    pub fn import_map_json(&self) -> Option<&str> {
        self.import_map_json.as_deref()
    }

    #[must_use]
    pub fn rewrites(&self) -> &[FrontendRewrite] {
        &self.rewrites
    }

    /// Candidate favicon paths in distribution precedence order.
    #[must_use]
    pub fn favicon_candidates(&self, theme: Option<&str>, file_name: &str) -> Vec<PathBuf> {
        let theme_favicon_names = match file_name {
            "favicon.ico" => ["favicon.ico", "favicon.svg"],
            "favicon.svg" => ["favicon.svg", "favicon.ico"],
            _ => [file_name, file_name],
        };
        let mut candidates = Vec::new();

        if let Some(theme) = theme {
            for favicon_name in theme_favicon_names {
                candidates.push(
                    self.root
                        .join("custom-theme")
                        .join(theme)
                        .join(favicon_name),
                );
                candidates.push(
                    self.root
                        .join("public/common/custom-theme")
                        .join(theme)
                        .join(favicon_name),
                );
            }
        }

        candidates.push(self.root.join(file_name));
        candidates.push(self.root.join("public").join(file_name));
        candidates
    }
}

impl OfficeAddinFrontendBundle {
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    #[must_use]
    pub fn enabled(&self) -> bool {
        self.enabled
    }

    #[must_use]
    pub fn serve_legacy_path(&self) -> bool {
        self.serve_legacy_path
    }

    #[must_use]
    pub fn import_map_json(&self) -> Option<&str> {
        self.import_map_json.as_deref()
    }

    #[must_use]
    pub fn rewrites(&self) -> &[FrontendRewrite] {
        &self.rewrites
    }

    /// Returns a manifest path within this bundle. The caller supplies only a
    /// fixed, application-owned file name.
    #[must_use]
    pub fn manifest_path(&self, file_name: &str) -> PathBuf {
        self.root.join(file_name)
    }
}

impl FrontendRewrite {
    /// Returns the bundle-relative destination when this rewrite matches a
    /// request path. Requests that look like files are never rewritten.
    #[must_use]
    pub fn destination_for(&self, request_path: &str) -> Option<&str> {
        if Path::new(request_path)
            .extension()
            .is_some_and(|extension| !extension.is_empty())
        {
            return None;
        }

        let pattern_parts = self.source.split('/').collect::<Vec<_>>();
        let path_parts = request_path.split('/').collect::<Vec<_>>();
        if pattern_parts.len() != path_parts.len() {
            return None;
        }
        pattern_parts
            .iter()
            .zip(path_parts.iter())
            .all(|(pattern, path_part)| pattern.starts_with(':') || pattern == path_part)
            .then_some(self.destination.as_str())
    }
}

fn load_rewrites(bundle_root: &Path) -> Vec<FrontendRewrite> {
    let config_path = bundle_root.join(SERVER_CONFIG_FILE_NAME);
    let contents = match fs::read_to_string(&config_path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Vec::new(),
        Err(error) => {
            tracing::warn!(
                config_path = %config_path.display(),
                %error,
                "Failed to read frontend serve configuration; no rewrites will be applied"
            );
            return Vec::new();
        }
    };

    match serde_json::from_str::<FrontendServerConfig>(&contents) {
        Ok(config) => config.rewrites,
        Err(error) => {
            tracing::warn!(
                config_path = %config_path.display(),
                %error,
                "Failed to parse frontend serve configuration; no rewrites will be applied"
            );
            Vec::new()
        }
    }
}

/// Loads the shared-module import map emitted by a frontend build. Missing or
/// invalid manifests are tolerated so older bundles remain serveable.
fn load_import_map_json(bundle_root: &Path, mount_path: &str) -> Option<String> {
    let manifest_path = bundle_root.join(IMPORT_MAP_MANIFEST_FILE_NAME);
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
        Ok(manifest) => match manifest
            .get("imports")
            .and_then(|imports| imports.as_object())
        {
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

/// Converts bundle-relative manifest entries to their public URLs. Absolute
/// entries pass through unchanged.
fn serialize_import_map(
    imports: &serde_json::Map<String, serde_json::Value>,
    mount_path: &str,
) -> String {
    let mount_prefix = mount_path.trim_end_matches('/');
    let prefixed = imports
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
        .collect::<serde_json::Map<_, _>>();
    serde_json::json!({ "imports": prefixed }).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn import_map_entries_are_mounted_below_the_bundle() {
        let manifest = serde_json::json!({
            "react": "assets/react.js",
            "absolute": "/shared/absolute.js"
        });
        let imports = manifest.as_object().unwrap();

        let serialized: serde_json::Value =
            serde_json::from_str(&serialize_import_map(imports, OFFICE_ADDIN_MOUNT_PATH)).unwrap();

        assert_eq!(
            serialized["imports"]["react"],
            "/public/platform-office-addin/assets/react.js"
        );
        assert_eq!(serialized["imports"]["absolute"], "/shared/absolute.js");
    }

    #[test]
    fn rewrites_match_dynamic_routes_but_not_asset_paths() {
        let rewrite = FrontendRewrite {
            source: "/chat/:id".to_string(),
            destination: "index.html".to_string(),
        };

        assert_eq!(
            rewrite.destination_for("/chat/some-chat"),
            Some("index.html")
        );
        assert_eq!(rewrite.destination_for("/chat/missing.js"), None);
    }
}
