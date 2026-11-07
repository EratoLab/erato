//! The desktop UI package: the generic bundle the sidecar distribution ships,
//! the per-deployment package assembled from it, and the token sidecars
//! download it with. The layout is the sidecar repository's
//! `crates/erato-desktop-sidecar-ui` contract; DISTRIBUTION.md section 8
//! describes what the deployment package adds.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use axum::body::Bytes;
use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use chrono::{DateTime, TimeDelta, Utc};
use eyre::{Context, Result, bail, ensure, eyre};
use flate2::Compression;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use hmac::{Hmac, KeyInit, Mac};
use serde::Serialize;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};

use crate::config::AppConfig;
use crate::distribution::Distribution;
use crate::distribution::frontend_bundles::serialize_import_map;
use crate::distribution::runtime::DistributionBundle;
use crate::distribution::translations::TranslationDistribution;

pub const FORMAT: u64 = 1;
pub const HOST_API: u64 = 1;
/// The assembled package's budget on `totalBytes`: the sidecar's acceptance
/// budget (`MAX_TOTAL_BYTES` in `crates/erato-desktop-sidecar-ui`) governs,
/// so raise that first. The generic bundle keeps to the sidecar's 8 MiB seed
/// budget (`desktop-ui/scripts/package.mjs`), so a deployment always has at
/// least 8 MiB for its catalogs, theme and component kits.
pub const PACKAGE_BUDGET_BYTES: u64 = 16 * 1024 * 1024;
/// The most the assembled package's archive may hold compressed: what a
/// client can relay with `sidecar.install_ui_package.v1` (protocol 0.1.47),
/// `RELAY_MAX_CHUNKS` chunks of `RELAY_CHUNK_BYTES`, which is also the most
/// the sidecar downloads (`MAX_ARCHIVE_BYTES`). A larger archive is not
/// served.
pub const PACKAGE_MAX_ARCHIVE_BYTES: u64 = RELAY_CHUNK_BYTES * RELAY_MAX_CHUNKS;
pub const APP_MOUNT_PATH: &str = "/public/platform-desktop-ui";
pub const FRONTEND_PLATFORM: &str = "platform-desktop-ui";
pub const HEAD_MARKER: &str = "<!--erato:head-->";
pub const KITS_MARKER: &str = "<!--erato:kits-->";
pub const TOKEN_TTL_SECONDS: i64 = 24 * 60 * 60;

const PACKAGE_ROOT: &str = "package";
const PACKAGE_FILES: [&str; 2] = ["package.json", "manifest.json"];
const IMPORT_MAP_MANIFEST_PATH: &str = "public/platform-desktop-ui/import-map.manifest.json";
const COMMON_LOCALES_PATH: &str = "public/common/locales";
const OVERRIDES_PATH: &str = "public/common/overrides";
const THEMES_PATH: &str = "public/common/custom-theme";
const KITS_PATH: &str = "public/component-kits";
const TOKEN_PURPOSE: &str = "desktop-ui-package";
const TOKEN_KEY_LABEL: &[u8] = b"erato-desktop-ui-package-token";
const MAX_UNPACKED_BYTES: u64 = 64 * 1024 * 1024;
/// Raw archive bytes per relayed chunk (`sidecar.install_ui_package.v1`
/// `content_base64`, decoded).
const RELAY_CHUNK_BYTES: u64 = 131_072;
/// The most chunks one relayed archive has (`chunk_count` maximum).
const RELAY_MAX_CHUNKS: u64 = 72;

/// The `ui` artifact of a distribution: the generic bundle at its version.
#[derive(Debug)]
pub struct DesktopUiArtifact {
    pub version: String,
    pub bundle: DesktopUiBundle,
}

impl DesktopUiArtifact {
    pub fn load(path: &Path, version: &str) -> Result<Self> {
        let mut archive = Vec::new();
        fs::File::open(path)
            .and_then(|mut file| file.read_to_end(&mut archive))
            .wrap_err_with(|| format!("Failed to read desktop UI archive {}", path.display()))?;
        let bundle = DesktopUiBundle::from_archive(&archive)
            .wrap_err_with(|| format!("Invalid desktop UI archive {}", path.display()))?;
        ensure!(
            bundle.version == version,
            "Desktop UI archive {} is version {}, the manifest says {version}",
            path.display(),
            bundle.version
        );
        Ok(Self {
            version: version.to_owned(),
            bundle,
        })
    }
}

/// A package archive unpacked and checked against the layout contract.
#[derive(Clone)]
pub struct DesktopUiBundle {
    manifest: Map<String, Value>,
    package_json: Vec<u8>,
    files: BTreeMap<String, PackageFile>,
    pub name: String,
    pub version: String,
    pub commit: String,
    pub library_commit: String,
    pub host_api: u64,
}

#[derive(Clone)]
struct PackageFile {
    bytes: Vec<u8>,
    content_type: String,
}

impl fmt::Debug for DesktopUiBundle {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DesktopUiBundle")
            .field("name", &self.name)
            .field("version", &self.version)
            .field("commit", &self.commit)
            .field("files", &self.files.len())
            .finish()
    }
}

impl DesktopUiBundle {
    pub fn from_archive(archive: &[u8]) -> Result<Self> {
        Self::from_files(unpack(archive)?)
    }

    fn from_files(mut files: BTreeMap<String, Vec<u8>>) -> Result<Self> {
        let package_json = files
            .remove("package.json")
            .ok_or_else(|| eyre!("the package has no package.json"))?;
        let manifest_json = files
            .remove("manifest.json")
            .ok_or_else(|| eyre!("the package has no manifest.json"))?;
        let package: Value =
            serde_json::from_slice(&package_json).wrap_err("package.json is not valid JSON")?;
        let manifest: Value =
            serde_json::from_slice(&manifest_json).wrap_err("manifest.json is not valid JSON")?;
        let Value::Object(manifest) = manifest else {
            bail!("manifest.json is not an object");
        };
        let format = required_u64(&manifest, "format")?;
        ensure!(
            format == FORMAT,
            "manifest.json has format {format}; this backend reads format {FORMAT}"
        );
        let host_api = required_u64(&manifest, "hostApi")?;
        ensure!(
            host_api == HOST_API,
            "manifest.json needs host API {host_api}; this backend composes host API {HOST_API}"
        );
        let name = required_string(&manifest, "name")?;
        let version = required_string(&manifest, "version")?;
        ensure!(
            package.get("name").and_then(Value::as_str) == Some(&name)
                && package.get("version").and_then(Value::as_str) == Some(&version),
            "manifest.json and package.json disagree about the package name or version"
        );
        let commit = required_string(&manifest, "commit")?;
        let library_commit = manifest
            .get("library")
            .and_then(|library| library.get("commit"))
            .and_then(Value::as_str)
            .filter(|commit| !commit.is_empty())
            .ok_or_else(|| eyre!("manifest.json has no library.commit"))?
            .to_owned();
        let total_bytes = required_u64(&manifest, "totalBytes")?;
        let listed = verify_files(&manifest, &files, total_bytes)?;
        verify_windows(&manifest, &files)?;
        let files = files
            .into_iter()
            .map(|(path, bytes)| {
                let content_type = listed[&path].clone();
                (
                    path,
                    PackageFile {
                        bytes,
                        content_type,
                    },
                )
            })
            .collect();
        Ok(Self {
            manifest,
            package_json,
            files,
            name,
            version,
            commit,
            library_commit,
            host_api,
        })
    }

