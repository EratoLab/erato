//! Runtime distribution artifacts loaded from the database.

use crate::db::entity::prelude::RuntimeConfiguration;
use crate::db::entity::runtime_configuration;
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
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ReloadableAppState {
    pub distribution_bundle: DistributionBundle,
}

impl ReloadableAppState {
    pub async fn load(app_state: &AppState) -> Result<Self, Report> {
        let rows = RuntimeConfiguration::find()
            .filter(runtime_configuration::Column::SourceService.eq(ADMIN_PANEL_SOURCE_SERVICE))
            .filter(runtime_configuration::Column::SourceType.eq(TRANSLATION_PO_SOURCE_TYPE))
            .order_by_asc(runtime_configuration::Column::SourceFilename)
            .all(&app_state.db)
            .await?;

        let mut files = Vec::with_capacity(rows.len());
        for row in rows {
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

        Ok(Self {
            distribution_bundle: DistributionBundle { files },
        })
    }
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
