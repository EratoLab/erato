//! Isolate the Windows Installer identity and resources of each environment.

use std::io::Cursor;

use erato_config::config::DesktopSidecarConfig;
use eyre::{Result, ensure};
use msi::{Expr, Package, Select, Update, Value};
use uuid::Uuid;

#[derive(Clone, Debug, Default)]
pub(super) struct Identity {
    product_code: Option<String>,
    upgrade_code: Option<String>,
}

impl Identity {
    pub(super) fn from_config(config: &DesktopSidecarConfig) -> Self {
        Self {
            product_code: config.product_code.clone(),
            upgrade_code: config.upgrade_code.clone(),
        }
    }
}

pub(super) fn personalize(
    package: &mut Package<Cursor<Vec<u8>>>,
    bootstrap: &[u8],
    identity: &Identity,
) -> Result<()> {
    let document: serde_json::Value = serde_json::from_slice(bootstrap)?;
    let suffix = document["directory_suffix"].as_str().unwrap_or("");
    let normalized_suffix = suffix.to_ascii_lowercase();
    let original_product = property(package, "ProductCode")?;
    let original_upgrade = property(package, "UpgradeCode")?;
    let product = scoped_code(
        &original_product,
        &normalized_suffix,
        identity.product_code.as_deref(),
    )?;
    let upgrade = scoped_code(
        &original_upgrade,
        &normalized_suffix,
        identity.upgrade_code.as_deref(),
    )?;
    set_property(package, "ProductCode", &product)?;
    set_property(package, "UpgradeCode", &upgrade)?;
    if package.has_table("Upgrade") {
        package.update_rows(
            Update::table("Upgrade")
                .set("UpgradeCode", Value::from(upgrade))
                .with(Expr::col("UpgradeCode").eq(Expr::string(&original_upgrade))),
        )?;
    }
    if let Some(name) = document["display_name"].as_str() {
        set_property(package, "ProductName", name)?;
    }
    if !suffix.is_empty() {
        // WiX's generated component GUIDs describe the template paths. A different
        // environment owns different resources and must not reference-count them
        // as the same component during repair, upgrade or uninstall.
        let components = package
            .select_rows(Select::table("Component"))?
            .map(|row| {
                (
                    row["Component"].as_str().unwrap().to_owned(),
                    row["ComponentId"].as_str().map(str::to_owned),
                )
            })
            .collect::<Vec<_>>();
        for (component, code) in components {
            if let Some(code) = code {
                package.update_rows(
                    Update::table("Component")
                        .set(
                            "ComponentId",
                            Value::from(scoped_code(&code, &normalized_suffix, None)?),
                        )
                        .with(Expr::col("Component").eq(Expr::string(component))),
                )?;
            }
        }
        let directory = package
            .select_rows(
                Select::table("Directory")
                    .with(Expr::col("Directory").eq(Expr::string("INSTALLFOLDER"))),
            )?
            .next()
            .ok_or_else(|| eyre::eyre!("MSI lacks INSTALLFOLDER"))?["DefaultDir"]
            .as_str()
            .ok_or_else(|| eyre::eyre!("Invalid MSI installation directory"))?
            .to_owned();
        // Drop the template's shared 8.3 alias, if present.
        let long_name = directory.split('|').next_back().unwrap();
        ensure!(
            !long_name.contains(':'),
            "Unexpected MSI INSTALLFOLDER source path"
        );
        package.update_rows(
            Update::table("Directory")
                .set("DefaultDir", Value::from(format!("{long_name}{suffix}")))
                .with(Expr::col("Directory").eq(Expr::string("INSTALLFOLDER"))),
        )?;
    }

    if package.has_table("Registry") {
        let config = DesktopSidecarConfig {
            launch_suffix: document["launch_suffix"].as_str().map(str::to_owned),
            ..Default::default()
        };
        let protocol_key = format!("Software\\Classes\\{}", config.windows_launch_scheme());
        let original_key = "Software\\Classes\\erato-launch";
        let rows = package
            .select_rows(Select::table("Registry"))?
            .map(|row| {
                (
                    row["Registry"].as_str().unwrap().to_owned(),
                    row["Key"].as_str().unwrap().to_owned(),
                )
            })
            .collect::<Vec<_>>();
        for (id, key) in rows {
            if key == original_key || key.starts_with(&format!("{original_key}\\")) {
                package.update_rows(
                    Update::table("Registry")
                        .set(
                            "Key",
                            Value::from(format!("{protocol_key}{}", &key[original_key.len()..])),
                        )
                        .with(Expr::col("Registry").eq(Expr::string(id))),
                )?;
            }
        }
    }
    // Different personalized bytes must never retain the source package identity.
    package.summary_info_mut().set_uuid(Uuid::new_v4());
    Ok(())
}

fn scoped_code(original: &str, suffix: &str, configured: Option<&str>) -> Result<String> {
    let original = Uuid::parse_str(original)?;
    let code = if let Some(configured) = configured {
        Uuid::parse_str(configured)?
    } else if suffix.is_empty() {
        original
    } else {
        Uuid::new_v5(&original, suffix.as_bytes())
    };
    ensure!(!code.is_nil(), "MSI identity must not be a nil UUID");
    Ok(code.braced().to_string().to_uppercase())
}