    #[must_use]
    pub fn windows(&self) -> Vec<Value> {
        self.manifest
            .get("windows")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    }

    #[must_use]
    pub fn file_paths(&self) -> Vec<&str> {
        self.files.keys().map(String::as_str).collect()
    }

    #[must_use]
    pub fn file_bytes(&self, path: &str) -> Option<&[u8]> {
        self.files.get(path).map(|file| file.bytes.as_slice())
    }
}

fn unpack(archive: &[u8]) -> Result<BTreeMap<String, Vec<u8>>> {
    let mut archive = tar::Archive::new(GzDecoder::new(archive));
    let mut files = BTreeMap::new();
    let mut unpacked = 0_u64;
    for entry in archive
        .entries()
        .wrap_err("the archive is not a gzip tar")?
    {
        let mut entry = entry.wrap_err("the archive is not a gzip tar")?;
        let path = entry
            .path()
            .wrap_err("an archive entry has no readable path")?
            .into_owned();
        let entry_type = entry.header().entry_type();
        ensure!(
            entry_type.is_file() || entry_type.is_dir(),
            "the archive contains an unsupported entry type at {}",
            path.display()
        );
        let Some(relative) = entry_path(&path)? else {
            continue;
        };
        if entry_type.is_dir() {
            continue;
        }
        unpacked = unpacked.saturating_add(entry.header().size().unwrap_or(0));
        ensure!(
            unpacked <= MAX_UNPACKED_BYTES,
            "the archive unpacks to more than {MAX_UNPACKED_BYTES} bytes"
        );
        let mut contents = Vec::new();
        entry
            .read_to_end(&mut contents)
            .wrap_err_with(|| format!("archive entry {relative} could not be read"))?;
        ensure!(
            files.insert(relative.clone(), contents).is_none(),
            "the archive holds {relative} twice"
        );
    }
    ensure!(!files.is_empty(), "the archive holds no file");
    Ok(files)
}

/// The package-relative path of an entry below `package/`: `None` for the root
/// itself, an error for anything outside it or with a non-plain component.
fn entry_path(path: &Path) -> Result<Option<String>> {
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(name) => parts.push(
                name.to_str()
                    .ok_or_else(|| eyre!("archive entry path is not UTF-8: {}", path.display()))?
                    .to_owned(),
            ),
            Component::CurDir => {}
            _ => bail!(
                "archive entry is outside the package root: {}",
                path.display()
            ),
        }
    }
    ensure!(
        parts.first().map(String::as_str) == Some(PACKAGE_ROOT),
        "archive entry is outside the package root: {}",
        path.display()
    );
    Ok((parts.len() > 1).then(|| parts[1..].join("/")))
}

fn verify_files(
    manifest: &Map<String, Value>,
    files: &BTreeMap<String, Vec<u8>>,
    total_bytes: u64,
) -> Result<BTreeMap<String, String>> {
    let entries = manifest
        .get("files")
        .and_then(Value::as_array)
        .ok_or_else(|| eyre!("manifest.json has no files array"))?;
    let mut listed = BTreeMap::new();
    let mut sum = 0_u64;
    for entry in entries {
        let path = entry
            .get("path")
            .and_then(Value::as_str)
            .filter(|path| !path.is_empty())
            .ok_or_else(|| eyre!("a manifest file entry has no path"))?;
        ensure!(
            is_plain_relative_path(path),
            "manifest path is not a plain relative path: {path:?}"
        );
        ensure!(
            !PACKAGE_FILES.contains(&path),
            "manifest.json lists the package file {path}"
        );
        ensure!(
            !path.ends_with(".map"),
            "the package lists a source map: {path}"
        );
        let sha256 = entry
            .get("sha256")
            .and_then(Value::as_str)
            .ok_or_else(|| eyre!("manifest entry {path} has no sha256"))?
            .to_ascii_lowercase();
        ensure!(
            sha256.len() == 64 && sha256.bytes().all(|byte| byte.is_ascii_hexdigit()),
            "manifest entry {path} has no SHA-256 hex digest"
        );
        let bytes = entry
            .get("bytes")
            .and_then(Value::as_u64)
            .ok_or_else(|| eyre!("manifest entry {path} has no bytes"))?;
        let content_type = entry
            .get("contentType")
            .and_then(Value::as_str)
            .ok_or_else(|| eyre!("manifest entry {path} has no contentType"))?;
        ensure!(
            is_valid_content_type(content_type),
            "manifest entry {path} has an invalid content type: {content_type:?}"
        );
        let contents = files
            .get(path)
            .ok_or_else(|| eyre!("manifest entry {path} is missing from the package"))?;
        ensure!(
            contents.len() as u64 == bytes,
            "manifest entry {path} is {} bytes, not {bytes}",
            contents.len()
        );
        ensure!(
            hex(&Sha256::digest(contents)) == sha256,
            "manifest entry {path} does not match its SHA-256"
        );
        sum = sum
            .checked_add(bytes)
            .ok_or_else(|| eyre!("manifest entry {path} overflows the total"))?;
        ensure!(
            listed
                .insert(path.to_owned(), content_type.to_owned())
                .is_none(),
            "manifest.json lists {path} twice"
        );
    }
    ensure!(
        sum == total_bytes,
        "manifest totalBytes is {total_bytes}, the listed files hold {sum}"
    );
    for path in files.keys() {
        ensure!(
            listed.contains_key(path),
            "the package holds a file the manifest does not list: {path}"
        );
    }
    Ok(listed)
}

