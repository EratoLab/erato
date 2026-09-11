//! Personalize the macOS application ZIP without changing its Mach-O executable.

use std::collections::HashSet;
use std::io::{Cursor, Read, Seek, SeekFrom, Write};
use std::{fmt, fs::File, sync::Arc};

use eyre::{Context, Result, ensure};
use zip::{CompressionMethod, ZipArchive, ZipWriter, write::SimpleFileOptions};

const EXECUTABLE: &str = "erato-desktop-sidecar.app/Contents/MacOS/erato-desktop-sidecar";
const INFO_PLIST: &str = "erato-desktop-sidecar.app/Contents/Info.plist";
const BOOTSTRAP: &str = "erato-desktop-sidecar.app/Contents/Resources/bootstrap.json";

#[derive(Clone)]
pub(super) struct Template(Arc<[u8]>);

impl fmt::Debug for Template {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("MacosApplicationTemplate")
            .field("size", &self.0.len())
            .finish()
    }
}

impl Template {
    pub(super) fn load(source: &File) -> Result<Self> {
        let mut source = source.try_clone()?;
        source.seek(SeekFrom::Start(0))?;
        let mut bytes = Vec::new();
        source.read_to_end(&mut bytes)?;
        validate_template(&bytes)?;
        Ok(Self(bytes.into()))
    }

    pub(super) fn inject(&self, bootstrap: &[u8]) -> Result<Vec<u8>> {
        inject(&self.0, bootstrap)
    }
}

/// Accept the canonical unsealed application bundle, with or without an existing
/// bootstrap. In particular, do not silently invalidate a sealed/signed bundle.
fn open_template(template: &[u8]) -> Result<ZipArchive<Cursor<&[u8]>>> {
    let mut archive =
        ZipArchive::new(Cursor::new(template)).wrap_err("Invalid macOS sidecar application ZIP")?;
    let mut names = HashSet::new();
    for index in 0..archive.len() {
        let entry = archive.by_index(index)?;
        ensure!(
            matches!(entry.name(), EXECUTABLE | INFO_PLIST | BOOTSTRAP),
            "macOS sidecar template must contain only the canonical executable, Info.plist and optional bootstrap.json"
        );
        ensure!(
            entry.is_file() && !entry.encrypted(),
            "macOS sidecar template entries must be unencrypted regular files"
        );
        ensure!(
            names.insert(entry.name().to_owned()),
            "macOS sidecar template contains duplicate ZIP entries"
        );
    }
    ensure!(
        names.contains(INFO_PLIST) && names.contains(EXECUTABLE),
        "macOS sidecar template is missing its executable or Info.plist"
    );
    let mut executable = archive.by_name(EXECUTABLE)?;
    ensure!(
        executable.unix_mode().is_some_and(|mode| mode & 0o111 != 0),
        "macOS sidecar executable must retain executable permissions"
    );
    let mut header = [0_u8; 8];
    executable
        .read_exact(&mut header)
        .wrap_err("Truncated macOS sidecar executable")?;
    ensure!(
        header[..4] == [0xcf, 0xfa, 0xed, 0xfe]
            && matches!(
                u32::from_le_bytes(header[4..].try_into().unwrap()),
                0x0100_0007 | 0x0100_000c
            ),
        "macOS sidecar template must contain an x86_64 or arm64 Mach-O executable"
    );
    drop(executable);
    Ok(archive)
}

pub(super) fn validate_template(template: &[u8]) -> Result<()> {
    open_template(template)?;
    Ok(())
}

