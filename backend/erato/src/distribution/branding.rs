//! Local branding sources, separate from stable browser URLs and package names.

use std::path::{Component, Path, PathBuf};

use eyre::{Result, ensure};

use super::frontend_bundles::{
    FrontendBundles, OFFICE_ADDIN_LEGACY_MOUNT_PATH, OFFICE_ADDIN_MOUNT_PATH,
};
use crate::config::AppConfig;

#[derive(Clone, Debug, erato_memory::HeapSize)]
pub struct BrandingAssets {
    frontend: erato_config::config::FrontendConfig,
    addin: erato_config::config::MsOfficeAddinConfig,
    teams_manifest: erato_config::config::MsOfficeTeamsManifestConfig,
    bundles: FrontendBundles,
}

impl BrandingAssets {
    pub fn from_config(config: &AppConfig) -> Self {
        Self {
            frontend: config.frontend.clone(),
            addin: config.integrations.ms_office.addin.clone(),
            teams_manifest: config.integrations.ms_office.teams.manifest.clone(),
            bundles: FrontendBundles::from_config(config),
        }
    }

    fn theme_roots(&self, office: bool) -> Vec<PathBuf> {
        let Some(theme) = self.frontend.theme.as_deref() else {
            return Vec::new();
        };
        if !safe_relative_path(theme) {
            return Vec::new();
        }
        let mut roots = Vec::new();
        if office {
            roots.push(
                self.bundles
                    .office_addin
                    .root()
                    .join("custom-theme")
                    .join(theme),
            );
        }
        roots.push(self.bundles.main.root().join("custom-theme").join(theme));
        roots.push(
            self.bundles
                .main
                .root()
                .join("public/common/custom-theme")
                .join(theme),
        );
        roots
    }

    /// Only served public roots or paths relative to the selected theme are
    /// accepted. Canonical containment also rejects symlinks escaping a root.
    pub fn resolve_source(&self, source: &str, office: bool) -> Result<PathBuf> {
        let (roots, relative) = if let Some(relative) = source.strip_prefix("/public/common/") {
            (
                vec![
                    self.bundles.main.root().to_path_buf(),
                    self.bundles.main.root().join("public/common"),
                ],
                relative,
            )
        } else if let Some(relative) = source.strip_prefix(&format!("{OFFICE_ADDIN_MOUNT_PATH}/")) {
            (
                vec![self.bundles.office_addin.root().to_path_buf()],
                relative,
            )
        } else if let Some(relative) =
            source.strip_prefix(&format!("{OFFICE_ADDIN_LEGACY_MOUNT_PATH}/"))
        {
            (
                vec![self.bundles.office_addin.root().to_path_buf()],
                relative,
            )
        } else {
            (
                self.theme_roots(office),
                source.strip_prefix("./").unwrap_or(source),
            )
        };
        ensure!(
            safe_relative_path(relative),
            "unsafe branding source path: {source}"
        );
        for root in roots {
            if let Some(path) = contained_file(&root, relative) {
                return Ok(path);
            }
        }
        eyre::bail!("branding source is missing or outside its public root: {source}");
    }

    pub fn icon_source(&self, source: Option<&str>, bundle_relative: &str) -> Result<PathBuf> {
        if let Some(source) = source {
            return self.resolve_source(source, true);
        }
        ensure!(
            safe_relative_path(bundle_relative),
            "unsafe branding icon path: {bundle_relative}"
        );
        // An existing platform file is a real per-asset override. A shared
        // theme supplies the asset when the platform theme does not ship it.
        for root in self.theme_roots(true) {
            for relative in [
                bundle_relative,
                Path::new(bundle_relative)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(bundle_relative),
            ] {
                if let Some(path) = contained_file(&root, relative) {
                    return Ok(path);
                }
            }
        }
        contained_file(self.bundles.office_addin.root(), bundle_relative).ok_or_else(|| {
            eyre::eyre!("Office bundle icon is missing or unsafe: {bundle_relative}")
        })
    }