fn verify_windows(manifest: &Map<String, Value>, files: &BTreeMap<String, Vec<u8>>) -> Result<()> {
    let windows = manifest
        .get("windows")
        .and_then(Value::as_array)
        .ok_or_else(|| eyre!("manifest.json has no windows array"))?;
    ensure!(!windows.is_empty(), "manifest.json lists no window");
    let mut names = BTreeSet::new();
    let mut entries = BTreeSet::new();
    for window in windows {
        let name = window
            .get("name")
            .and_then(Value::as_str)
            .filter(|name| !name.is_empty())
            .ok_or_else(|| eyre!("a manifest window has no name"))?;
        let entry = window
            .get("entry")
            .and_then(Value::as_str)
            .filter(|entry| !entry.is_empty())
            .ok_or_else(|| eyre!("manifest window {name} has no entry"))?;
        ensure!(
            !entry.contains('/') && entry.ends_with(".html"),
            "window {name} has an entry that is not an .html file at the package root: {entry}"
        );
        let contents = files
            .get(entry)
            .ok_or_else(|| eyre!("window {name} has no entry {entry} in the package"))?;
        let find = |marker: &str| {
            contents
                .windows(marker.len())
                .position(|window| window == marker.as_bytes())
        };
        ensure!(
            matches!((find(HEAD_MARKER), find(KITS_MARKER)), (Some(head), Some(kits)) if head < kits),
            "window entry {entry} lacks the {HEAD_MARKER} and {KITS_MARKER} markers in that order"
        );
        ensure!(
            names.insert(name) && entries.insert(entry),
            "manifest.json lists window {name} or {entry} twice"
        );
    }
    Ok(())
}

fn is_plain_relative_path(path: &str) -> bool {
    !path.is_empty()
        && !path.contains(['\\', '\0'])
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

fn is_valid_content_type(content_type: &str) -> bool {
    content_type.len() <= 128
        && content_type
            .bytes()
            .all(|byte| (0x21..=0x7e).contains(&byte) || byte == b' ')
        && !content_type.starts_with(' ')
        && !content_type.ends_with(' ')
        && content_type
            .split_once('/')
            .is_some_and(|(kind, subtype)| !kind.is_empty() && !subtype.is_empty())
}

fn required_string(manifest: &Map<String, Value>, key: &str) -> Result<String> {
    manifest
        .get(key)
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| eyre!("manifest.json has no {key}"))
}

fn required_u64(manifest: &Map<String, Value>, key: &str) -> Result<u64> {
    manifest
        .get(key)
        .and_then(Value::as_u64)
        .ok_or_else(|| eyre!("manifest.json has no {key}"))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn content_type_for(path: &str) -> &'static str {
    match path.rsplit_once('.').map(|(_, extension)| extension) {
        Some("css") => "text/css; charset=utf-8",
        Some("html") => "text/html; charset=utf-8",
        Some("ico") => "image/x-icon",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("txt") => "text/plain; charset=utf-8",
        Some("wasm") => "application/wasm",
        Some("webp") => "image/webp",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    }
}

/// The locale of a catalog path `.../locales/<locale>/messages.{json,po}`.
fn catalog_locale(path: &str) -> Option<&str> {
    let (directory, file) = path.rsplit_once('/')?;
    if file != "messages.json" && file != "messages.po" {
        return None;
    }
    let (parent, locale) = directory.rsplit_once('/')?;
    (parent.ends_with("locales") || parent == "locales").then_some(locale)
}