pub(super) fn inject(template: &[u8], bootstrap: &[u8]) -> Result<Vec<u8>> {
    let mut archive = open_template(template)?;
    let mut output = ZipWriter::new(Cursor::new(Vec::new()));
    for index in 0..archive.len() {
        let entry = archive.by_index(index)?;
        if entry.name() != BOOTSTRAP {
            // Copy compressed bytes and metadata, including Mach-O permissions.
            output.raw_copy_file(entry)?;
        }
    }
    output.start_file(
        BOOTSTRAP,
        SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .unix_permissions(0o600),
    )?;
    output.write_all(bootstrap)?;
    let personalized = output.finish()?.into_inner();
    // Never return an artifact whose embedded policy differs from the input.
    {
        let mut verification = open_template(&personalized)?;
        let mut entry = verification.by_name(BOOTSTRAP)?;
        ensure!(
            entry.size() == bootstrap.len() as u64,
            "macOS bootstrap size verification failed"
        );
        let mut actual = Vec::new();
        entry.read_to_end(&mut actual)?;
        ensure!(actual == bootstrap, "macOS bootstrap verification failed");
    }
    Ok(personalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn template(cpu: u32, extra: Option<(&str, &[u8])>) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        writer
            .start_file(INFO_PLIST, options.unix_permissions(0o644))
            .unwrap();
        writer.write_all(b"test Info.plist").unwrap();
        writer
            .start_file(EXECUTABLE, options.unix_permissions(0o755))
            .unwrap();
        writer.write_all(&[0xcf, 0xfa, 0xed, 0xfe]).unwrap();
        writer.write_all(&cpu.to_le_bytes()).unwrap();
        writer
            .write_all(b"unchanged Mach-O payload and code signature")
            .unwrap();
        if let Some((name, bytes)) = extra {
            writer
                .start_file(name, options.unix_permissions(0o600))
                .unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn injects_both_architectures_and_replaces_existing_bootstrap() {
        // No Windows executable slot limit applies to application ZIPs.
        let bootstrap = serde_json::to_vec(&serde_json::json!({
            "version": 1,
            "organization_configuration": {"allowed_origins": ["https://app.example.test"]},
            "future_setting": "x".repeat(8192),
        }))
        .unwrap();
        for cpu in [0x0100_0007, 0x0100_000c] {
            for existing in [None, Some((BOOTSTRAP, b"old private key".as_slice()))] {
                let original = template(cpu, existing);
                let result = inject(&original, &bootstrap).unwrap();
                let mut before = ZipArchive::new(Cursor::new(original)).unwrap();
                let mut after = ZipArchive::new(Cursor::new(result)).unwrap();
                assert_eq!(after.len(), 3);
                for name in [INFO_PLIST, EXECUTABLE] {
                    let mut source = before.by_name(name).unwrap();
                    let mut target = after.by_name(name).unwrap();
                    assert_eq!(source.unix_mode(), target.unix_mode());
                    assert_eq!(source.compression(), target.compression());
                    let mut expected = Vec::new();
                    let mut actual = Vec::new();
                    source.read_to_end(&mut expected).unwrap();
                    target.read_to_end(&mut actual).unwrap();
                    assert_eq!(expected, actual);
                }
                let mut entry = after.by_name(BOOTSTRAP).unwrap();
                assert_eq!(entry.unix_mode().unwrap() & 0o777, 0o600);
                let mut actual = Vec::new();
                entry.read_to_end(&mut actual).unwrap();
                assert_eq!(actual, bootstrap);
            }
        }
    }

    #[test]
    fn rejects_invalid_or_noncanonical_templates() {
        assert!(validate_template(b"not a ZIP").is_err());
        assert!(validate_template(&template(0, None)).is_err());
        for name in [
            "../bootstrap.json",
            "other.app/Contents/MacOS/bootstrap.json",
            "erato-desktop-sidecar.app/Contents/_CodeSignature/CodeResources",
        ] {
            assert!(
                validate_template(&template(0x0100_000c, Some((name, b"unexpected")))).is_err()
            );
        }
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .start_file(INFO_PLIST, SimpleFileOptions::default())
            .unwrap();
        assert!(validate_template(&writer.finish().unwrap().into_inner()).is_err());
    }
}
