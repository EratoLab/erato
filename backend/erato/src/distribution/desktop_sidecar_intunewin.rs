//! Intune ProfileVersion1 container, verified against IntuneWinAppUtil 1.8.7.0.
//! Format research: https://svrooij.io/2023/10/09/decrypting-intunewin-files/
//! The keys travel in Detection.xml: encryption is a packaging requirement,
//! not a confidentiality boundary for the downloaded organization bootstrap.

use std::collections::HashMap;
use std::io::{Cursor, Write};

use aes::cipher::{BlockModeEncrypt, KeyIvInit, block_padding::Pkcs7};
use base64::{Engine, engine::general_purpose::STANDARD};
use eyre::{Context, Result, ensure};
use hmac::{Hmac, KeyInit, Mac};
use msi::{Expr, Select};
use rand::{TryRngCore, rngs::OsRng};
use sha2::{Digest, Sha256};
use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

const CONTENT: &str = "IntuneWinPackage/Contents/IntunePackage.intunewin";
const METADATA: &str = "IntuneWinPackage/Metadata/Detection.xml";

#[derive(Clone, Debug)]
pub(super) struct Template {
    setup_file: String,
    name: String,
    msi_info: String,
}

impl Template {
    pub(super) fn load(msi: &[u8], setup_file: &str) -> Result<Self> {
        let mut package = msi::Package::open(Cursor::new(msi))?;
        let properties = package
            .select_rows(Select::table("Property"))?
            .map(|row| {
                Ok((
                    row["Property"]
                        .as_str()
                        .ok_or_else(|| eyre::eyre!("Invalid MSI property name"))?
                        .to_owned(),
                    row["Value"]
                        .as_str()
                        .ok_or_else(|| eyre::eyre!("Invalid MSI property value"))?
                        .to_owned(),
                ))
            })
            .collect::<Result<HashMap<_, _>>>()?;
        let property = |name: &str| properties.get(name).map(String::as_str).unwrap_or("");
        for key in [
            "ProductName",
            "ProductCode",
            "ProductVersion",
            "Manufacturer",
        ] {
            ensure!(
                !property(key).is_empty(),
                "MSI lacks {key} required for Intune metadata"
            );
        }
        let package_code = package
            .summary_info()
            .uuid()
            .ok_or_else(|| eyre::eyre!("MSI lacks package code required for Intune metadata"))?
            .braced()
            .to_string()
            .to_uppercase();
        let scope = property("ALLUSERS");
        let mut info = String::from("<MsiInfo>");
        for (key, value) in [
            ("MsiProductCode", property("ProductCode")),
            ("MsiProductVersion", property("ProductVersion")),
            ("MsiPackageCode", package_code.as_str()),
            ("MsiUpgradeCode", property("UpgradeCode")),
            (
                "MsiExecutionContext",
                if scope == "1" {
                    "System"
                } else if scope == "2" {
                    "Any"
                } else {
                    "User"
                },
            ),
        ] {
            element(&mut info, key, value);
        }
        let includes_services = has_rows(&mut package, "ServiceInstall", None)?;
        let includes_odbc = has_rows(&mut package, "ODBCDataSource", None)?;
        let system_registry = has_rows(
            &mut package,
            "Registry",
            Some(
                Expr::col("Root")
                    .eq(Expr::integer(2))
                    .or(Expr::col("Root").eq(Expr::integer(0)))
                    .or(Expr::col("Root")
                        .eq(Expr::integer(-1))
                        .and(Expr::boolean(scope == "1"))),
            ),
        )?;
        let system_folders = has_rows(
            &mut package,
            "Directory",
            Some(
                Expr::col("Directory")
                    .eq(Expr::string("SystemFolder"))
                    .or(Expr::col("Directory").eq(Expr::string("System64Folder")))
                    .or(Expr::col("Directory").eq(Expr::string("WindowsFolder"))),
            ),
        )?;
        let requires_reboot = has_rows(
            &mut package,
            "InstallExecuteSequence",
            Some(Expr::col("Action").eq(Expr::string("ForceReboot"))),
        )?;
        for (key, value) in [
            ("MsiRequiresLogon", scope.is_empty()),
            ("MsiRequiresReboot", requires_reboot),
            ("MsiIsMachineInstall", scope == "1" || scope == "2"),
            ("MsiIsUserInstall", scope != "1"),
            ("MsiIncludesServices", includes_services),
            ("MsiIncludesODBCDataSource", includes_odbc),
            ("MsiContainsSystemRegistryKeys", system_registry),
            ("MsiContainsSystemFolders", system_folders),
        ] {
            element(&mut info, key, if value { "true" } else { "false" });
        }
        element(&mut info, "MsiPublisher", property("Manufacturer"));
        info.push_str("</MsiInfo>");
        Ok(Self {
            setup_file: setup_file.into(),
            name: property("ProductName").into(),
            msi_info: info,
        })
    }