/// The deployment package: its archive and manifest as served, and the
/// identity sidecars compare.
#[derive(Debug)]
pub struct DesktopUiPackage {
    pub archive: Bytes,
    pub manifest: Bytes,
    pub digest: String,
    pub version: String,
    pub host_api: u64,
    pub total_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileEntry {
    bytes: u64,
    content_type: String,
    path: String,
    sha256: String,
}

/// Assembles the deployment package when the distribution ships a `ui`
/// artifact, logging instead of failing: a package that cannot be built is
/// not served.
#[must_use]
pub fn assemble_for_state(
    config: &AppConfig,
    distribution: &Distribution,
    overrides: &DistributionBundle,
) -> Option<Arc<DesktopUiPackage>> {
    let artifact = distribution
        .desktop_sidecar
        .as_ref()
        .and_then(|sidecar| sidecar.ui())?;
    match assemble(
        artifact,
        config,
        distribution,
        overrides,
        PACKAGE_BUDGET_BYTES,
        PACKAGE_MAX_ARCHIVE_BYTES,
    ) {
        Ok(package) => {
            tracing::info!(
                version = %package.version,
                digest = %package.digest,
                total_bytes = package.total_bytes,
                "Assembled the desktop UI package"
            );
            Some(Arc::new(package))
        }
        Err(error) => {
            tracing::error!(%error, "Failed to assemble the desktop UI package; it is not served");
            None
        }
    }
}

pub fn assemble(
    artifact: &DesktopUiArtifact,
    config: &AppConfig,
    distribution: &Distribution,
    overrides: &DistributionBundle,
    budget: u64,
    max_archive_bytes: u64,
) -> Result<DesktopUiPackage> {
    let bundle = &artifact.bundle;
    let mut assembly = Assembly {
        files: bundle.files.clone(),
        translations: &distribution.translations,
    };
    let main_root = distribution.frontend_bundles.main.root().to_path_buf();

    let mut catalog_locales = BTreeSet::new();
    for root in [
        main_root.join(COMMON_LOCALES_PATH),
        main_root.join("locales"),
    ] {
        catalog_locales.extend(assembly.add_directory(&root, COMMON_LOCALES_PATH)?);
    }

    let mut override_locales = Vec::new();
    for locale in overrides.translation_locales() {
        match overrides.compiled_translation(&format!("overrides/{locale}.po")) {
            Some(Ok(compiled)) => {
                assembly.insert(format!("{OVERRIDES_PATH}/{locale}.json"), compiled.to_vec())?;
                override_locales.push(locale.to_owned());
            }
            Some(Err(error)) => tracing::warn!(
                locale,
                %error,
                "Runtime translation override is left out of the desktop UI package"
            ),
            None => {}
        }
    }
    assembly.insert(
        format!("{OVERRIDES_PATH}/index.json"),
        serde_json::to_vec(&json!({ "locales": override_locales }))?,
    )?;

    let theme = config
        .frontend
        .theme
        .as_deref()
        .filter(|theme| is_plain_relative_path(theme) && !theme.contains('/'));
    if let Some(theme) = theme {
        let prefix = format!("{THEMES_PATH}/{theme}");
        for root in [
            main_root.join("custom-theme").join(theme),
            main_root.join(THEMES_PATH).join(theme),
        ] {
            assembly.add_directory(&root, &prefix)?;
        }
    }

    let mut kits = Vec::new();
    for kit in distribution.component_kits.kits() {
        let locales = assembly.add_directory(&kit.root, &format!("{KITS_PATH}/{}", kit.name))?;
        kits.push(json!({
            "name": kit.name,
            "script": kit.script_path,
            "stylesheet": kit.stylesheet_path,
            "locales": locales,
        }));
    }

    let env = composition_env(config, theme);
    for path in env.values().filter_map(Value::as_str) {
        assembly.add_public_file(distribution, path);
    }

    let import_map = match assembly
        .files
        .get(IMPORT_MAP_MANIFEST_PATH)
        .map(|file| serde_json::from_slice::<Value>(&file.bytes))
    {
        Some(Ok(manifest)) => match manifest.get("imports").and_then(Value::as_object) {
            Some(imports) => serde_json::from_str(&serialize_import_map(imports, APP_MOUNT_PATH))?,
            None => bail!("{IMPORT_MAP_MANIFEST_PATH} has no imports object"),
        },
        Some(Err(error)) => bail!("{IMPORT_MAP_MANIFEST_PATH} is not valid JSON: {error}"),
        None => {
            tracing::warn!("The desktop UI bundle ships no {IMPORT_MAP_MANIFEST_PATH}");
            json!({ "imports": {} })
        }
    };

    let mut entries = Vec::with_capacity(assembly.files.len());
    let mut total_bytes = 0_u64;
    for (path, file) in &assembly.files {
        let bytes = file.bytes.len() as u64;
        total_bytes += bytes;
        entries.push(FileEntry {
            bytes,
            content_type: file.content_type.clone(),
            path: path.clone(),
            sha256: hex(&Sha256::digest(&file.bytes)),
        });
    }
    ensure!(
        total_bytes <= budget,
        "the desktop UI package is {total_bytes} bytes; the budget is {budget}"
    );
    if total_bytes > budget - budget / 4 {
        tracing::warn!(
            total_bytes,
            budget,
            "The desktop UI package exceeds 75 percent of its budget"
        );
    }
    let digest = hex(&Sha256::digest(serde_json::to_vec(&entries)?));

    let mut manifest = bundle.manifest.clone();
    manifest.insert("files".into(), serde_json::to_value(&entries)?);
    manifest.insert("totalBytes".into(), json!(total_bytes));
    manifest.insert(
        "composition".into(),
        json!({
            "env": env,
            "importMap": import_map,
            "kits": kits,
            "windows": bundle.windows(),
        }),
    );
    manifest.insert(
        "parts".into(),
        json!({
            "app": {
                "version": bundle.version,
                "commit": bundle.commit,
                "library": bundle.library_commit,
            },
            "theme": theme.map(|name| json!({ "name": name })),
            "catalogs": { "locales": catalog_locales },
            "overrides": { "present": !override_locales.is_empty() },
            "kits": distribution
                .component_kits
                .kits()
                .iter()
                .map(|kit| json!({ "name": kit.name }))
                .collect::<Vec<_>>(),
        }),
    );
    manifest.insert("digest".into(), json!(digest));
    let manifest = serde_json::to_vec_pretty(&Value::Object(manifest))?;

    let archive = pack(&bundle.package_json, &manifest, &assembly.files)?;
    let archive_bytes = archive.len() as u64;
    ensure!(
        archive_bytes <= max_archive_bytes,
        "the desktop UI package archive is {archive_bytes} bytes compressed; the archive cap is {max_archive_bytes}"
    );
    Ok(DesktopUiPackage {
        archive: archive.into(),
        manifest: manifest.into(),
        digest,
        version: bundle.version.clone(),
        host_api: bundle.host_api,
        total_bytes,
    })
}

fn composition_env(config: &AppConfig, theme: Option<&str>) -> Map<String, Value> {
    let mut env = Map::new();
    env.insert("FRONTEND_PLATFORM".into(), json!(FRONTEND_PLATFORM));
    env.insert("FRONTEND_PUBLIC_BASE_PATH".into(), json!(APP_MOUNT_PATH));
    env.insert("COMMON_PUBLIC_BASE_PATH".into(), json!("/public/common"));
    if let Some(theme) = theme {
        env.insert("THEME_CUSTOMER_NAME".into(), json!(theme));
    }
    env.insert("FAVICON_PATH".into(), json!(config.frontend.favicon_path));
    for (key, path) in [
        ("THEME_LOGO_PATH", &config.frontend.logo_path),
        ("THEME_LOGO_DARK_PATH", &config.frontend.logo_dark_path),
        (
            "THEME_ASSISTANT_AVATAR_PATH",
            &config.frontend.assistant_avatar_path,
        ),
        ("SIDEBAR_LOGO_PATH", &config.frontend.sidebar_logo_path),
        (
            "SIDEBAR_LOGO_DARK_PATH",
            &config.frontend.sidebar_logo_dark_path,
        ),
    ] {
        if let Some(path) = path {
            env.insert(key.into(), json!(path));
        }
    }
    for key in ["THEME_PATH", "THEME_CONFIG_PATH"] {
        if let Some(value) = config.frontend.additional_environment.get(key) {
            env.insert(key.into(), value.clone());
        }
    }
    env
}

struct Assembly<'a> {
    files: BTreeMap<String, PackageFile>,
    translations: &'a TranslationDistribution,
}

