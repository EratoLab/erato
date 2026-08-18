//! Validated desktop-sidecar binary distribution and personalization support.

use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{Cursor, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use eyre::{Context, Result, bail, ensure};
use msi::{Expr, Select, Update, Value as MsiValue};
use serde::Deserialize;
use serde_json::json;
use url::{Host, Origin, Url};

const MANIFEST_FILE_NAME: &str = "manifest.json";
const BOOTSTRAP_FORMAT_VERSION: u16 = 1;
pub const EMBEDDED_BOOTSTRAP_SLOT_CAPACITY: usize = 4096;
const EMBEDDED_BOOTSTRAP_MAGIC: &[u8; 16] = b"ERATO_BOOTSTRAP!";
const EMBEDDED_BOOTSTRAP_HEADER_BYTES: usize = 16 + 2 + 4 + 4;
const MSI_BOOTSTRAP_CABINET_STREAM: &str = "bootstrap.cab";
const MSI_BOOTSTRAP_FILE_ID: &str = "OrganizationBootstrapFile";

#[derive(Clone, Debug)]
pub struct DesktopSidecarDistribution {
    targets: Vec<DistributionTarget>,
    bootstrap: Arc<[u8]>,
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
    bootstrap_transport: BootstrapTransport,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BootstrapTransport {
    None,
    WindowsExecutable { slot_offset: u64 },
    WindowsMsi,
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
        Self::load_with_allowed_origins(root, &[])
    }

    pub fn load_with_allowed_origins(
        root: impl AsRef<Path>,
        allowed_origins: &[String],
    ) -> Result<Self> {
        let root = root.as_ref();
        validate_root(root)?;
        let bootstrap: Arc<[u8]> = build_bootstrap(allowed_origins)?.into();

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
                let bootstrap_transport = bootstrap_transport(
                    &target.platform.os,
                    &artifact.kind,
                    &source,
                )
                .wrap_err_with(|| {
                    format!(
                        "Failed to validate bootstrap transport for artifact '{}' in desktop sidecar target '{}'",
                        artifact.id, target.id
                    )
                })?;

                files.push(DistributionArtifact {
                    id: artifact.id,
                    kind: artifact.kind,
                    download_filename: artifact.download_filename,
                    media_type: artifact.media_type,
                    size,
                    source: Arc::new(source),
                    bootstrap_transport,
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

        Ok(Self { targets, bootstrap })
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

    #[must_use]
    pub fn bootstrap(&self) -> &[u8] {
        &self.bootstrap
    }
}

impl DistributionArtifact {
    pub fn try_clone_source(&self) -> std::io::Result<File> {
        self.source.try_clone()
    }

    #[must_use]
    pub fn bootstrap_transport(&self) -> BootstrapTransport {
        self.bootstrap_transport
    }

    pub fn personalized_msi(&self, bootstrap: &[u8]) -> Result<Vec<u8>> {
        ensure!(
            self.bootstrap_transport == BootstrapTransport::WindowsMsi,
            "artifact does not use the Windows MSI bootstrap transport"
        );
        let mut template = Vec::new();
        let mut source = self
            .try_clone_source()
            .wrap_err("Failed to clone MSI template")?;
        source
            .seek(SeekFrom::Start(0))
            .wrap_err("Failed to seek MSI template")?;
        source
            .read_to_end(&mut template)
            .wrap_err("Failed to read MSI template")?;
        inject_msi(&template, bootstrap)
    }
}

fn build_bootstrap(allowed_origins: &[String]) -> Result<Vec<u8>> {
    let mut origins = HashSet::new();
    for origin in allowed_origins {
        ensure!(
            is_normalized_non_loopback_origin(origin),
            "Desktop sidecar allowed origin must be normalized and non-loopback: {origin}"
        );
        ensure!(
            origins.insert(origin.as_str()),
            "Desktop sidecar allowed origins must not contain duplicates: {origin}"
        );
    }

    serde_json::to_vec(&json!({
        "version": BOOTSTRAP_FORMAT_VERSION,
        "organization_configuration": {
            "allowed_origins": allowed_origins,
        }
    }))
    .wrap_err("Failed to serialize desktop sidecar bootstrap")
}

fn bootstrap_transport(
    operating_system: &str,
    kind: &str,
    source: &File,
) -> Result<BootstrapTransport> {
    if operating_system != "windows" {
        return Ok(BootstrapTransport::None);
    }

    let mut template = Vec::new();
    source
        .try_clone()
        .wrap_err("Failed to clone Windows artifact template")?
        .read_to_end(&mut template)
        .wrap_err("Failed to read Windows artifact template")?;
    match kind {
        "executable" => Ok(BootstrapTransport::WindowsExecutable {
            slot_offset: executable_bootstrap_slot_offset(&template)? as u64,
        }),
        "installer" => {
            validate_msi_template(&template)?;
            Ok(BootstrapTransport::WindowsMsi)
        }
        _ => Ok(BootstrapTransport::None),
    }
}

pub fn encode_executable_bootstrap_slot(
    bootstrap: &[u8],
) -> Result<[u8; EMBEDDED_BOOTSTRAP_SLOT_CAPACITY]> {
    let payload_capacity = EMBEDDED_BOOTSTRAP_SLOT_CAPACITY - EMBEDDED_BOOTSTRAP_HEADER_BYTES;
    ensure!(
        bootstrap.len() <= payload_capacity,
        "Desktop sidecar bootstrap is {} bytes; embedded capacity is {payload_capacity} bytes",
        bootstrap.len()
    );
    let mut slot = [b' '; EMBEDDED_BOOTSTRAP_SLOT_CAPACITY];
    slot[..EMBEDDED_BOOTSTRAP_MAGIC.len()].copy_from_slice(EMBEDDED_BOOTSTRAP_MAGIC);
    slot[16..18].copy_from_slice(&BOOTSTRAP_FORMAT_VERSION.to_le_bytes());
    slot[18..22].copy_from_slice(&(bootstrap.len() as u32).to_le_bytes());
    slot[22..26].copy_from_slice(&(payload_capacity as u32).to_le_bytes());
    slot[EMBEDDED_BOOTSTRAP_HEADER_BYTES..EMBEDDED_BOOTSTRAP_HEADER_BYTES + bootstrap.len()]
        .copy_from_slice(bootstrap);
    Ok(slot)
}

fn executable_bootstrap_slot_offset(template: &[u8]) -> Result<usize> {
    let (section_offset, section_size) = embedded_section_range(template)?;
    let section = &template[section_offset..section_offset + section_size];
    let offsets = section
        .windows(EMBEDDED_BOOTSTRAP_MAGIC.len())
        .enumerate()
        .filter_map(|(offset, bytes)| (bytes == EMBEDDED_BOOTSTRAP_MAGIC).then_some(offset))
        .collect::<Vec<_>>();
    ensure!(
        offsets.len() == 1,
        "expected exactly one embedded bootstrap marker, found {}",
        offsets.len()
    );
    let slot_offset = section_offset + offsets[0];
    ensure!(
        offsets[0] + EMBEDDED_BOOTSTRAP_SLOT_CAPACITY <= section_size,
        "embedded bootstrap slot is truncated"
    );
    let slot = &template[slot_offset..slot_offset + EMBEDDED_BOOTSTRAP_SLOT_CAPACITY];
    ensure!(
        slot[16..18] == BOOTSTRAP_FORMAT_VERSION.to_le_bytes(),
        "embedded bootstrap slot has an unsupported version"
    );
    let expected_capacity = EMBEDDED_BOOTSTRAP_SLOT_CAPACITY - EMBEDDED_BOOTSTRAP_HEADER_BYTES;
    ensure!(
        slot[22..26] == (expected_capacity as u32).to_le_bytes(),
        "embedded bootstrap slot has an unexpected capacity"
    );
    Ok(slot_offset)
}

fn embedded_section_range(template: &[u8]) -> Result<(usize, usize)> {
    ensure!(
        template.len() >= 0x40 && template[..2] == *b"MZ",
        "template is not a PE executable"
    );
    let pe_offset = read_u32(template, 0x3c)? as usize;
    let coff_offset = pe_offset + 4;
    ensure!(
        pe_offset + 24 <= template.len() && template.get(pe_offset..coff_offset) == Some(b"PE\0\0"),
        "template has no valid PE header"
    );
    let section_count = read_u16(template, coff_offset + 2)? as usize;
    let optional_header_size = read_u16(template, coff_offset + 16)? as usize;
    let section_headers = coff_offset + 20 + optional_header_size;
    let mut sections = Vec::new();
    for index in 0..section_count {
        let header = section_headers + index * 40;
        let section_header = template
            .get(header..header + 40)
            .ok_or_else(|| eyre::eyre!("template has a truncated PE section table"))?;
        if section_header[..8]
            .iter()
            .copied()
            .take_while(|byte| *byte != 0)
            .collect::<Vec<_>>()
            != b".erato"
        {
            continue;
        }
        let size = read_u32(section_header, 16)? as usize;
        let offset = read_u32(section_header, 20)? as usize;
        ensure!(
            offset
                .checked_add(size)
                .is_some_and(|end| end <= template.len()),
            ".erato section extends past the template"
        );
        sections.push((offset, size));
    }
    match sections.as_slice() {
        [section] => Ok(*section),
        _ => bail!(
            "expected exactly one .erato section, found {}",
            sections.len()
        ),
    }
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16> {
    let bytes = bytes
        .get(offset..offset + 2)
        .ok_or_else(|| eyre::eyre!("template is truncated"))?;
    Ok(u16::from_le_bytes(
        bytes.try_into().expect("fixed slice length"),
    ))
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32> {
    let bytes = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| eyre::eyre!("template is truncated"))?;
    Ok(u32::from_le_bytes(
        bytes.try_into().expect("fixed slice length"),
    ))
}

fn inject_msi(template: &[u8], bootstrap: &[u8]) -> Result<Vec<u8>> {
    let cabinet = build_bootstrap_cabinet(bootstrap)?;
    let mut package = msi::Package::open(Cursor::new(template.to_vec()))
        .wrap_err("Failed to open MSI template")?;
    verify_msi_file_size(&mut package, None)?;
    let existing_cabinet = read_msi_stream(&mut package, MSI_BOOTSTRAP_CABINET_STREAM)?;
    read_bootstrap_cabinet(&existing_cabinet)?;
    package
        .remove_stream(MSI_BOOTSTRAP_CABINET_STREAM)
        .wrap_err("Failed to remove MSI bootstrap cabinet")?;
    package
        .write_stream(MSI_BOOTSTRAP_CABINET_STREAM)
        .wrap_err("Failed to create MSI bootstrap cabinet")?
        .write_all(&cabinet)
        .wrap_err("Failed to write MSI bootstrap cabinet")?;
    let size = i32::try_from(bootstrap.len()).wrap_err("Bootstrap exceeds MSI size limit")?;
    package
        .update_rows(
            Update::table("File")
                .set("FileSize", MsiValue::Int(size))
                .with(Expr::col("File").eq(Expr::string(MSI_BOOTSTRAP_FILE_ID))),
        )
        .wrap_err("Failed to update MSI bootstrap file size")?;
    package
        .flush()
        .wrap_err("Failed to flush personalized MSI")?;
    let personalized = package
        .into_inner()
        .wrap_err("Failed to finalize personalized MSI")?
        .into_inner();
    validate_personalized_msi(&personalized, bootstrap)?;
    Ok(personalized)
}

fn validate_msi_template(template: &[u8]) -> Result<()> {
    let mut package = msi::Package::open(Cursor::new(template.to_vec()))
        .wrap_err("Failed to open MSI template")?;
    verify_msi_file_size(&mut package, None)?;
    let cabinet = read_msi_stream(&mut package, MSI_BOOTSTRAP_CABINET_STREAM)?;
    read_bootstrap_cabinet(&cabinet)?;
    Ok(())
}

fn validate_personalized_msi(personalized: &[u8], bootstrap: &[u8]) -> Result<()> {
    let mut package = msi::Package::open(Cursor::new(personalized.to_vec()))
        .wrap_err("Failed to reopen personalized MSI")?;
    let cabinet = read_msi_stream(&mut package, MSI_BOOTSTRAP_CABINET_STREAM)?;
    ensure!(
        read_bootstrap_cabinet(&cabinet)? == bootstrap,
        "MSI bootstrap verification did not match input"
    );
    verify_msi_file_size(&mut package, Some(bootstrap.len()))
}

fn read_msi_stream(package: &mut msi::Package<Cursor<Vec<u8>>>, stream: &str) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    package
        .read_stream(stream)
        .wrap_err_with(|| format!("MSI has no {stream} stream"))?
        .read_to_end(&mut bytes)
        .wrap_err_with(|| format!("Failed to read MSI {stream} stream"))?;
    Ok(bytes)
}

fn verify_msi_file_size(
    package: &mut msi::Package<Cursor<Vec<u8>>>,
    expected_size: Option<usize>,
) -> Result<()> {
    let query = Select::table("File")
        .columns(&["FileSize"])
        .with(Expr::col("File").eq(Expr::string(MSI_BOOTSTRAP_FILE_ID)));
    let mut rows = package
        .select_rows(query)
        .wrap_err("Failed to inspect MSI File table")?;
    let row = rows
        .next()
        .ok_or_else(|| eyre::eyre!("MSI has no OrganizationBootstrapFile File table row"))?;
    let file_size = row[0]
        .as_int()
        .ok_or_else(|| eyre::eyre!("MSI bootstrap FileSize is not an integer"))?;
    ensure!(
        rows.next().is_none(),
        "MSI has multiple OrganizationBootstrapFile File table rows"
    );
    if let Some(expected_size) = expected_size {
        ensure!(
            file_size
                == i32::try_from(expected_size).wrap_err("Bootstrap exceeds MSI size limit")?,
            "MSI bootstrap FileSize does not match the embedded bootstrap"
        );
    }
    Ok(())
}

fn build_bootstrap_cabinet(bootstrap: &[u8]) -> Result<Vec<u8>> {
    let mut builder = cab::CabinetBuilder::new();
    builder
        .add_folder(cab::CompressionType::None)
        .add_file(MSI_BOOTSTRAP_FILE_ID);
    let mut writer = builder
        .build(Cursor::new(Vec::new()))
        .wrap_err("Failed to create bootstrap cabinet")?;
    writer
        .next_file()
        .wrap_err("Failed to create bootstrap cabinet entry")?
        .ok_or_else(|| eyre::eyre!("bootstrap cabinet has no file entry"))?
        .write_all(bootstrap)
        .wrap_err("Failed to write bootstrap cabinet")?;
    Ok(writer
        .finish()
        .wrap_err("Failed to finish bootstrap cabinet")?
        .into_inner())
}

fn read_bootstrap_cabinet(cabinet_bytes: &[u8]) -> Result<Vec<u8>> {
    let mut cabinet =
        cab::Cabinet::new(Cursor::new(cabinet_bytes)).wrap_err("Invalid MSI bootstrap cabinet")?;
    let entries = cabinet
        .folder_entries()
        .flat_map(|folder| folder.file_entries())
        .map(|file| file.name())
        .collect::<Vec<_>>();
    ensure!(
        entries.as_slice() == [MSI_BOOTSTRAP_FILE_ID],
        "bootstrap cabinet must contain only {MSI_BOOTSTRAP_FILE_ID}, found {entries:?}"
    );
    let mut bootstrap = Vec::new();
    cabinet
        .read_file(MSI_BOOTSTRAP_FILE_ID)
        .wrap_err("Failed to read bootstrap cabinet entry")?
        .read_to_end(&mut bootstrap)
        .wrap_err("Failed to read bootstrap cabinet bytes")?;
    Ok(bootstrap)
}

fn is_normalized_non_loopback_origin(origin: &str) -> bool {
    let Ok(url) = Url::parse(origin) else {
        return false;
    };
    let is_loopback = match url.host() {
        Some(Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(Host::Ipv4(address)) => address.is_loopback(),
        Some(Host::Ipv6(address)) => address.is_loopback(),
        None => true,
    };
    !is_loopback && normalized_origin(&url).as_deref() == Some(origin)
}

fn normalized_origin(url: &Url) -> Option<String> {
    if !matches!(url.path(), "" | "/")
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    match url.origin() {
        Origin::Tuple(..) => Some(url.origin().ascii_serialization()),
        Origin::Opaque(_) => None,
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
            windows_executable_template(),
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
        assert_eq!(
            artifact.size,
            (0x200 + EMBEDDED_BOOTSTRAP_SLOT_CAPACITY + 64) as u64
        );
        assert!(artifact.try_clone_source().is_ok());
    }

    #[test]
    fn rejects_invalid_allowed_origins_and_caches_the_executable_slot() {
        let directory = tempdir().unwrap();
        write_distribution(directory.path(), valid_manifest());

        assert!(
            DesktopSidecarDistribution::load_with_allowed_origins(
                directory.path(),
                &["https://app.example.test/".to_owned()]
            )
            .is_err()
        );

        let distribution = DesktopSidecarDistribution::load_with_allowed_origins(
            directory.path(),
            &["https://app.example.test".to_owned()],
        )
        .unwrap();
        let artifact = distribution.artifact("windows-x86_64", None).unwrap();
        assert_eq!(
            artifact.bootstrap_transport(),
            BootstrapTransport::WindowsExecutable {
                slot_offset: 0x200 + 32
            }
        );
        assert_eq!(
            distribution.bootstrap(),
            br#"{"version":1,"organization_configuration":{"allowed_origins":["https://app.example.test"]}}"#
        );
    }

    #[test]
    fn personalizes_only_the_msi_bootstrap_cabinet() {
        use msi::{Column, Insert, Package, PackageType};

        let mut package = Package::create(PackageType::Installer, Cursor::new(Vec::new())).unwrap();
        package
            .create_table(
                "File",
                vec![
                    Column::build("File").primary_key().id_string(72),
                    Column::build("FileSize").int32(),
                ],
            )
            .unwrap();
        package
            .insert_rows(Insert::into("File").row(vec![
                MsiValue::from(MSI_BOOTSTRAP_FILE_ID),
                MsiValue::Int(0),
            ]))
            .unwrap();
        package
            .write_stream(MSI_BOOTSTRAP_CABINET_STREAM)
            .unwrap()
            .write_all(
                &build_bootstrap_cabinet(
                    br#"{"version":1,"organization_configuration":{"allowed_origins":[]}}"#,
                )
                .unwrap(),
            )
            .unwrap();
        package.flush().unwrap();
        let template = package.into_inner().unwrap().into_inner();

        let bootstrap = br#"{"version":1,"organization_configuration":{"allowed_origins":["https://app.example.test"]}}"#;
        let personalized = inject_msi(&template, bootstrap).unwrap();
        validate_personalized_msi(&personalized, bootstrap).unwrap();
    }

    fn windows_executable_template() -> Vec<u8> {
        let section_offset = 0x200;
        let section_size = EMBEDDED_BOOTSTRAP_SLOT_CAPACITY + 64;
        let mut binary = vec![0; section_offset + section_size];
        binary[..2].copy_from_slice(b"MZ");
        binary[0x3c..0x40].copy_from_slice(&(0x80_u32).to_le_bytes());
        binary[0x80..0x84].copy_from_slice(b"PE\0\0");
        binary[0x86..0x88].copy_from_slice(&1_u16.to_le_bytes());
        binary[0x94..0x96].copy_from_slice(&0x20_u16.to_le_bytes());
        let header = 0x80 + 24 + 0x20;
        binary[header..header + 6].copy_from_slice(b".erato");
        binary[header + 16..header + 20].copy_from_slice(&(section_size as u32).to_le_bytes());
        binary[header + 20..header + 24].copy_from_slice(&(section_offset as u32).to_le_bytes());
        let slot_offset = section_offset + 32;
        binary[slot_offset..slot_offset + EMBEDDED_BOOTSTRAP_MAGIC.len()]
            .copy_from_slice(EMBEDDED_BOOTSTRAP_MAGIC);
        binary[slot_offset + 16..slot_offset + 18]
            .copy_from_slice(&BOOTSTRAP_FORMAT_VERSION.to_le_bytes());
        binary[slot_offset + 22..slot_offset + 26].copy_from_slice(
            &((EMBEDDED_BOOTSTRAP_SLOT_CAPACITY - EMBEDDED_BOOTSTRAP_HEADER_BYTES) as u32)
                .to_le_bytes(),
        );
        binary
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