    pub fn favicon_source(&self, office: bool, filename: &str) -> Result<PathBuf> {
        let configured = if office {
            self.addin
                .favicon_path
                .as_deref()
                .unwrap_or(&self.frontend.favicon_path)
        } else {
            &self.frontend.favicon_path
        };
        if !matches!(configured, "/favicon.svg" | "/favicon.ico") {
            if configured.starts_with('/')
                && !configured.starts_with("/public/")
                && !configured.starts_with("/office-addin/")
            {
                let relative = configured.trim_start_matches('/');
                ensure!(
                    safe_relative_path(relative),
                    "unsafe favicon source path: {configured}"
                );
                return contained_file(self.bundles.main.root(), relative)
                    .ok_or_else(|| eyre::eyre!("favicon source is missing: {configured}"));
            }
            return self.resolve_source(configured, office);
        }
        if office {
            for root in self.theme_roots(true) {
                for name in [
                    filename,
                    if filename == "favicon.svg" {
                        "favicon.ico"
                    } else {
                        "favicon.svg"
                    },
                ] {
                    if let Some(path) = contained_file(&root, name) {
                        return Ok(path);
                    }
                }
            }
        }
        self.bundles
            .main
            .favicon_candidates(self.frontend.theme.as_deref(), filename)
            .into_iter()
            .find(|path| path.is_file())
            .ok_or_else(|| eyre::eyre!("favicon is missing"))
    }

    /// Map both canonical and legacy Office URLs to the same source. Existing
    /// URL configuration remains authoritative; source settings never rewrite it.
    pub fn served_source(&self, request_path: &str) -> Option<Result<PathBuf>> {
        for mount in [OFFICE_ADDIN_MOUNT_PATH, OFFICE_ADDIN_LEGACY_MOUNT_PATH] {
            if let Some(filename @ ("favicon.svg" | "favicon.ico")) =
                request_path.strip_prefix(&format!("{mount}/"))
            {
                return Some(self.favicon_source(true, filename));
            }
        }
        let manifest = &self.addin.manifest;
        let teams = &self.teams_manifest;
        let mut aliases = [
            (&manifest.icon_path, &manifest.icon_source_path),
            (
                &manifest.high_resolution_icon_path,
                &manifest.high_resolution_icon_source_path,
            ),
            (&manifest.icon_16_path, &manifest.icon_16_source_path),
            (&manifest.icon_32_path, &manifest.icon_32_source_path),
            (&manifest.icon_80_path, &manifest.icon_80_source_path),
            (&teams.color_icon, &teams.color_icon_source_path),
            (&teams.outline_icon, &teams.outline_icon_source_path),
            (&teams.small_color_icon, &teams.small_color_icon_source_path),
        ];
        aliases.sort_by_key(|(_, source)| source.is_none());
        for (url, source) in aliases {
            let relative = url
                .strip_prefix(&format!("{OFFICE_ADDIN_MOUNT_PATH}/"))
                .unwrap_or(url);
            let matches = if relative.starts_with('/') {
                request_path == relative
            } else {
                [OFFICE_ADDIN_MOUNT_PATH, OFFICE_ADDIN_LEGACY_MOUNT_PATH]
                    .iter()
                    .any(|mount| request_path == format!("{mount}/{relative}"))
            };
            if matches {
                return Some(if source.is_some() || safe_relative_path(relative) {
                    self.icon_source(source.as_deref(), relative)
                } else {
                    self.resolve_source(relative, true)
                });
            }
        }
        // Runtime theme mounts use root/custom-theme, whereas Vite copies
        // built-in themes under root/public/common/custom-theme. Serve both
        // through the same shared public URL, with the runtime mount first.
        if request_path.starts_with("/public/common/custom-theme/") {
            return Some(self.resolve_source(request_path, false));
        }
        None
    }