impl Assembly<'_> {
    fn insert(&mut self, path: String, bytes: Vec<u8>) -> Result<()> {
        ensure!(
            is_plain_relative_path(&path)
                && !PACKAGE_FILES.contains(&path.as_str())
                && !path.ends_with(".map"),
            "desktop UI package path is invalid: {path:?}"
        );
        let content_type = content_type_for(&path).to_owned();
        self.files.insert(
            path,
            PackageFile {
                bytes,
                content_type,
            },
        );
        Ok(())
    }

    fn add_if_absent(&mut self, path: String, bytes: Vec<u8>) -> Result<()> {
        if self.files.contains_key(&path) {
            return Ok(());
        }
        self.insert(path, bytes)
    }

    /// Adds every file below `root` under `prefix`: earlier roots win, and a
    /// PO catalog source beats a prebuilt JSON next to it, as just-in-time
    /// serving does. Symlinks are followed within the root (a ConfigMap mount
    /// links `theme.json` into `..data/`); Kubernetes' `..` directories and
    /// links that escape the root are left out. Returns the catalog locales.
    fn add_directory(&mut self, root: &Path, prefix: &str) -> Result<BTreeSet<String>> {
        let mut locales = BTreeSet::new();
        let Ok(canonical_root) = root.canonicalize() else {
            return Ok(locales);
        };
        if !canonical_root.is_dir() {
            return Ok(locales);
        }
        let mut sources = Vec::new();
        let mut visited = BTreeSet::from([canonical_root.clone()]);
        let mut pending = vec![(root.to_path_buf(), String::new())];
        while let Some((directory, relative)) = pending.pop() {
            let mut entries = fs::read_dir(&directory)
                .wrap_err_with(|| format!("Failed to read {}", directory.display()))?
                .collect::<std::io::Result<Vec<_>>>()?;
            entries.sort_by_key(fs::DirEntry::path);
            for entry in entries {
                let path = entry.path();
                let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                    tracing::warn!(path = %path.display(), "Skipping a non-UTF-8 file name in the desktop UI package sources");
                    continue;
                };
                let Ok(canonical) = path.canonicalize() else {
                    tracing::debug!(path = %path.display(), "Skipping an unresolvable entry in the desktop UI package sources");
                    continue;
                };
                if !canonical.starts_with(&canonical_root) {
                    tracing::warn!(path = %path.display(), "Skipping a link outside its root in the desktop UI package sources");
                    continue;
                }
                let relative = if relative.is_empty() {
                    name.clone()
                } else {
                    format!("{relative}/{name}")
                };
                if canonical.is_dir() {
                    if !name.starts_with("..") && visited.insert(canonical) {
                        pending.push((path, relative));
                    }
                    continue;
                }
                if !canonical.is_file() || relative.ends_with(".map") {
                    continue;
                }
                sources.push((relative, path));
            }
        }
        sources.sort_by_key(|(relative, _)| !relative.ends_with(".po"));
        for (relative, source) in sources {
            let path = format!("{prefix}/{relative}");
            let locale = catalog_locale(&path).map(str::to_owned);
            if relative.ends_with(".po") {
                let Some(locale) = locale else {
                    continue;
                };
                let target = format!("{}.json", path.trim_end_matches(".po"));
                if self.files.contains_key(&target) {
                    locales.insert(locale);
                    continue;
                }
                if let Some(compiled) = self.translations.compile_messages_json_source(&source) {
                    let compiled = compiled
                        .wrap_err_with(|| format!("Failed to compile {}", source.display()))?;
                    self.insert(target, compiled.body)?;
                    locales.insert(locale);
                }
                continue;
            }
            let bytes = fs::read(&source)
                .wrap_err_with(|| format!("Failed to read {}", source.display()))?;
            if let Some(locale) = locale {
                locales.insert(locale);
            }
            self.add_if_absent(path, bytes)?;
        }
        Ok(locales)
    }

    /// Adds the file a public browser path names, from the parts the backend
    /// serves it from, so the window finds the same file at the same path.
    fn add_public_file(&mut self, distribution: &Distribution, public_path: &str) {
        let Some(relative) = public_path.strip_prefix('/') else {
            return;
        };
        if relative.starts_with('/') || !is_plain_relative_path(relative) {
            return;
        }
        if self.files.contains_key(relative) {
            return;
        }
        let branding = &distribution.branding;
        let source = match relative {
            "favicon.svg" | "favicon.ico" => branding.favicon_source(false, relative),
            _ if relative.starts_with("public/common/") => {
                branding.resolve_source(public_path, false)
            }
            _ => contained_file(distribution.frontend_bundles.main.root(), relative)
                .ok_or_else(|| eyre!("not a file of the web bundle")),
        };
        match source.and_then(|source| fs::read(&source).map_err(Into::into)) {
            Ok(bytes) => {
                if let Err(error) = self.insert(relative.to_owned(), bytes) {
                    tracing::warn!(public_path, %error, "Branding file is left out of the desktop UI package");
                }
            }
            Err(error) => tracing::debug!(
                public_path,
                %error,
                "Branding path has no local file for the desktop UI package"
            ),
        }
    }
}

fn contained_file(root: &Path, relative: &str) -> Option<PathBuf> {
    let root = root.canonicalize().ok()?;
    let path = root.join(relative).canonicalize().ok()?;
    (path.starts_with(root) && path.is_file()).then_some(path)
}

fn pack(
    package_json: &[u8],
    manifest: &[u8],
    files: &BTreeMap<String, PackageFile>,
) -> Result<Vec<u8>> {
    let mut builder = tar::Builder::new(GzEncoder::new(Vec::new(), Compression::default()));
    let mut append = |path: &str, bytes: &[u8]| -> Result<()> {
        let mut header = tar::Header::new_gnu();
        header.set_size(bytes.len() as u64);
        header.set_mode(0o644);
        header.set_mtime(0);
        builder
            .append_data(&mut header, format!("{PACKAGE_ROOT}/{path}"), bytes)
            .wrap_err_with(|| format!("Failed to add {path} to the desktop UI package"))
    };
    append("package.json", package_json)?;
    append("manifest.json", manifest)?;
    for (path, file) in files {
        append(path, &file.bytes)?;
    }
    let encoder = builder
        .into_inner()
        .wrap_err("Failed to finish the desktop UI package archive")?;
    encoder
        .finish()
        .wrap_err("Failed to compress the desktop UI package archive")
}

/// The key the package token is signed with, derived from the deployment's
/// `server.encryption_key` so every replica issues and accepts the same tokens.
#[derive(Clone)]
pub struct PackageTokenKey([u8; 32]);

impl fmt::Debug for PackageTokenKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("PackageTokenKey(..)")
    }
}

impl PackageTokenKey {
    #[must_use]
    pub fn from_config(config: &AppConfig) -> Option<Self> {
        let secret = config.server.encryption_key.as_ref()?;
        let decoded = STANDARD.decode(secret.expose_secret()).ok()?;
        let mut mac = Hmac::<Sha256>::new_from_slice(&decoded).ok()?;
        mac.update(TOKEN_KEY_LABEL);
        Some(Self(mac.finalize().into_bytes().into()))
    }

    #[cfg(test)]
    pub(crate) fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    /// A token valid until `now` plus [`TOKEN_TTL_SECONDS`], and that expiry.
    #[must_use]
    pub fn issue(&self, now: DateTime<Utc>) -> (String, DateTime<Utc>) {
        let expires_at = now + TimeDelta::seconds(TOKEN_TTL_SECONDS);
        let expiry = expires_at.timestamp();
        let token = format!("{expiry}.{}", URL_SAFE_NO_PAD.encode(self.tag(expiry)));
        (token, expires_at)
    }

    #[must_use]
    pub fn verify(&self, token: &str, now: DateTime<Utc>) -> bool {
        let Some((expiry_text, tag)) = token.split_once('.') else {
            return false;
        };
        let Ok(expiry) = expiry_text.parse::<i64>() else {
            return false;
        };
        if expiry.to_string() != expiry_text {
            return false;
        }
        let Ok(tag) = URL_SAFE_NO_PAD.decode(tag) else {
            return false;
        };
        expiry > now.timestamp() && self.mac(expiry).verify_slice(&tag).is_ok()
    }

    fn mac(&self, expiry: i64) -> Hmac<Sha256> {
        let mut mac = Hmac::<Sha256>::new_from_slice(&self.0).expect("HMAC accepts any key size");
        mac.update(TOKEN_PURPOSE.as_bytes());
        mac.update(b"\n");
        mac.update(expiry.to_string().as_bytes());
        mac
    }