fn property(package: &mut Package<Cursor<Vec<u8>>>, name: &str) -> Result<String> {
    let row = package
        .select_rows(Select::table("Property").with(Expr::col("Property").eq(Expr::string(name))))?
        .next()
        .ok_or_else(|| eyre::eyre!("MSI lacks {name}"))?;
    Ok(row["Value"]
        .as_str()
        .ok_or_else(|| eyre::eyre!("Invalid MSI {name}"))?
        .to_owned())
}

fn set_property(package: &mut Package<Cursor<Vec<u8>>>, name: &str, value: &str) -> Result<()> {
    package.update_rows(
        Update::table("Property")
            .set("Value", Value::from(value))
            .with(Expr::col("Property").eq(Expr::string(name))),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prepare(suffix: &str, identity: &Identity) -> Package<Cursor<Vec<u8>>> {
        let template = super::super::tests::windows_msi_template();
        let bootstrap = serde_json::to_vec(&serde_json::json!({
            "version": 1, "directory_suffix": suffix, "launch_suffix": "-launch-test", "display_name": "Erato Staging",
            "organization_configuration": {"allowed_origins": []}
        }))
        .unwrap();
        let bytes =
            super::super::inject_msi_with_identity(&template, &bootstrap, identity).unwrap();
        super::super::validate_personalized_msi(&bytes, &bootstrap).unwrap();
        Package::open(Cursor::new(bytes)).unwrap()
    }

    fn cell(package: &mut Package<Cursor<Vec<u8>>>, table: &str, column: &str) -> String {
        package
            .select_rows(Select::table(table))
            .unwrap()
            .next()
            .unwrap()[column]
            .as_str()
            .unwrap()
            .into()
    }

    #[test]
    fn environments_have_stable_isolated_identities_paths_and_registry_keys() {
        let mut default = prepare("", &Identity::default());
        assert_eq!(
            cell(&mut default, "Registry", "Key"),
            "Software\\Classes\\erato-launch-launch-test\\shell\\open\\command"
        );
        let mut staging = prepare("-staging", &Identity::default());
        let mut repeated = prepare("-STAGING", &Identity::default());
        let mut production = prepare("-production", &Identity::default());
        for key in ["ProductCode", "UpgradeCode"] {
            let code = property(&mut staging, key).unwrap();
            assert_ne!(code, property(&mut default, key).unwrap());
            assert_ne!(code, property(&mut production, key).unwrap());
            assert_eq!(code, property(&mut repeated, key).unwrap());
        }
        assert_eq!(
            property(&mut staging, "ProductName").unwrap(),
            "Erato Staging"
        );
        assert_eq!(
            cell(&mut staging, "Directory", "DefaultDir"),
            "Erato Desktop Sidecar-staging"
        );
        assert_eq!(
            cell(&mut staging, "Upgrade", "UpgradeCode"),
            property(&mut staging, "UpgradeCode").unwrap()
        );
        assert_ne!(
            cell(&mut staging, "Component", "ComponentId"),
            cell(&mut default, "Component", "ComponentId")
        );
        assert_eq!(
            cell(&mut staging, "Component", "ComponentId"),
            cell(&mut repeated, "Component", "ComponentId")
        );
        assert_eq!(
            cell(&mut staging, "Registry", "Key"),
            "Software\\Classes\\erato-launch-launch-test\\shell\\open\\command"
        );
        assert_ne!(
            staging.summary_info().uuid(),
            repeated.summary_info().uuid()
        );
    }

    #[test]
    fn configured_codes_override_derivation_and_upgrade_table_follows() {
        let identity = Identity {
            product_code: Some("11111111-2222-4333-8444-555555555555".into()),
            upgrade_code: Some("{AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE}".into()),
        };
        let mut package = prepare("-staging", &identity);
        assert_eq!(
            property(&mut package, "ProductCode").unwrap(),
            "{11111111-2222-4333-8444-555555555555}"
        );
        assert_eq!(
            property(&mut package, "UpgradeCode").unwrap(),
            "{AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE}"
        );
        assert_eq!(
            cell(&mut package, "Upgrade", "UpgradeCode"),
            "{AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE}"
        );
    }

    #[test]
    fn new_release_changes_product_but_preserves_environment_upgrade_family() {
        let mut package = prepare("-staging", &Identity::default());
        let product = property(&mut package, "ProductCode").unwrap();
        let upgrade = property(&mut package, "UpgradeCode").unwrap();
        let mut template =
            Package::open(Cursor::new(super::super::tests::windows_msi_template())).unwrap();
        set_property(
            &mut template,
            "ProductCode",
            "{11111111-2222-4333-8444-555555555555}",
        )
        .unwrap();
        set_property(&mut template, "ProductVersion", "0.2.0").unwrap();
        personalize(
            &mut template,
            br#"{"directory_suffix":"-staging"}"#,
            &Identity::default(),
        )
        .unwrap();
        assert_ne!(property(&mut template, "ProductCode").unwrap(), product);
        assert_eq!(property(&mut template, "UpgradeCode").unwrap(), upgrade);
    }
}