    pub(super) fn package(&self, personalized_msi: &[u8]) -> Result<Vec<u8>> {
        // Product, upgrade and package codes can change during personalization.
        let metadata = Self::load(personalized_msi, &self.setup_file)?;
        let plaintext = archive(
            &[(&self.setup_file, personalized_msi)],
            CompressionMethod::Deflated,
        )?;
        let mut key = [0; 32];
        let mut mac_key = [0; 32];
        let mut iv = [0; 16];
        OsRng
            .try_fill_bytes(&mut key)
            .wrap_err("Failed to generate Intune encryption key")?;
        OsRng
            .try_fill_bytes(&mut mac_key)
            .wrap_err("Failed to generate Intune MAC key")?;
        OsRng
            .try_fill_bytes(&mut iv)
            .wrap_err("Failed to generate Intune IV")?;
        let ciphertext = cbc::Encryptor::<aes::Aes256>::new(&key.into(), &iv.into())
            .encrypt_padded_vec::<Pkcs7>(&plaintext);
        let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(&mac_key)?;
        mac.update(&iv);
        mac.update(&ciphertext);
        let mac = mac.finalize().into_bytes();
        let mut encrypted = Vec::with_capacity(48 + ciphertext.len());
        encrypted.extend_from_slice(&mac);
        encrypted.extend_from_slice(&iv);
        encrypted.extend_from_slice(&ciphertext);

        let mut xml = String::from("<ApplicationInfo ToolVersion=\"1.8.7.0\">");
        element(&mut xml, "Name", &metadata.name);
        element(
            &mut xml,
            "UnencryptedContentSize",
            &plaintext.len().to_string(),
        );
        element(&mut xml, "FileName", "IntunePackage.intunewin");
        element(&mut xml, "SetupFile", &self.setup_file);
        xml.push_str("<EncryptionInfo>");
        for (name, value) in [
            ("EncryptionKey", STANDARD.encode(key)),
            ("MacKey", STANDARD.encode(mac_key)),
            ("InitializationVector", STANDARD.encode(iv)),
            ("Mac", STANDARD.encode(mac)),
            ("ProfileIdentifier", "ProfileVersion1".into()),
            ("FileDigest", STANDARD.encode(Sha256::digest(&plaintext))),
            ("FileDigestAlgorithm", "SHA256".into()),
        ] {
            element(&mut xml, name, &value);
        }
        xml.push_str("</EncryptionInfo>");
        xml.push_str(&metadata.msi_info);
        xml.push_str("</ApplicationInfo>");
        archive(
            &[(CONTENT, &encrypted), (METADATA, xml.as_bytes())],
            CompressionMethod::Stored,
        )
    }
}

fn has_rows<F: std::io::Read + std::io::Seek>(
    package: &mut msi::Package<F>,
    table: &str,
    condition: Option<Expr>,
) -> Result<bool> {
    if !package.has_table(table) {
        return Ok(false);
    }
    let mut query = Select::table(table);
    if let Some(condition) = condition {
        query = query.with(condition);
    }
    Ok(package.select_rows(query)?.next().is_some())
}