    fn tag(&self, expiry: i64) -> [u8; 32] {
        self.mac(expiry).finalize().into_bytes().into()
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::config::TranslationPoCompilationMode;
    use crate::distribution::component_kits::ComponentKitDistribution;
    use crate::distribution::frontend_bundles::FrontendBundles;
    use crate::distribution::runtime::DistributionFile;

    /// A small valid bundle as the sidecar's packer would write it: one
    /// window, one asset, one catalog and the kit-host import map.
    pub(crate) fn fixture_archive() -> Vec<u8> {
        fixture_archive_with(|_| {})
    }

    pub(crate) fn fixture_archive_with(edit: impl FnOnce(&mut Map<String, Value>)) -> Vec<u8> {
        let mut files = BTreeMap::new();
        files.insert(
            "smoke.html".to_owned(),
            format!(
                "<!doctype html><html><head>{HEAD_MARKER}\n<link rel=\"modulepreload\" href=\"{APP_MOUNT_PATH}/assets/app.js\">{KITS_MARKER}\n<script type=\"module\" src=\"{APP_MOUNT_PATH}/assets/app.js\"></script></head><body></body></html>"
            )
            .into_bytes(),
        );
        files.insert(
            "public/platform-desktop-ui/assets/app.js".to_owned(),
            b"console.log('app');".to_vec(),
        );
        files.insert(
            "public/platform-desktop-ui/assets/shared-react.js".to_owned(),
            b"export default {};".to_vec(),
        );
        files.insert(
            "public/platform-desktop-ui/locales/en/messages.json".to_owned(),
            br#"{"messages":{"hello":"Hello"}}"#.to_vec(),
        );
        files.insert(
            IMPORT_MAP_MANIFEST_PATH.to_owned(),
            br#"{"imports":{"react":"assets/shared-react.js"}}"#.to_vec(),
        );
        let entries = files
            .iter()
            .map(|(path, bytes)| FileEntry {
                bytes: bytes.len() as u64,
                content_type: content_type_for(path).to_owned(),
                path: path.clone(),
                sha256: hex(&Sha256::digest(bytes)),
            })
            .collect::<Vec<_>>();
        let mut manifest = json!({
            "format": FORMAT,
            "hostApi": HOST_API,
            "name": "erato-desktop-ui",
            "version": "0.1.0",
            "commit": "0123456789abcdef0123456789abcdef01234567",
            "library": { "commit": "fedcba9876543210fedcba9876543210fedcba98" },
            "windows": [{ "name": "smoke", "entry": "smoke.html" }],
            "files": entries,
            "totalBytes": files.values().map(|bytes| bytes.len() as u64).sum::<u64>(),
        });
        edit(manifest.as_object_mut().unwrap());
        let package_json = serde_json::to_vec(&json!({
            "name": manifest["name"],
            "version": manifest["version"],
            "private": true,
        }))
        .unwrap();
        let files = files
            .into_iter()
            .map(|(path, bytes)| {
                let content_type = content_type_for(&path).to_owned();
                (
                    path,
                    PackageFile {
                        bytes,
                        content_type,
                    },
                )
            })
            .collect();
        pack(
            &package_json,
            &serde_json::to_vec(&manifest).unwrap(),
            &files,
        )
        .unwrap()
    }

    fn fixture_artifact() -> DesktopUiArtifact {
        DesktopUiArtifact {
            version: "0.1.0".into(),
            bundle: DesktopUiBundle::from_archive(&fixture_archive()).unwrap(),
        }
    }

    fn write(path: &Path, contents: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents).unwrap();
    }

    /// A web bundle with common catalogs, the `acme` theme in both mounts and
    /// one kit, and a config that selects the theme in just-in-time mode.
    fn deployment(dir: &Path) -> (AppConfig, Distribution) {
        let web = dir.join("web");
        write(
            &web.join("public/common/locales/en/messages.json"),
            br#"{"messages":{"a":"A"}}"#,
        );
        write(
            &web.join("public/common/locales/de/messages.po"),
            b"msgid \"a\"\nmsgstr \"A (de)\"\n",
        );
        write(
            &web.join("public/common/locales/de/messages.json"),
            b"stale",
        );
        write(
            &web.join("public/common/custom-theme/acme/theme.json"),
            b"built",
        );
        write(
            &web.join("public/common/custom-theme/acme/locales/de/messages.po"),
            b"msgid \"t\"\nmsgstr \"T\"\n",
        );
        write(
            &web.join("locales/en/messages.po"),
            b"msgid \"a\"\nmsgstr \"A (later root)\"\n",
        );
        write(&web.join("custom-theme/acme/theme.json"), b"runtime");
        write(&web.join("custom-theme/acme/logo.svg"), b"<svg/>");
        write(&web.join("favicon.svg"), b"<svg>favicon</svg>");
        write(&web.join("typed.svg"), b"<svg>typed</svg>");
        write(&web.join("sources.map"), b"map");
        let kits = dir.join("kits");
        write(&kits.join("example/index-abc.js"), b"kit");
        write(&kits.join("example/style.css"), b"kit css");
        write(
            &kits.join("example/locales/en/messages.json"),
            br#"{"messages":{"k":"K"}}"#,
        );
        write(&kits.join("example/sources.map"), b"map");

        let mut config = AppConfig::default();
        config.frontend.web_frontend_bundle_path = web.to_string_lossy().into_owned();
        config.frontend.component_kits.directory = kits.to_string_lossy().into_owned();
        config.frontend.theme = Some("acme".into());
        config.frontend.logo_path = Some("/typed.svg".into());
        config.frontend.logo_dark_path = Some("/public/common/custom-theme/acme/logo.svg".into());
        config.frontend.sidebar_logo_path = Some("/sources.map".into());
        config.frontend.translation_po_compilation_mode = TranslationPoCompilationMode::JustInTime;
        config.frontend.additional_environment.insert(
            "THEME_PATH".into(),
            json!("/public/common/custom-theme/acme"),
        );
        let frontend_bundles = FrontendBundles::from_config(&config);
        let component_kits = ComponentKitDistribution::discover(kits);
        let translations =
            TranslationDistribution::discover(&config, &frontend_bundles, &component_kits);
        let distribution = Distribution {
            branding: crate::distribution::branding::BrandingAssets::from_config(&config),
            frontend_bundles,
            component_kits,
            translations,
            desktop_sidecar: None,
            teams_app: None,
        };
        (config, distribution)
    }

    fn manifest_of(package: &DesktopUiPackage) -> Value {
        serde_json::from_slice(&package.manifest).unwrap()
    }

    #[test]
    fn the_fixture_archive_passes_the_contract() {
        let bundle = DesktopUiBundle::from_archive(&fixture_archive()).unwrap();
        assert_eq!(bundle.version, "0.1.0");
        assert_eq!(bundle.host_api, HOST_API);
        assert_eq!(bundle.windows()[0]["entry"], "smoke.html");
        assert_eq!(bundle.files.len(), 5);
    }

