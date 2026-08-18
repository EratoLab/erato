//! Translation catalogs that are part of the served distribution.

use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::config::{AppConfig, ConfigSourceFile, TranslationPoCompilationMode};
use crate::distribution::component_kits::ComponentKitDistribution;
use crate::distribution::frontend_bundles::FrontendBundles;
use crate::translation_po::TranslationPoCache;

/// Translation sources and runtime compilation state shared by all served
/// bundles.
#[derive(Clone, Debug)]
pub struct TranslationDistribution {
    sources: Vec<ConfigSourceFile>,
    compilation_mode: TranslationPoCompilationMode,
    cache: Arc<TranslationPoCache>,
}

impl TranslationDistribution {
    #[must_use]
    pub fn discover(
        config: &AppConfig,
        frontend_bundles: &FrontendBundles,
        component_kits: &ComponentKitDistribution,
    ) -> Self {
        let mut roots = vec![
            (
                "core frontend translations",
                frontend_bundles.main.root().join("public/common/locales"),
            ),
            // Older local and development bundles put locales directly below
            // the main bundle root.
            (
                "core frontend translations (legacy)",
                frontend_bundles.main.root().join("locales"),
            ),
        ];

        if let Some(theme) = config.frontend.theme.as_deref() {
            roots.push((
                "active shared theme",
                frontend_bundles
                    .main
                    .root()
                    .join("public/common/custom-theme")
                    .join(theme),
            ));
            roots.push((
                "active runtime theme",
                frontend_bundles
                    .main
                    .root()
                    .join("custom-theme")
                    .join(theme),
            ));
        }

        if frontend_bundles.office_addin.enabled() {
            roots.push((
                "Office add-in translations",
                frontend_bundles.office_addin.root().join("locales"),
            ));
            if let Some(theme) = config.frontend.theme.as_deref() {
                roots.push((
                    "active Office add-in theme",
                    frontend_bundles
                        .office_addin
                        .root()
                        .join("custom-theme")
                        .join(theme),
                ));
            }
        }

        roots.extend(
            component_kits
                .kits()
                .iter()
                .map(|kit| ("component kit", kit.root.clone())),
        );

        let sources = discover_sources(roots);
        Self {
            sources,
            compilation_mode: config.frontend.translation_po_compilation_mode,
            cache: Arc::new(TranslationPoCache::new(
                config.i18n.language.default_language.clone(),
            )),
        }
    }

    #[must_use]
    pub fn sources(&self) -> &[ConfigSourceFile] {
        &self.sources
    }

    #[must_use]
    pub fn compilation_mode(&self) -> TranslationPoCompilationMode {
        self.compilation_mode
    }

    /// Compiles the PO source corresponding to a served `messages.json`
    /// request. `None` means the request is not a JIT translation artifact.
    pub fn compile_messages_json_for_request(
        &self,
        bundle_root: &Path,
        request_path: &str,
    ) -> Option<(PathBuf, io::Result<Vec<u8>>)> {
        if self.compilation_mode != TranslationPoCompilationMode::JustInTime {
            return None;
        }
        let po_path = translation_po_path_for_messages_json(bundle_root, request_path)?;
        let compiled = self.cache.compile_messages_json(&po_path);
        Some((po_path, compiled))
    }

    #[must_use]
    pub fn is_messages_json_path(path: &str) -> bool {
        path.ends_with("/messages.json") && path.contains("/locales/")
    }
}

fn safe_request_file_path(bundle_root: &Path, request_path: &str) -> Option<PathBuf> {
    let mut file_path = bundle_root.to_path_buf();
    for segment in request_path.trim_start_matches('/').split('/') {
        if segment.is_empty() || segment == "." || segment == ".." {
            return None;
        }
        file_path.push(segment);
    }
    Some(file_path)
}

fn translation_po_path_for_messages_json(
    bundle_root: &Path,
    request_path: &str,
) -> Option<PathBuf> {
    if !TranslationDistribution::is_messages_json_path(request_path) {
        return None;
    }

    let mut file_path = safe_request_file_path(bundle_root, request_path)?;
    file_path.set_extension("po");
    file_path.exists().then_some(file_path)
}