fn element(xml: &mut String, name: &str, value: &str) {
    xml.push('<');
    xml.push_str(name);
    xml.push('>');
    xml.push_str(
        &value
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
            .replace('\'', "&apos;"),
    );
    xml.push_str("</");
    xml.push_str(name);
    xml.push('>');
}

fn archive(files: &[(&str, &[u8])], compression: CompressionMethod) -> Result<Vec<u8>> {
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(compression);
    for (name, bytes) in files {
        zip.start_file(*name, options)?;
        zip.write_all(bytes)?;
    }
    Ok(zip.finish()?.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use aes::cipher::BlockModeDecrypt;
    use std::io::Read;
    use zip::ZipArchive;

    fn tag<'a>(xml: &'a str, name: &str) -> &'a str {
        xml.split_once(&format!("<{name}>"))
            .unwrap()
            .1
            .split_once(&format!("</{name}>"))
            .unwrap()
            .0
    }

    #[test]
    fn intunewin_roundtrip_preserves_personalized_msi_and_detection_metadata() {
        let msi = super::super::tests::windows_msi_template();
        let bootstrap = br#"{"version":1,"organization_configuration":{"allowed_origins":["https://example.test"]}}"#;
        let personalized = super::super::inject_msi(&msi, bootstrap).unwrap();
        let template = Template::load(&msi, "sidecar.msi").unwrap();
        let bytes = template.package(&personalized).unwrap();
        assert_ne!(bytes, template.package(&personalized).unwrap());
        let mut outer = ZipArchive::new(Cursor::new(bytes)).unwrap();
        assert_eq!(outer.len(), 2);
        let mut xml = String::new();
        outer
            .by_name(METADATA)
            .unwrap()
            .read_to_string(&mut xml)
            .unwrap();
        assert_eq!(tag(&xml, "Name"), "Erato &amp; &lt;Sidecar&gt;");
        assert_eq!(tag(&xml, "SetupFile"), "sidecar.msi");
        assert_eq!(
            tag(&xml, "MsiProductCode"),
            "{0E35A9BE-8AED-4C67-9356-72A84A6AFB74}"
        );
        let package_code = msi::Package::open(Cursor::new(&personalized))
            .unwrap()
            .summary_info()
            .uuid()
            .unwrap()
            .braced()
            .to_string()
            .to_uppercase();
        assert_eq!(tag(&xml, "MsiPackageCode"), package_code);
        assert_ne!(package_code, "{B3217770-F221-466F-91FE-0E27D5355807}");
        assert_eq!(tag(&xml, "MsiExecutionContext"), "System");
        assert_eq!(tag(&xml, "MsiIsMachineInstall"), "true");
        let decode = |name| STANDARD.decode(tag(&xml, name)).unwrap();
        let mut encrypted = Vec::new();
        let mut content = outer.by_name(CONTENT).unwrap();
        assert_eq!(content.compression(), CompressionMethod::Stored);
        content.read_to_end(&mut encrypted).unwrap();
        assert_eq!(&encrypted[..32], decode("Mac"));
        assert_eq!(&encrypted[32..48], decode("InitializationVector"));
        let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(&decode("MacKey")).unwrap();
        mac.update(&encrypted[32..]);
        mac.verify_slice(&encrypted[..32]).unwrap();
        let plaintext = cbc::Decryptor::<aes::Aes256>::new_from_slices(
            &decode("EncryptionKey"),
            &encrypted[32..48],
        )
        .unwrap()
        .decrypt_padded_vec::<Pkcs7>(&encrypted[48..])
        .unwrap();
        assert_eq!(
            plaintext.len().to_string(),
            tag(&xml, "UnencryptedContentSize")
        );
        assert_eq!(Sha256::digest(&plaintext).as_slice(), decode("FileDigest"));
        let mut inner = ZipArchive::new(Cursor::new(plaintext)).unwrap();
        assert_eq!(inner.len(), 1);
        let mut extracted = Vec::new();
        inner
            .by_name("sidecar.msi")
            .unwrap()
            .read_to_end(&mut extracted)
            .unwrap();
        assert_eq!(extracted, personalized);
        super::super::validate_personalized_msi(&extracted, bootstrap).unwrap();
    }
}