    #[test]
    fn the_contract_rejects_broken_bundles() {
        for (edit, message) in [
            (
                Box::new(|manifest: &mut Map<String, Value>| {
                    manifest.insert("format".into(), json!(2));
                }) as Box<dyn FnOnce(&mut Map<String, Value>)>,
                "format 2",
            ),
            (
                Box::new(|manifest| {
                    manifest.insert("hostApi".into(), json!(2));
                }),
                "host API 2",
            ),
            (
                Box::new(|manifest| {
                    manifest["files"][0]["sha256"] = json!("0".repeat(64));
                }),
                "does not match its SHA-256",
            ),
            (
                Box::new(|manifest| {
                    manifest.insert("totalBytes".into(), json!(1));
                }),
                "totalBytes",
            ),
            (
                Box::new(|manifest| {
                    manifest["windows"][0]["entry"] = json!("missing.html");
                }),
                "no entry missing.html",
            ),
            (
                Box::new(|manifest| {
                    manifest.remove("library");
                }),
                "library.commit",
            ),
        ] {
            let error = DesktopUiBundle::from_archive(&fixture_archive_with(edit))
                .unwrap_err()
                .to_string();
            assert!(error.contains(message), "{error}");
        }
        assert!(DesktopUiBundle::from_archive(b"not an archive").is_err());
    }

    #[test]
    fn assembles_the_deployment_package_from_the_parts_the_backend_serves() {
        let dir = tempfile::tempdir().unwrap();
        let (config, distribution) = deployment(dir.path());
        let overrides = DistributionBundle::from_files(vec![
            DistributionFile {
                filename: "overrides/de.po".into(),
                contents: "msgid \"a\"\nmsgstr \"A (override)\"\n".into(),
            },
            DistributionFile {
                filename: "overrides/fr.po".into(),
                contents: "msgid unquoted".into(),
            },
        ]);
        let package = assemble(
            &fixture_artifact(),
            &config,
            &distribution,
            &overrides,
            PACKAGE_BUDGET_BYTES,
            PACKAGE_MAX_ARCHIVE_BYTES,
        )
        .unwrap();

        let served = DesktopUiBundle::from_archive(&package.archive).unwrap();
        assert_eq!(served.version, "0.1.0");
        let manifest = manifest_of(&package);
        assert_eq!(manifest["format"], FORMAT);
        assert_eq!(manifest["hostApi"], HOST_API);
        assert_eq!(manifest["digest"], package.digest);
        assert_eq!(manifest["totalBytes"], package.total_bytes);
        let files = manifest["files"].as_array().unwrap();
        let digest = hex(&Sha256::digest(
            serde_json::to_vec(
                &files
                    .iter()
                    .map(|entry| FileEntry {
                        bytes: entry["bytes"].as_u64().unwrap(),
                        content_type: entry["contentType"].as_str().unwrap().into(),
                        path: entry["path"].as_str().unwrap().into(),
                        sha256: entry["sha256"].as_str().unwrap().into(),
                    })
                    .collect::<Vec<_>>(),
            )
            .unwrap(),
        ));
        assert_eq!(package.digest, digest);

        let text = |path: &str| {
            String::from_utf8(
                served
                    .file_bytes(path)
                    .unwrap_or_else(|| panic!("{path}"))
                    .to_vec(),
            )
            .unwrap()
        };
        assert_eq!(
            text("public/platform-desktop-ui/assets/app.js"),
            "console.log('app');"
        );
        assert!(text("smoke.html").contains(HEAD_MARKER));
        assert_eq!(
            text("public/common/locales/en/messages.json"),
            r#"{"messages":{"a":"A"}}"#
        );
        assert!(text("public/common/locales/de/messages.json").contains("A (de)"));
        assert!(text("public/common/overrides/de.json").contains("A (override)"));
        assert_eq!(
            text("public/common/overrides/index.json"),
            r#"{"locales":["de"]}"#
        );
        assert!(
            served
                .file_bytes("public/common/overrides/fr.json")
                .is_none()
        );
        assert_eq!(
            text("public/common/custom-theme/acme/theme.json"),
            "runtime"
        );
        assert_eq!(text("public/common/custom-theme/acme/logo.svg"), "<svg/>");
        assert!(text("public/common/custom-theme/acme/locales/de/messages.json").contains("\"T\""));
        assert!(
            served
                .file_bytes("public/common/custom-theme/acme/locales/de/messages.po")
                .is_none()
        );
        assert_eq!(text("public/component-kits/example/index-abc.js"), "kit");
        assert_eq!(text("public/component-kits/example/style.css"), "kit css");
        assert!(
            served
                .file_bytes("public/component-kits/example/sources.map")
                .is_none()
        );
        assert_eq!(text("favicon.svg"), "<svg>favicon</svg>");
        assert_eq!(text("typed.svg"), "<svg>typed</svg>");
        assert!(served.file_bytes("sources.map").is_none());

        let composition = &manifest["composition"];
        assert_eq!(composition["env"]["FRONTEND_PLATFORM"], FRONTEND_PLATFORM);
        assert_eq!(
            composition["env"]["FRONTEND_PUBLIC_BASE_PATH"],
            APP_MOUNT_PATH
        );
        assert_eq!(
            composition["env"]["COMMON_PUBLIC_BASE_PATH"],
            "/public/common"
        );
        assert_eq!(composition["env"]["THEME_CUSTOMER_NAME"], "acme");
        assert_eq!(composition["env"]["FAVICON_PATH"], "/favicon.svg");
        assert_eq!(composition["env"]["THEME_LOGO_PATH"], "/typed.svg");
        assert_eq!(
            composition["env"]["THEME_PATH"],
            "/public/common/custom-theme/acme"
        );
        assert_eq!(
            composition["importMap"]["imports"]["react"],
            "/public/platform-desktop-ui/assets/shared-react.js"
        );
        assert_eq!(
            composition["kits"],
            json!([{
                "name": "example",
                "script": "/public/component-kits/example/index-abc.js",
                "stylesheet": "/public/component-kits/example/style.css",
                "locales": ["en"],
            }])
        );
        assert_eq!(
            composition["windows"],
            json!([{ "name": "smoke", "entry": "smoke.html" }])
        );
        assert_eq!(
            manifest["parts"],
            json!({
                "app": {
                    "version": "0.1.0",
                    "commit": "0123456789abcdef0123456789abcdef01234567",
                    "library": "fedcba9876543210fedcba9876543210fedcba98",
                },
                "theme": { "name": "acme" },
                "catalogs": { "locales": ["de", "en"] },
                "overrides": { "present": true },
                "kits": [{ "name": "example" }],
            })
        );
    }

