//! Standalone Microsoft Teams app package distribution.

use std::io::Cursor;
use std::path::{Component, Path, PathBuf};

use eyre::{Context, Result, ensure};
use serde_json::{Value, json};
use zip::write::SimpleFileOptions;

use erato_config::config::{MsOfficeAddinConfig, MsOfficeTeamsAppConfig};

const MANIFEST_FILE_NAME: &str = "manifest-teams.json";
const TEAMS_ROUTE: &str = "/office-addin/teams";

#[derive(Clone, Debug)]
pub struct TeamsAppDistribution {
    bundle_root: PathBuf,
    template: Value,
}

impl TeamsAppDistribution {
    pub fn load(bundle_root: impl AsRef<Path>) -> Result<Self> {
        let bundle_root = bundle_root.as_ref().to_path_buf();
        let template_path = bundle_root.join(MANIFEST_FILE_NAME);
        let template = std::fs::read(&template_path).wrap_err_with(|| {
            format!(
                "failed to read Teams manifest template at {}",
                template_path.display()
            )
        })?;
        let template: Value = serde_json::from_slice(&template)
            .wrap_err("Teams manifest template is not valid JSON")?;
        ensure!(
            template.is_object(),
            "Teams manifest template must be a JSON object"
        );
        Ok(Self {
            bundle_root,
            template,
        })
    }

    pub fn render_manifest(
        &self,
        base_url: &str,
        app: &MsOfficeTeamsAppConfig,
        addin: &MsOfficeAddinConfig,
    ) -> Result<Vec<u8>> {
        let base = url::Url::parse(base_url).wrap_err("invalid Teams manifest base URL")?;
        ensure!(
            base.scheme() == "https",
            "Teams app manifest base URL must use https"
        );
        let host = base
            .host_str()
            .ok_or_else(|| eyre::eyre!("Teams manifest base URL has no hostname"))?;
        let ip_host = host.trim_start_matches('[').trim_end_matches(']');
        ensure!(
            !host.eq_ignore_ascii_case("localhost")
                && !host.ends_with(".localhost")
                && !ip_host
                    .parse::<std::net::IpAddr>()
                    .is_ok_and(|address| address.is_loopback()),
            "Teams app manifest cannot be rendered for a localhost origin"
        );
        let authority = match base.port() {
            Some(port) => format!("{host}:{port}"),
            None => host.to_string(),
        };
        let root = base_url.trim_end_matches('/');
        let manifest = &app.manifest;
        let mut document = self.template.clone();
        document["id"] = json!(app.app_id);
        document["version"] = json!(release_version());
        document["developer"] = json!({
            "name": manifest.developer_name,
            "websiteUrl": manifest.website_url,
            "privacyUrl": manifest.privacy_url,
            "termsOfUseUrl": manifest.terms_url,
        });
        document["name"] = json!({"short": manifest.short_name, "full": manifest.full_name});
        document["description"] =
            json!({"short": manifest.short_description, "full": manifest.full_description});
        document["icons"] = json!({
            "color": manifest.color_icon,
            "outline": manifest.outline_icon,
            "color32x32": manifest.small_color_icon,
        });
        document["staticTabs"][0]["name"] = json!(manifest.tab_name);
        document["staticTabs"][0]["contentUrl"] = json!(format!("{root}{TEAMS_ROUTE}"));
        document["staticTabs"][0]["websiteUrl"] = json!(format!("{root}{TEAMS_ROUTE}"));
        document["validDomains"] = json!([host]);

        let client_id = addin
            .msal_client_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                eyre::eyre!(
                    "Teams app distribution requires integrations.ms_office.addin.msal_client_id"
                )
            })?;
        document["webApplicationInfo"]["id"] = json!(client_id);
        document["webApplicationInfo"]["resource"] = json!(format!("api://{client_id}"));
        document["webApplicationInfo"]["nestedAppAuthInfo"][0]["redirectUri"] =
            json!(format!("brk-multihub://{authority}"));

        validate_manifest(&document, app)?;
        serde_json::to_vec_pretty(&document).wrap_err("failed to serialize rendered Teams manifest")
    }

    pub fn package(
        &self,
        rendered_manifest: &[u8],
        app: &MsOfficeTeamsAppConfig,
    ) -> Result<Vec<u8>> {
        let document: Value = serde_json::from_slice(rendered_manifest)?;
        validate_manifest(&document, app)?;
        let icons = document["icons"]
            .as_object()
            .ok_or_else(|| eyre::eyre!("Teams manifest icons must be an object"))?;
        let mut assets = std::collections::BTreeMap::new();
        for (key, expected_width) in [("color", 192), ("outline", 32), ("color32x32", 32)] {
            let value = icons
                .get(key)
                .ok_or_else(|| eyre::eyre!("Teams manifest missing package icon `{key}`"))?;
            let name = value
                .as_str()
                .ok_or_else(|| eyre::eyre!("Teams manifest icon path must be a string"))?;
            let relative = Path::new(name);
            ensure!(
                relative
                    .components()
                    .all(|part| matches!(part, Component::Normal(_))),
                "unsafe Teams package asset path: {name}"
            );
            let source = self.bundle_root.join(relative);
            ensure!(
                source.is_file(),
                "Teams package icon is missing: {}",
                source.display()
            );
            let bytes = std::fs::read(source)?;
            ensure!(
                png_dimensions(&bytes) == Some((expected_width, expected_width)),
                "Teams package icon `{name}` must be a {expected_width}x{expected_width} PNG"
            );
            assets.insert(name.to_string(), bytes);
        }

        let cursor = Cursor::new(Vec::new());
        let mut zip = zip::ZipWriter::new(cursor);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("manifest.json", options)?;
        std::io::Write::write_all(&mut zip, rendered_manifest)?;
        for (name, bytes) in assets {
            zip.start_file(name, options)?;
            std::io::Write::write_all(&mut zip, &bytes)?;
        }
        Ok(zip.finish()?.into_inner())
    }
}

fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
    if bytes.get(..8)? != PNG_SIGNATURE || bytes.get(12..16)? != b"IHDR" {
        return None;
    }
    Some((
        u32::from_be_bytes(bytes.get(16..20)?.try_into().ok()?),
        u32::from_be_bytes(bytes.get(20..24)?.try_into().ok()?),
    ))
}

fn release_version() -> String {
    let mut parts = env!("CARGO_PKG_VERSION").split('.');
    format!(
        "{}.{}.{}",
        parts.next().unwrap_or("0"),
        parts.next().unwrap_or("0"),
        parts.next().unwrap_or("0")
    )
}

fn validate_manifest(document: &Value, app: &MsOfficeTeamsAppConfig) -> Result<()> {
    ensure!(
        document["manifestVersion"] == "1.29",
        "Teams manifestVersion must remain pinned to the tenant-verified 1.29 schema"
    );
    ensure!(
        document["$schema"]
            .as_str()
            .is_some_and(|schema| schema.ends_with("/v1.29/MicrosoftTeams.schema.json")),
        "Teams manifest schema must match the pinned manifestVersion 1.29"
    );
    ensure!(
        document["id"] == app.app_id,
        "rendered Teams app ID does not match configuration"
    );
    ensure!(
        document["extensions"].is_null(),
        "standalone Teams manifest must not declare Outlook extensions"
    );
    ensure!(
        document["staticTabs"][0]["scopes"][0] == "personal",
        "Teams manifest must contain the personal tab"
    );
    for key in ["color", "outline", "color32x32"] {
        ensure!(
            document["icons"][key].as_str().is_some(),
            "Teams manifest missing package icon `{key}`"
        );
    }
    for (key, expected) in [
        ("developer.name", &app.manifest.developer_name),
        ("name.short", &app.manifest.short_name),
        ("name.full", &app.manifest.full_name),
        ("description.short", &app.manifest.short_description),
        ("description.full", &app.manifest.full_description),
    ] {
        let actual = key.split('.').fold(document, |value, part| &value[part]);
        ensure!(
            actual.as_str() == Some(expected.as_str()),
            "rendered Teams manifest field `{key}` does not match configuration"
        );
    }
    Ok(())
}
