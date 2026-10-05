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
        document["version"] = json!(manifest.version.clone().unwrap_or_else(release_version));
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
        apply_bot(&mut document, app, host, &authority);

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

/// Scopes the bot is installable in: personal chats, group chats, and teams
/// (channels, where it answers @mentions).
const BOT_SCOPES: [&str; 3] = ["personal", "team", "groupChat"];

/// Add the conversational bot to the same Teams app as the tab, when enabled.
fn apply_bot(document: &mut Value, app: &MsOfficeTeamsAppConfig, host: &str, authority: &str) {
    let bot = &app.bot;
    let Some(bot_app_id) = bot.app_id.as_deref().filter(|_| bot.enabled) else {
        return;
    };
    document["bots"] = json!([{
        "botId": bot_app_id.trim(),
        "scopes": BOT_SCOPES,
        "supportsFiles": true,
        "isNotificationOnly": false,
        "commandLists": [{
            "scopes": BOT_SCOPES,
            "commands": [{"title": "/new", "description": "Start a new Erato chat"}],
        }],
    }]);
    // Manifests v1.25+ with team scope must declare channel feature support.
    document["supportsChannelFeatures"] = json!("tier1");
    // The sign-in button opens the Bot Framework token service.
    document["validDomains"] = json!([host, "token.botframework.com"]);
    // Teams single sign-on: the bot's Application ID URI, derived for the host
    // the package is downloaded from unless configured. The setup page and
    // its Cloud Shell helper derive the same value. Without single sign-on
    // the tab's own `webApplicationInfo` stays.
    let Some(sso_resource) = bot.sso_resource_for_host(authority) else {
        return;
    };
    if let Some(sso_app_id) = bot.sso_app_id.as_deref() {
        document["webApplicationInfo"]["id"] = json!(sso_app_id.trim());
    }
    document["webApplicationInfo"]["resource"] = json!(sso_resource);
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
    if app.bot.enabled {
        ensure!(
            document["supportsChannelFeatures"] == "tier1",
            "Teams bot with team scope requires supportsChannelFeatures to be tier1"
        );
        ensure!(
            document["bots"][0]["botId"].as_str() == app.bot.app_id.as_deref().map(str::trim),
            "rendered Teams bot ID does not match configuration"
        );
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    const TEMPLATE: &str = include_str!("../../../../office-addin/manifests/manifest-teams.json");

    fn distribution() -> TeamsAppDistribution {
        TeamsAppDistribution {
            bundle_root: PathBuf::from("."),
            template: serde_json::from_str(TEMPLATE).expect("template parses"),
        }
    }

    fn addin() -> MsOfficeAddinConfig {
        MsOfficeAddinConfig {
            msal_client_id: Some("06d98d69-523a-4c2e-893d-44bd98226b31".to_string()),
            ..Default::default()
        }
    }

    fn render(app: &MsOfficeTeamsAppConfig) -> Value {
        let bytes = distribution()
            .render_manifest("https://erato.example.com", app, &addin())
            .expect("manifest renders");
        serde_json::from_slice(&bytes).expect("manifest is JSON")
    }

    #[test]
    fn renders_the_tab_without_a_bot_by_default() {
        let manifest = render(&MsOfficeTeamsAppConfig::default());
        assert!(manifest["bots"].is_null());
        assert!(manifest["supportsChannelFeatures"].is_null());
        assert_eq!(manifest["validDomains"], json!(["erato.example.com"]));
        assert_eq!(manifest["version"], json!(release_version()));
    }

    #[test]
    fn deployment_version_override_preserves_app_identity_and_bot() {
        let mut app = MsOfficeTeamsAppConfig::default();
        app.manifest.version = Some("0.6.3".to_string());
        app.bot.enabled = true;
        app.bot.app_id = Some("11111111-2222-3333-4444-555555555555".to_string());
        let manifest = render(&app);
        assert_eq!(manifest["version"], "0.6.3");
        assert_eq!(manifest["id"], app.app_id);
        assert_eq!(manifest["bots"][0]["botId"], app.bot.app_id.unwrap());
    }

    #[test]
    fn adds_the_bot_and_sso_override_when_enabled() {
        let mut app = MsOfficeTeamsAppConfig::default();
        app.bot.enabled = true;
        app.bot.app_id = Some("11111111-2222-3333-4444-555555555555".to_string());
        app.bot.sso_app_id = Some("11111111-2222-3333-4444-555555555555".to_string());
        app.bot.sso_resource = Some("api://botid-11111111-2222-3333-4444-555555555555".to_string());
        let manifest = render(&app);
        assert_eq!(manifest["supportsChannelFeatures"], "tier1");
        assert_eq!(
            manifest["bots"][0]["botId"],
            "11111111-2222-3333-4444-555555555555"
        );
        assert_eq!(
            manifest["bots"][0]["scopes"],
            json!(["personal", "team", "groupChat"])
        );
        assert_eq!(
            manifest["validDomains"],
            json!(["erato.example.com", "token.botframework.com"])
        );
        assert_eq!(
            manifest["webApplicationInfo"]["resource"],
            "api://botid-11111111-2222-3333-4444-555555555555"
        );
        // The tab's nested app auth stays as it was.
        assert_eq!(
            manifest["webApplicationInfo"]["nestedAppAuthInfo"][0]["redirectUri"],
            "brk-multihub://erato.example.com"
        );
    }

    #[test]
    fn derives_the_sso_resource_from_the_download_host() {
        let mut app = MsOfficeTeamsAppConfig::default();
        app.bot.enabled = true;
        app.bot.app_id = Some("11111111-2222-3333-4444-555555555555".to_string());
        let manifest = render(&app);
        assert_eq!(
            manifest["webApplicationInfo"]["id"],
            "06d98d69-523a-4c2e-893d-44bd98226b31"
        );
        assert_eq!(
            manifest["webApplicationInfo"]["resource"],
            "api://erato.example.com/botid-11111111-2222-3333-4444-555555555555"
        );

        let bytes = distribution()
            .render_manifest("https://erato.example.com:8443", &app, &addin())
            .expect("manifest renders");
        let manifest: Value = serde_json::from_slice(&bytes).expect("manifest is JSON");
        assert_eq!(
            manifest["webApplicationInfo"]["resource"],
            "api://erato.example.com:8443/botid-11111111-2222-3333-4444-555555555555"
        );
    }

    #[test]
    fn keeps_the_tab_resource_without_single_sign_on() {
        let mut app = MsOfficeTeamsAppConfig::default();
        app.bot.enabled = true;
        app.bot.sso_enabled = false;
        app.bot.app_id = Some("11111111-2222-3333-4444-555555555555".to_string());
        let manifest = render(&app);
        assert_eq!(
            manifest["bots"][0]["botId"],
            "11111111-2222-3333-4444-555555555555"
        );
        assert_eq!(
            manifest["webApplicationInfo"]["resource"],
            "api://06d98d69-523a-4c2e-893d-44bd98226b31"
        );
    }

    #[test]
    fn rejects_bot_packages_without_channel_feature_support() {
        let mut app = MsOfficeTeamsAppConfig::default();
        app.bot.enabled = true;
        app.bot.app_id = Some("11111111-2222-3333-4444-555555555555".to_string());
        let mut manifest = render(&app);
        manifest
            .as_object_mut()
            .unwrap()
            .remove("supportsChannelFeatures");

        let error = distribution()
            .package(&serde_json::to_vec(&manifest).unwrap(), &app)
            .expect_err("a bot package without channel feature support must be rejected");
        assert!(error.to_string().contains("supportsChannelFeatures"));
    }
}