    #[test]
    fn a_deployment_without_theme_kits_or_overrides_still_assembles() {
        let dir = tempfile::tempdir().unwrap();
        let mut config = AppConfig::default();
        config.frontend.web_frontend_bundle_path =
            dir.path().join("missing").to_string_lossy().into_owned();
        config.frontend.component_kits.directory =
            dir.path().join("no-kits").to_string_lossy().into_owned();
        let distribution = Distribution::load(&config);
        let package = assemble(
            &fixture_artifact(),
            &config,
            &distribution,
            &DistributionBundle::default(),
            PACKAGE_BUDGET_BYTES,
            PACKAGE_MAX_ARCHIVE_BYTES,
        )
        .unwrap();
        let manifest = manifest_of(&package);
        assert_eq!(manifest["parts"]["theme"], Value::Null);
        assert_eq!(manifest["parts"]["kits"], json!([]));
        assert_eq!(manifest["parts"]["overrides"]["present"], false);
        assert_eq!(manifest["parts"]["catalogs"]["locales"], json!([]));
        assert!(
            manifest["composition"]["env"]
                .get("THEME_CUSTOMER_NAME")
                .is_none()
        );
        let served = DesktopUiBundle::from_archive(&package.archive).unwrap();
        assert_eq!(
            served
                .file_bytes("public/common/overrides/index.json")
                .unwrap(),
            br#"{"locales":[]}"#
        );
    }

    #[cfg(unix)]
    #[test]
    fn packs_a_configmap_mounted_theme_at_its_logical_paths() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let web = dir.path().join("web");
        let theme = web.join("custom-theme/acme");
        let data = theme.join("..2026_01_01_00_00_00.000000000");
        write(&data.join("theme.json"), b"mounted");
        write(
            &data.join("locales/de/messages.json"),
            br#"{"messages":{"t":"T"}}"#,
        );
        symlink(data.file_name().unwrap(), theme.join("..data")).unwrap();
        symlink("..data/theme.json", theme.join("theme.json")).unwrap();
        symlink("..data/locales", theme.join("locales")).unwrap();
        write(&dir.path().join("secret.json"), b"secret");
        symlink(dir.path().join("secret.json"), theme.join("leak.json")).unwrap();
        symlink(".", theme.join("loop")).unwrap();
        symlink("missing.json", theme.join("dangling.json")).unwrap();

        let mut config = AppConfig::default();
        config.frontend.web_frontend_bundle_path = web.to_string_lossy().into_owned();
        config.frontend.component_kits.directory =
            dir.path().join("no-kits").to_string_lossy().into_owned();
        config.frontend.theme = Some("acme".into());
        let distribution = Distribution::load(&config);
        let package = assemble(
            &fixture_artifact(),
            &config,
            &distribution,
            &DistributionBundle::default(),
            PACKAGE_BUDGET_BYTES,
            PACKAGE_MAX_ARCHIVE_BYTES,
        )
        .unwrap();
        let served = DesktopUiBundle::from_archive(&package.archive).unwrap();
        let theme_files = served
            .file_paths()
            .into_iter()
            .filter(|path| path.starts_with("public/common/custom-theme/"))
            .collect::<Vec<_>>();
        assert_eq!(
            theme_files,
            [
                "public/common/custom-theme/acme/locales/de/messages.json",
                "public/common/custom-theme/acme/theme.json",
            ]
        );
        assert_eq!(
            served.file_bytes("public/common/custom-theme/acme/theme.json"),
            Some(b"mounted".as_slice())
        );
    }

    #[test]
    fn a_package_over_budget_is_an_error() {
        assert_eq!(PACKAGE_BUDGET_BYTES, 16_777_216);
        let dir = tempfile::tempdir().unwrap();
        let (config, distribution) = deployment(dir.path());
        let error = assemble(
            &fixture_artifact(),
            &config,
            &distribution,
            &DistributionBundle::default(),
            64,
            PACKAGE_MAX_ARCHIVE_BYTES,
        )
        .unwrap_err()
        .to_string();
        assert!(error.contains("the budget is 64"), "{error}");
    }

    #[test]
    fn a_package_archive_over_the_relay_cap_is_an_error() {
        assert_eq!(PACKAGE_MAX_ARCHIVE_BYTES, 9_437_184);
        let dir = tempfile::tempdir().unwrap();
        let (config, distribution) = deployment(dir.path());
        let error = assemble(
            &fixture_artifact(),
            &config,
            &distribution,
            &DistributionBundle::default(),
            PACKAGE_BUDGET_BYTES,
            64,
        )
        .unwrap_err()
        .to_string();
        assert!(error.contains("the archive cap is 64"), "{error}");
    }

    #[test]
    fn the_package_token_round_trips_and_expires() {
        let key = PackageTokenKey::from_bytes(rand::random());
        let now = Utc::now();
        let (token, expires_at) = key.issue(now);
        assert_eq!(expires_at - now, TimeDelta::seconds(TOKEN_TTL_SECONDS));
        assert!(key.verify(&token, now));
        assert!(key.verify(&token, expires_at - TimeDelta::seconds(1)));
        assert!(!key.verify(&token, expires_at));
        assert!(!key.verify(&format!("{token}x"), now));
        assert!(!key.verify(&token.replacen('.', "0.", 1), now));
        let (expiry, tag) = token.split_once('.').unwrap();
        assert!(!key.verify(&format!("+{expiry}.{tag}"), now));
        assert!(!key.verify(&format!("0{expiry}.{tag}"), now));
        assert!(!key.verify("", now));
        assert!(!key.verify("not-a-token", now));
        assert!(!PackageTokenKey::from_bytes(rand::random()).verify(&token, now));

        let mut config = AppConfig::default();
        assert!(PackageTokenKey::from_config(&config).is_none());
        config.server.encryption_key = Some(STANDARD.encode([1; 32]).into());
        let derived = PackageTokenKey::from_config(&config).unwrap();
        let (token, _) = derived.issue(now);
        assert!(derived.verify(&token, now));
        assert!(
            PackageTokenKey::from_config(&config)
                .unwrap()
                .verify(&token, now)
        );
        assert_ne!(derived.0, [1; 32]);
    }

    #[test]
    fn catalog_paths_name_their_locale() {
        assert_eq!(
            catalog_locale("public/common/locales/de/messages.json"),
            Some("de")
        );
        assert_eq!(
            catalog_locale("public/component-kits/x/locales/en-US/messages.po"),
            Some("en-US")
        );
        assert_eq!(catalog_locale("public/common/locales/de/other.json"), None);
        assert_eq!(catalog_locale("public/common/de/messages.json"), None);
    }
}
