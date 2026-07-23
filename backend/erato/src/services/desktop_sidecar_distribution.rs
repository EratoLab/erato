use std::collections::HashSet;
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use eyre::{Context, Result, bail, ensure};
use serde::Deserialize;

const MANIFEST_FILE_NAME: &str = "manifest.json";

#[derive(Clone, Debug)]
pub struct DesktopSidecarDistribution {
    targets: Vec<DistributionTarget>,
}

#[derive(Clone, Debug)]
pub struct DistributionTarget {
    pub id: String,
    pub platform: DistributionPlatform,
    pub default_file: String,
    pub files: Vec<DistributionArtifact>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct DistributionPlatform {
    pub os: String,
    pub architecture: String,
    pub abi: String,
}

#[derive(Clone, Debug)]
pub struct DistributionArtifact {
    pub id: String,
    pub kind: String,
    pub download_filename: String,
    pub media_type: String,
    pub size: u64,
    source: Arc<File>,
}

#[derive(Debug, Deserialize)]
struct DistributionManifest {
    targets: Vec<ManifestTarget>,
}

#[derive(Debug, Deserialize)]
struct ManifestTarget {
    id: String,
    platform: DistributionPlatform,
    default_file: String,
    files: Vec<ManifestArtifact>,
}

#[derive(Debug, Deserialize)]
struct ManifestArtifact {
    id: String,
    kind: String,
    path: String,
    download_filename: String,
    media_type: String,
}

impl DesktopSidecarDistribution {
    pub fn load(root: impl AsRef<Path>) -> Result<Self> {
        let root = root.as_ref();
        validate_root(root)?;

        let manifest_path = root.join(MANIFEST_FILE_NAME);
        let manifest_file = open_regular_file(&manifest_path, "distribution manifest")?;
        let manifest: DistributionManifest = serde_json::from_reader(manifest_file)
            .wrap_err_with(|| format!("Failed to parse {}", manifest_path.display()))?;

        let mut target_ids = HashSet::new();
        let mut targets = Vec::with_capacity(manifest.targets.len());
        for target in manifest.targets {
            validate_identifier(&target.id, "target ID")?;
            validate_identifier(&target.platform.os, "target operating system")?;
            validate_identifier(&target.platform.architecture, "target architecture")?;
            validate_identifier(&target.platform.abi, "target ABI")?;
            validate_identifier(&target.default_file, "default file ID")?;
            ensure!(
                target_ids.insert(target.id.clone()),
                "Duplicate desktop sidecar target ID: {}",
                target.id
            );

            let mut file_ids = HashSet::new();
            let mut files = Vec::with_capacity(target.files.len());
            for artifact in target.files {
                validate_identifier(&artifact.id, "file ID")?;
                validate_identifier(&artifact.kind, "artifact kind")?;
                ensure!(
                    file_ids.insert(artifact.id.clone()),
                    "Duplicate file ID '{}' in desktop sidecar target '{}'",
                    artifact.id,
                    target.id
                );
                validate_download_filename(&artifact.download_filename)?;
                validate_media_type(&artifact.media_type)?;

                let path = validate_artifact_path(root, &artifact.path)?;
                let source = open_regular_file(
                    &path,
                    &format!(
                        "artifact '{}' for desktop sidecar target '{}'",
                        artifact.id, target.id
                    ),
                )?;
                let size = source
                    .metadata()
                    .wrap_err_with(|| format!("Failed to read metadata for {}", path.display()))?
                    .len();

                files.push(DistributionArtifact {
                    id: artifact.id,
                    kind: artifact.kind,
                    download_filename: artifact.download_filename,
                    media_type: artifact.media_type,
                    size,
                    source: Arc::new(source),
                });
            }

            ensure!(
                file_ids.contains(&target.default_file),
                "Default file '{}' is not declared by desktop sidecar target '{}'",
                target.default_file,
                target.id
            );
            targets.push(DistributionTarget {
                id: target.id,
                platform: target.platform,
                default_file: target.default_file,
                files,
            });
        }

        Ok(Self { targets })
    }