fn discover_sources(roots: Vec<(&'static str, PathBuf)>) -> Vec<ConfigSourceFile> {
    let mut sources = Vec::new();
    let mut seen = HashSet::new();
    tracing::debug!(
        root_count = roots.len(),
        "Scanning distribution roots for translation PO catalogs"
    );
    for (root_kind, root) in roots {
        let source_count_before = sources.len();
        tracing::debug!(
            root_kind,
            root = %root.display(),
            exists = root.exists(),
            "Scanning distribution translation PO source root"
        );
        collect_translation_po_sources(&root, &mut seen, &mut sources);
        tracing::debug!(
            root_kind,
            root = %root.display(),
            discovered = sources.len() - source_count_before,
            "Finished scanning distribution translation PO source root"
        );
    }
    sources.sort_by(|left, right| left.source_filename.cmp(&right.source_filename));
    sources
}

fn collect_translation_po_sources(
    directory: &Path,
    seen: &mut HashSet<PathBuf>,
    sources: &mut Vec<ConfigSourceFile>,
) {
    let mut entries = match fs::read_dir(directory) {
        Ok(entries) => entries.flatten().collect::<Vec<_>>(),
        Err(error) if error.kind() == io::ErrorKind::NotFound => return,
        Err(error) => {
            tracing::warn!(
                directory = %directory.display(),
                %error,
                "Failed to scan distribution directory for translation PO catalogs"
            );
            return;
        }
    };
    entries.sort_by_key(|entry| entry.path());

    for entry in entries {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            collect_translation_po_sources(&path, seen, sources);
            continue;
        }

        if !file_type.is_file()
            || path.file_name().and_then(|name| name.to_str()) != Some("messages.po")
            || path
                .parent()
                .and_then(|locale| locale.parent())
                .and_then(|locales| locales.file_name())
                != Some(std::ffi::OsStr::new("locales"))
        {
            continue;
        }

        let canonical_path = path.canonicalize().unwrap_or(path);
        if !seen.insert(canonical_path.clone()) {
            continue;
        }
        tracing::debug!(
            source_filename = %canonical_path.display(),
            "Found frontend translation PO catalog"
        );
        match fs::read_to_string(&canonical_path) {
            Ok(contents) => sources.push(ConfigSourceFile {
                source_filename: canonical_path.to_string_lossy().into_owned(),
                contents,
            }),
            Err(error) => tracing::warn!(
                source_filename = %canonical_path.display(),
                %error,
                "Failed to read distribution translation PO catalog"
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovers_catalogs_from_every_served_distribution() {
        let tempdir = tempfile::tempdir().expect("tempdir should be created");
        let web_root = tempdir.path().join("web");
        let addin_root = tempdir.path().join("addin");
        let kits_root = tempdir.path().join("kits");
        let write_catalog = |root: &Path, relative: &str, contents: &str| {
            let po_path = root.join(relative).join("messages.po");
            fs::create_dir_all(po_path.parent().unwrap()).unwrap();
            fs::write(&po_path, contents).unwrap();
            fs::write(po_path.with_extension("json"), "{\"messages\":{}}").unwrap();
        };

        write_catalog(&web_root, "public/common/locales/en", "web-en");
        write_catalog(
            &web_root,
            "public/common/custom-theme/acme/locales/de",
            "theme-de",
        );
        write_catalog(
            &web_root,
            "custom-theme/acme/locales/fr",
            "runtime-theme-fr",
        );
        write_catalog(
            &web_root,
            "public/common/custom-theme/unused/locales/de",
            "unused-theme-de",
        );
        let uncompiled = web_root.join("public/common/locales/fr/messages.po");
        fs::create_dir_all(uncompiled.parent().unwrap()).unwrap();
        fs::write(uncompiled, "not-served").unwrap();
        write_catalog(&addin_root, "locales/pl", "addin-pl");
        let kit_root = kits_root.join("example");
        fs::create_dir_all(&kit_root).unwrap();
        fs::write(kit_root.join("index-example.js"), "").unwrap();
        write_catalog(&kit_root, "locales/es", "kit-es");

        let mut config = AppConfig::default();
        config.frontend.web_frontend_bundle_path = web_root.to_string_lossy().into_owned();
        config.frontend.theme = Some("acme".to_string());
        config.integrations.ms_office.addin.enabled = true;
        config.integrations.ms_office.addin.frontend_bundle_path =
            addin_root.to_string_lossy().into_owned();
        config.frontend.component_kits.directory = kits_root.to_string_lossy().into_owned();

        let bundles = FrontendBundles::from_config(&config);
        let kits = ComponentKitDistribution::discover(kits_root);
        let translations = TranslationDistribution::discover(&config, &bundles, &kits);

        assert_eq!(translations.sources().len(), 6);
        for expected in [
            "web-en",
            "theme-de",
            "runtime-theme-fr",
            "addin-pl",
            "kit-es",
        ] {
            assert!(
                translations
                    .sources()
                    .iter()
                    .any(|source| source.contents == expected)
            );
        }
        assert!(
            translations
                .sources()
                .iter()
                .all(|source| !source.contents.contains("unused-theme-de"))
        );
        assert!(
            translations
                .sources()
                .iter()
                .any(|source| source.contents == "not-served")
        );
    }

    #[test]
    fn identifies_messages_json_paths() {
        assert!(TranslationDistribution::is_messages_json_path(
            "/public/common/locales/de/messages.json"
        ));
        assert!(TranslationDistribution::is_messages_json_path(
            "/public/component-kits/example/locales/en/messages.json"
        ));
        assert!(!TranslationDistribution::is_messages_json_path(
            "/public/locales/en/readme.txt"
        ));
    }

    #[test]
    fn maps_messages_json_to_a_safe_po_path() {
        let tempdir = tempfile::tempdir().expect("tempdir should be created");
        let locale_dir = tempdir.path().join("public/common/locales/de");
        fs::create_dir_all(&locale_dir).expect("locale dir should be created");
        let po_path = locale_dir.join("messages.po");
        fs::write(&po_path, "").expect("po file should be written");

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
                "/public/common/locales/../messages.json"
            ),
            None
        );
    }
}