    /// The page colour of the web app's theme for light and dark, so the
    /// first HTML already shows it. Mirrors the web app's lookup
    /// (`themeConfig.ts`): the selected theme's `theme.json`, else the unnamed
    /// one beside the themes; none when the deployment points the web app at
    /// another file. A mode the theme leaves alone is missing, and the page
    /// keeps its default for it.
    pub fn start_page_colors(&self) -> Option<serde_json::Map<String, serde_json::Value>> {
        let overridden = |key| {
            self.frontend
                .additional_environment
                .get(key)
                .is_some_and(|value| value.as_str() != Some(""))
        };
        if overridden("THEME_CONFIG_PATH") || overridden("THEME_PATH") {
            return None;
        }
        let named = self
            .frontend
            .theme
            .as_deref()
            .map(|theme| format!("/public/common/custom-theme/{theme}/theme.json"));
        let path = named
            .iter()
            .map(String::as_str)
            .chain(["/public/common/custom-theme/theme.json"])
            .find_map(|source| self.resolve_source(source, false).ok())?;
        let theme: serde_json::Value = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
        let colors: serde_json::Map<_, _> = ["light", "dark"]
            .into_iter()
            .filter_map(|mode| {
                let colors = &theme["theme"][mode]["colors"];
                // The web app falls back the same way when `shell.page` is unset
                // (`withLegacyColorCompatibility` in `themeUtils.ts`).
                [&colors["shell"]["page"], &colors["background"]["secondary"]]
                    .into_iter()
                    .find_map(serde_json::Value::as_str)
                    .map(|color| (mode.to_string(), color.into()))
            })
            .collect();
        (!colors.is_empty()).then_some(colors)
    }

    /// Languages the selected theme ships a catalog for, so the web app asks
    /// only for those. `None` without a theme.
    pub fn theme_translation_locales(&self) -> Option<Vec<String>> {
        self.frontend.theme.as_ref()?;
        let mut locales: Vec<String> = self
            .theme_roots(false)
            .iter()
            .filter_map(|root| std::fs::read_dir(root.join("locales")).ok())
            .flatten()
            .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
            .filter(|locale| {
                safe_relative_path(locale)
                    && ["messages.po", "messages.json"].iter().any(|file| {
                        self.theme_roots(false).iter().any(|root| {
                            contained_file(root, &format!("locales/{locale}/{file}")).is_some()
                        })
                    })
            })
            .collect();
        locales.sort();
        locales.dedup();
        Some(locales)
    }
}

fn safe_relative_path(path: &str) -> bool {
    !path.is_empty()
        && !path.contains(['\\', ':', '%', '?', '#'])
        && path
            .split('/')
            .all(|part| !part.is_empty() && !matches!(part, "." | ".."))
        && Path::new(path)
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
}