    #[must_use]
    pub fn targets(&self) -> &[DistributionTarget] {
        &self.targets
    }

    #[must_use]
    pub fn artifact(
        &self,
        target_id: &str,
        file_id: Option<&str>,
    ) -> Option<&DistributionArtifact> {
        let target = self.targets.iter().find(|target| target.id == target_id)?;
        let file_id = file_id.unwrap_or(&target.default_file);
        target.files.iter().find(|artifact| artifact.id == file_id)
    }
}

impl DistributionArtifact {
    pub fn try_clone_source(&self) -> std::io::Result<File> {
        self.source.try_clone()
    }
}

fn validate_root(root: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(root)
        .wrap_err_with(|| format!("Failed to inspect artifact root {}", root.display()))?;
    ensure!(
        !metadata.file_type().is_symlink(),
        "Desktop sidecar artifact root must not be a symlink: {}",
        root.display()
    );
    ensure!(
        metadata.is_dir(),
        "Desktop sidecar artifact root is not a directory: {}",
        root.display()
    );
    Ok(())
}

fn validate_identifier(identifier: &str, description: &str) -> Result<()> {
    ensure!(!identifier.is_empty(), "{description} must not be empty");
    ensure!(
        identifier
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.')),
        "{description} contains unsupported characters: {identifier}"
    );
    Ok(())
}

fn validate_download_filename(filename: &str) -> Result<()> {
    ensure!(
        !filename.is_empty()
            && filename != "."
            && filename != ".."
            && !filename.contains('/')
            && !filename.contains('\\'),
        "Artifact download filename must be a plain filename: {filename}"
    );
    Ok(())
}

fn validate_media_type(media_type: &str) -> Result<()> {
    ensure!(
        media_type.contains('/') && axum::http::HeaderValue::from_str(media_type).is_ok(),
        "Artifact media type is invalid: {media_type}"
    );
    Ok(())
}

fn validate_artifact_path(root: &Path, manifest_path: &str) -> Result<PathBuf> {
    ensure!(
        !manifest_path.is_empty()
            && !manifest_path.starts_with('/')
            && !manifest_path.starts_with('\\'),
        "Artifact path must be relative: {manifest_path}"
    );
    ensure!(
        !manifest_path.contains('\\'),
        "Artifact path must use forward slashes: {manifest_path}"
    );

    let components = manifest_path.split('/').collect::<Vec<_>>();
    ensure!(
        components.iter().all(|component| {
            !component.is_empty()
                && *component != "."
                && *component != ".."
                && !component.contains(':')
        }),
        "Artifact path contains an invalid component: {manifest_path}"
    );

    let mut current = root.to_path_buf();
    for (index, component) in components.iter().enumerate() {
        current.push(component);
        let metadata = fs::symlink_metadata(&current)
            .wrap_err_with(|| format!("Failed to inspect artifact path {}", current.display()))?;
        ensure!(
            !metadata.file_type().is_symlink(),
            "Artifact path must not contain symlinks: {}",
            current.display()
        );
        if index + 1 < components.len() {
            ensure!(
                metadata.is_dir(),
                "Artifact path component is not a directory: {}",
                current.display()
            );
        }
    }

    Ok(current)
}

fn open_regular_file(path: &Path, description: &str) -> Result<File> {
    let metadata = fs::symlink_metadata(path)
        .wrap_err_with(|| format!("Failed to inspect {description}: {}", path.display()))?;
    if metadata.file_type().is_symlink() {
        bail!("{description} must not be a symlink: {}", path.display());
    }
    ensure!(
        metadata.is_file(),
        "{description} is not a regular file: {}",
        path.display()
    );
    File::open(path).wrap_err_with(|| format!("Failed to open {description}: {}", path.display()))
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use serde_json::json;
    use tempfile::tempdir;

    use super::*;

    fn write_distribution(root: &Path, manifest: serde_json::Value) {
        fs::create_dir_all(root.join("targets/windows-x86_64")).unwrap();
        fs::write(
            root.join("targets/windows-x86_64/erato-desktop-sidecar.exe"),
            b"sidecar",
        )
        .unwrap();
        let mut file = File::create(root.join(MANIFEST_FILE_NAME)).unwrap();
        serde_json::to_writer_pretty(&mut file, &manifest).unwrap();
        file.flush().unwrap();
    }

    fn valid_manifest() -> serde_json::Value {
        json!({
            "targets": [{
                "id": "windows-x86_64",
                "platform": {
                    "os": "windows",
                    "architecture": "x86_64",
                    "abi": "msvc"
                },
                "default_file": "executable",
                "files": [{
                    "id": "executable",
                    "kind": "executable",
                    "path": "targets/windows-x86_64/erato-desktop-sidecar.exe",
                    "download_filename": "erato-desktop-sidecar-windows-x86_64.exe",
                    "media_type": "application/vnd.microsoft.portable-executable"
                }]
            }]
        })
    }

    #[test]
    fn loads_a_complete_distribution_and_selects_the_default_file() {
        let directory = tempdir().unwrap();
        write_distribution(directory.path(), valid_manifest());

        let distribution = DesktopSidecarDistribution::load(directory.path()).unwrap();
        let artifact = distribution
            .artifact("windows-x86_64", None)
            .expect("default artifact should be available");

        assert_eq!(distribution.targets().len(), 1);
        assert_eq!(artifact.id, "executable");
        assert_eq!(artifact.size, 7);
        assert!(artifact.try_clone_source().is_ok());
    }

    #[test]
    fn rejects_duplicate_target_and_file_ids() {
        let directory = tempdir().unwrap();
        let mut manifest = valid_manifest();
        let target = manifest["targets"][0].clone();
        manifest["targets"]
            .as_array_mut()
            .unwrap()
            .push(target.clone());
        write_distribution(directory.path(), manifest);

        assert!(
            DesktopSidecarDistribution::load(directory.path())
                .unwrap_err()
                .to_string()
                .contains("Duplicate desktop sidecar target ID")
        );

        let directory = tempdir().unwrap();
        let mut manifest = valid_manifest();
        let file = manifest["targets"][0]["files"][0].clone();
        manifest["targets"][0]["files"]
            .as_array_mut()
            .unwrap()
            .push(file);
        write_distribution(directory.path(), manifest);

        assert!(
            DesktopSidecarDistribution::load(directory.path())
                .unwrap_err()
                .to_string()
                .contains("Duplicate file ID")
        );
    }

    #[test]
    fn rejects_missing_defaults_and_traversal_paths() {
        let directory = tempdir().unwrap();
        let mut manifest = valid_manifest();
        manifest["targets"][0]["default_file"] = json!("installer");
        write_distribution(directory.path(), manifest);
        assert!(
            DesktopSidecarDistribution::load(directory.path())
                .unwrap_err()
                .to_string()
                .contains("Default file")
        );

        let directory = tempdir().unwrap();
        let mut manifest = valid_manifest();
        manifest["targets"][0]["files"][0]["path"] = json!("../sidecar");
        write_distribution(directory.path(), manifest);
        assert!(
            DesktopSidecarDistribution::load(directory.path())
                .unwrap_err()
                .to_string()
                .contains("invalid component")
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_in_artifact_paths() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().unwrap();
        write_distribution(directory.path(), valid_manifest());
        let artifact_path = directory
            .path()
            .join("targets/windows-x86_64/erato-desktop-sidecar.exe");
        fs::remove_file(&artifact_path).unwrap();
        let outside = directory.path().join("outside.exe");
        fs::write(&outside, b"outside").unwrap();
        symlink(outside, artifact_path).unwrap();

        assert!(
            DesktopSidecarDistribution::load(directory.path())
                .unwrap_err()
                .to_string()
                .contains("must not contain symlinks")
        );
    }
}
