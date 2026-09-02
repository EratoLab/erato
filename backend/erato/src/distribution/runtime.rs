//! Runtime distribution artifacts loaded from the database.

use crate::config::{AppConfig, ConfigSourceFile, McpRuntimeConfig};
use crate::db::entity::prelude::RuntimeConfiguration;
use crate::db::entity::runtime_configuration;
use crate::models::runtime_configuration::{ERATO_BACKEND_SOURCE_SERVICE, ERATO_TOML_SOURCE_TYPE};
use crate::services::mcp_manager::McpServers;
use crate::state::AppState;
use eyre::{Report, eyre};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder};

const ADMIN_PANEL_SOURCE_SERVICE: &str = "erato_admin_panel";
const TRANSLATION_PO_SOURCE_TYPE: &str = "translation_po";

/// A file that is made available by a runtime distribution producer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DistributionFile {
    pub filename: String,
    pub contents: String,
}

/// Files loaded from the runtime configuration table.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DistributionBundle {
    pub files: Vec<DistributionFile>,
}

/// Evaluated MCP configuration and the session manager that serves it.
#[derive(Clone, Debug)]
pub struct McpAppState {
    pub config: McpRuntimeConfig,
    pub servers: McpServers,
}

impl DistributionBundle {
    #[must_use]
    pub fn file(&self, filename: &str) -> Option<&DistributionFile> {
        self.files.iter().find(|file| file.filename == filename)
    }

    #[must_use]
    pub fn translation_locales(&self) -> Vec<&str> {
        self.files
            .iter()
            .filter_map(|file| translation_locale(&file.filename))
            .collect()
    }
}

/// The part of application state that may be replaced while the process is
/// running. The replacement is performed as one `RwLock` write, so readers
/// always observe a complete bundle.
#[derive(Clone, Debug)]
pub struct ReloadableAppState {
    pub distribution_bundle: DistributionBundle,
    pub mcp: McpAppState,
}

impl ReloadableAppState {
    #[must_use]
    pub fn new(config: &AppConfig, mcp_servers: McpServers) -> Self {
        Self {
            distribution_bundle: DistributionBundle::default(),
            mcp: McpAppState {
                config: McpRuntimeConfig::from_app_config(config),
                servers: mcp_servers,
            },
        }
    }
}

impl ReloadableAppState {
    pub async fn load(app_state: &AppState) -> Result<Self, Report> {
        let translation_rows = RuntimeConfiguration::find()
            .filter(runtime_configuration::Column::SourceService.eq(ADMIN_PANEL_SOURCE_SERVICE))
            .filter(runtime_configuration::Column::SourceType.eq(TRANSLATION_PO_SOURCE_TYPE))
            .order_by_asc(runtime_configuration::Column::SourceFilename)
            .all(&app_state.db)
            .await?;

        let mut files = Vec::with_capacity(translation_rows.len());
        for row in translation_rows {
            let Some(filename) = row.source_filename else {
                tracing::warn!("Ignoring runtime translation without a filename");
                continue;
            };
            if translation_locale(&filename).is_none() {
                tracing::warn!(source_filename = %filename, "Ignoring runtime translation with an invalid filename");
                continue;
            }

            files.push(DistributionFile {
                filename,
                contents: app_state.decrypt(&row.config)?,
            });
        }

        let mut config_sources = load_toml_sources(app_state, ERATO_BACKEND_SOURCE_SERVICE).await?;
        config_sources.extend(load_toml_sources(app_state, ADMIN_PANEL_SOURCE_SERVICE).await?);
        let mcp_config = McpRuntimeConfig::from_toml_sources(&config_sources)?;

        let previous_mcp = app_state.reloadable.read().await.mcp.clone();
        let changed_server_ids = if previous_mcp.config == mcp_config {
            Vec::new()
        } else {
            previous_mcp.servers.reconfigure(&mcp_config).await
        };
        if !changed_server_ids.is_empty() {
            tracing::info!(
                ?changed_server_ids,
                "Invalidated sessions for reconfigured MCP servers"
            );
        }

        Ok(Self {
            distribution_bundle: DistributionBundle { files },
            mcp: McpAppState {
                config: mcp_config,
                servers: previous_mcp.servers,
            },
        })
    }
}

async fn load_toml_sources(
    app_state: &AppState,
    source_service: &str,
) -> Result<Vec<ConfigSourceFile>, Report> {
    RuntimeConfiguration::find()
        .filter(runtime_configuration::Column::SourceService.eq(source_service))
        .filter(runtime_configuration::Column::SourceType.eq(ERATO_TOML_SOURCE_TYPE))
        .order_by_asc(runtime_configuration::Column::SourceFilename)
        .all(&app_state.db)
        .await?
        .into_iter()
        .enumerate()
        .map(|(index, row)| {
            Ok(ConfigSourceFile {
                source_filename: row
                    .source_filename
                    .unwrap_or_else(|| format!("{source_service}-{index}.toml")),
                contents: app_state.decrypt(&row.config)?,
            })
        })
        .collect()
}

/// Return the locale encoded by an admin-panel translation filename.
///
/// Runtime translation files intentionally have a narrow name contract:
/// `overrides/<locale>.po`. Rejecting all other paths keeps the public serving
/// route independent of filesystem path handling.
#[must_use]
pub fn translation_locale(filename: &str) -> Option<&str> {
    let locale = filename.strip_prefix("overrides/")?.strip_suffix(".po")?;
    if locale.is_empty()
        || locale.contains('/')
        || !locale
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return None;
    }
    Some(locale)
}

pub fn translation_filename(locale: &str) -> Result<String, Report> {
    if translation_locale(&format!("overrides/{locale}.po")) != Some(locale) {
        return Err(eyre!("invalid translation locale"));
    }
    Ok(format!("overrides/{locale}.po"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_runtime_translation_filenames() {
        assert_eq!(translation_locale("overrides/de.po"), Some("de"));
        assert_eq!(translation_locale("overrides/en-US.po"), Some("en-US"));
        assert_eq!(translation_locale("overrides/de.json"), None);
        assert_eq!(translation_locale("overrides/nested/de.po"), None);
        assert_eq!(translation_locale("../overrides/de.po"), None);
        assert_eq!(translation_locale("overrides/.po"), None);
    }
}
