//! Discovery and layout of optional component-kit bundles.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub const COMPONENT_KITS_PUBLIC_MOUNT_BASE: &str = "/public/component-kits";

/// One component-kit bundle and the assets that host frontends must load.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ComponentKit {
    pub name: String,
    pub root: PathBuf,
    pub mount_path: String,
    pub script_path: Option<String>,
    pub stylesheet_path: Option<String>,
}

/// The component-kit part of an Erato distribution.
#[derive(Clone, Debug)]
pub struct ComponentKitDistribution {
    root: PathBuf,
    kits: Vec<ComponentKit>,
}

impl ComponentKitDistribution {
    #[must_use]
    pub fn discover(root: impl Into<PathBuf>) -> Self {
        let root = root.into();
        let kits = discover_component_kits(&root);
        Self { root, kits }
    }

    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    #[must_use]
    pub fn kits(&self) -> &[ComponentKit] {
        &self.kits
    }
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
        if entry.file_type()?.is_file() {
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

fn discover_component_kits(root: &Path) -> Vec<ComponentKit> {
    if !root.exists() {
        tracing::debug!(
            component_kits_directory = %root.display(),
            "Component kits directory does not exist; no component kits loaded"
        );
        return Vec::new();
    }

    let mut directories = match fs::read_dir(root) {
        Ok(entries) => entries
            .filter_map(|entry| match entry {
                Ok(entry) => Some(entry),
                Err(error) => {
                    tracing::warn!(
                        component_kits_directory = %root.display(),
                        %error,
                        "Failed to read component kit directory entry"
                    );
                    None
                }
            })
            .filter_map(|entry| match entry.file_type() {
                Ok(file_type) if file_type.is_dir() => Some(entry.path()),
                Ok(_) => None,
                Err(error) => {
                    tracing::warn!(
                        component_kit_path = %entry.path().display(),
                        %error,
                        "Failed to inspect component kit directory entry"
                    );
                    None
                }
            })
            .collect::<Vec<_>>(),
        Err(error) => {
            tracing::warn!(
                component_kits_directory = %root.display(),
                %error,
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
                Err(error) => {
                    tracing::warn!(
                        component_kit = %name,
                        component_kit_path = %directory.display(),
                        %error,
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
                Err(error) => {
                    tracing::warn!(
                        component_kit = %name,
                        component_kit_path = %directory.display(),
                        %error,
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

            Some(ComponentKit {
                name,
                root: directory,
                mount_path,
                script_path,
                stylesheet_path,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovers_component_kits_from_root_directory() {
        let tempdir = tempfile::tempdir().expect("tempdir should be created");
        let kit_dir = tempdir.path().join("example");
        fs::create_dir(&kit_dir).expect("kit dir should be created");
        fs::write(kit_dir.join("index-abc123.js"), "").expect("entrypoint should be written");
        fs::write(kit_dir.join("style.css"), "").expect("stylesheet should be written");

        let distribution = ComponentKitDistribution::discover(tempdir.path().to_path_buf());

        assert_eq!(
            distribution.kits(),
            &[ComponentKit {
                name: "example".to_string(),
                root: kit_dir,
                mount_path: "/public/component-kits/example".to_string(),
                script_path: Some("/public/component-kits/example/index-abc123.js".to_string()),
                stylesheet_path: Some("/public/component-kits/example/style.css".to_string()),
            }]
        );
    }
}