fn contained_file(root: &Path, relative: &str) -> Option<PathBuf> {
    let root = root.canonicalize().ok()?;
    let path = root.join(relative).canonicalize().ok()?;
    (path.starts_with(root) && path.is_file()).then_some(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (tempfile::TempDir, AppConfig) {
        let dir = tempfile::tempdir().unwrap();
        let mut config = AppConfig::default();
        config.frontend.web_frontend_bundle_path = dir.path().join("web").display().to_string();
        config.integrations.ms_office.addin.frontend_bundle_path =
            dir.path().join("office").display().to_string();
        config.frontend.theme = Some("acme".into());
        std::fs::create_dir_all(dir.path().join("web/custom-theme/acme")).unwrap();
        std::fs::create_dir_all(dir.path().join("office/assets")).unwrap();
        (dir, config)
    }

    #[test]
    fn start_page_colors_follow_the_web_apps_theme_lookup() {
        let (dir, mut config) = fixture();
        let write = |path: &str, json: &str| {
            let path = dir.path().join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, json).unwrap();
        };
        // Missing theme.json: no colours, the page keeps its defaults.
        assert_eq!(
            BrandingAssets::from_config(&config).start_page_colors(),
            None
        );

        write(
            "web/custom-theme/acme/theme.json",
            r##"{"theme":{"light":{"colors":{"shell":{"page":"#fafafa"},"background":{"secondary":"#eee"}}},
                "dark":{"colors":{"background":{"secondary":"rgb(1, 2, 3)"}}}}}"##,
        );
        let colors = BrandingAssets::from_config(&config)
            .start_page_colors()
            .unwrap();
        assert_eq!(colors["light"], "#fafafa");
        assert_eq!(colors["dark"], "rgb(1, 2, 3)");

        // The web app loads another theme.json then; the server does not guess it.
        config
            .frontend
            .additional_environment
            .insert("THEME_CONFIG_PATH".into(), "/brand/theme.json".into());
        assert_eq!(
            BrandingAssets::from_config(&config).start_page_colors(),
            None
        );
        config.frontend.additional_environment.clear();

        // Without a selected theme, the unnamed theme beside the themes counts.
        config.frontend.theme = None;
        write(
            "web/custom-theme/theme.json",
            r##"{"theme":{"dark":{"colors":{"shell":{"page":"#000"}}}}}"##,
        );
        let colors = BrandingAssets::from_config(&config)
            .start_page_colors()
            .unwrap();
        assert_eq!(colors.get("light"), None);
        assert_eq!(colors["dark"], "#000");
    }

    #[test]
    fn theme_translation_locales_list_the_catalogs_a_theme_ships() {
        let (dir, mut config) = fixture();
        let runtime = dir.path().join("web/custom-theme/acme/locales");
        let built = dir
            .path()
            .join("web/public/common/custom-theme/acme/locales");
        for (root, locale, file) in [
            (&runtime, "de", Some("messages.po")),
            (&built, "fr", Some("messages.json")),
            (&built, "de", Some("messages.json")),
            (&runtime, "es", None),
        ] {
            std::fs::create_dir_all(root.join(locale)).unwrap();
            if let Some(file) = file {
                std::fs::write(root.join(locale).join(file), "").unwrap();
            }
        }
        assert_eq!(
            BrandingAssets::from_config(&config).theme_translation_locales(),
            Some(vec!["de".to_string(), "fr".to_string()])
        );
        config.frontend.theme = None;
        assert_eq!(
            BrandingAssets::from_config(&config).theme_translation_locales(),
            None
        );
    }

    #[test]
    fn shared_public_urls_prefer_runtime_mounts_and_fall_back_to_built_theme_files() {
        let (dir, config) = fixture();
        let packaged = dir.path().join("web/public/common/custom-theme/acme");
        std::fs::create_dir_all(&packaged).unwrap();
        std::fs::write(packaged.join("theme.json"), b"built").unwrap();
        let url = "/public/common/custom-theme/acme/theme.json";
        let assets = BrandingAssets::from_config(&config);
        assert_eq!(
            std::fs::read(assets.served_source(url).unwrap().unwrap()).unwrap(),
            b"built"
        );
        std::fs::write(
            dir.path().join("web/custom-theme/acme/theme.json"),
            b"runtime",
        )
        .unwrap();
        assert_eq!(
            std::fs::read(assets.served_source(url).unwrap().unwrap()).unwrap(),
            b"runtime"
        );
        assert!(
            assets
                .served_source("/public/common/custom-theme/acme/missing.svg")
                .unwrap()
                .is_err()
        );
    }

    #[test]
    fn shared_icons_keep_canonical_and_legacy_urls_and_explicit_sources_win() {
        let (dir, mut config) = fixture();
        let shared = dir
            .path()
            .join("web/custom-theme/acme/color-icon-192x192.png");
        std::fs::write(&shared, b"shared").unwrap();
        let path = "/public/platform-office-addin/assets/color-icon-192x192.png";
        let legacy = "/office-addin/assets/color-icon-192x192.png";
        for url in [path, legacy] {
            assert_eq!(
                BrandingAssets::from_config(&config)
                    .served_source(url)
                    .unwrap()
                    .unwrap(),
                shared.canonicalize().unwrap()
            );
        }
        let platform = dir.path().join("office/custom-theme/acme");
        std::fs::create_dir_all(&platform).unwrap();
        std::fs::write(platform.join("color-icon-192x192.png"), b"platform").unwrap();
        assert_eq!(
            std::fs::read(
                BrandingAssets::from_config(&config)
                    .served_source(path)
                    .unwrap()
                    .unwrap()
            )
            .unwrap(),
            b"platform"
        );
        std::fs::write(
            dir.path().join("web/custom-theme/acme/override.png"),
            b"override",
        )
        .unwrap();
        config
            .integrations
            .ms_office
            .teams
            .manifest
            .color_icon_source_path = Some("/public/common/custom-theme/acme/override.png".into());
        for url in [path, legacy] {
            assert_eq!(
                std::fs::read(
                    BrandingAssets::from_config(&config)
                        .served_source(url)
                        .unwrap()
                        .unwrap()
                )
                .unwrap(),
                b"override"
            );
        }
    }

    #[test]
    fn favicon_inheritance_and_override_apply_to_both_extensions_and_mounts() {
        let (dir, mut config) = fixture();
        std::fs::write(dir.path().join("web/custom-theme/acme/favicon.ico"), b"ico").unwrap();
        for name in ["favicon.ico", "favicon.svg"] {
            assert_eq!(
                std::fs::read(
                    BrandingAssets::from_config(&config)
                        .favicon_source(false, name)
                        .unwrap()
                )
                .unwrap(),
                b"ico"
            );
        }
        std::fs::write(dir.path().join("web/custom-theme/acme/web.png"), b"web").unwrap();
        config.frontend.favicon_path = "/public/common/custom-theme/acme/web.png".into();
        assert_eq!(
            std::fs::read(
                BrandingAssets::from_config(&config)
                    .favicon_source(true, "favicon.svg")
                    .unwrap()
            )
            .unwrap(),
            b"web"
        );
        std::fs::write(
            dir.path().join("web/custom-theme/acme/office.png"),
            b"office",
        )
        .unwrap();
        config.integrations.ms_office.addin.favicon_path = Some("./office.png".into());
        for mount in [OFFICE_ADDIN_MOUNT_PATH, OFFICE_ADDIN_LEGACY_MOUNT_PATH] {
            for name in ["favicon.ico", "favicon.svg"] {
                assert_eq!(
                    std::fs::read(
                        BrandingAssets::from_config(&config)
                            .served_source(&format!("{mount}/{name}"))
                            .unwrap()
                            .unwrap()
                    )
                    .unwrap(),
                    b"office"
                );
            }
        }
    }

    #[test]
    fn rejects_traversal_remote_urls_and_sources_outside_public_roots() {
        let (dir, config) = fixture();
        let branding = BrandingAssets::from_config(&config);
        for source in [
            "../secret",
            "/etc/passwd",
            "https://example.com/icon.png",
            "a\\b",
            "a/../b",
            "a/./b",
            "/public/common/../secret",
            "/public/common/%2e%2e/secret",
            "//example.com/icon.png",
        ] {
            assert!(branding.resolve_source(source, true).is_err(), "{source}");
        }
        std::fs::write(dir.path().join("secret"), b"secret").unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(
                dir.path().join("secret"),
                dir.path().join("web/custom-theme/acme/escape.png"),
            )
            .unwrap();
            assert!(branding.resolve_source("escape.png", true).is_err());
            assert!(
                branding
                    .resolve_source("/public/common/custom-theme/acme/escape.png", true)
                    .is_err()
            );
        }
    }
}
