//! Runtime distribution artifacts loaded from the database.

use crate::db::entity::prelude::RuntimeConfiguration;
use crate::db::entity::runtime_configuration;
use crate::distribution::experience_policy;
use crate::models::runtime_configuration::EXPERIENCE_POLICY_SOURCE_TYPE;
use crate::state::AppState;
use eyre::{Report, eyre};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder};

pub const ADMIN_PANEL_SOURCE_SERVICE: &str = "erato_admin_panel";
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
    /// `None` means no policy row exists — a valid complete state, distinct
    /// from a failed load, which keeps the previous policy. Kept out of the
    /// bundle above, whose files are served unauthenticated.
    pub experience_policy: Option<experience_policy::ExperiencePolicyDocument>,
}

impl ReloadableAppState {
    pub async fn load(app_state: &AppState) -> Result<Self, Report> {
        // Scoped so the read guard drops here: callers assign the result into
        // a `write()` on the same lock.
        let previous_policy = { app_state.reloadable.read().await.experience_policy.clone() };

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

        // A malformed policy must not take the translation bundle down: carry
        // the previous policy forward so the swap stays one complete write. On
        // a cold start that previous policy is `None`.
        let experience_policy = match load_experience_policy(app_state).await {
            Ok(policy) => policy,
            Err(error) => {
                tracing::error!(%error, "Failed to load experience policy; keeping the previous policy");
                previous_policy
            }
        };

        Ok(Self {
            distribution_bundle: DistributionBundle { files },
            experience_policy,
        })
    }
}

/// Load the org-wide experience policy from the runtime configuration table.
///
/// Zero rows is `Ok(None)`: the admin panel unpins by deleting the row, so
/// absence must clear the policy rather than trigger keep-previous. Rows that
/// exist but none named for the live slug is an `Err`, so a defective write
/// keeps the previous policy instead of silently unpinning the whole org.
async fn load_experience_policy(
    app_state: &AppState,
) -> Result<Option<experience_policy::ExperiencePolicyDocument>, Report> {
    let rows = RuntimeConfiguration::find()
        .filter(runtime_configuration::Column::SourceService.eq(ADMIN_PANEL_SOURCE_SERVICE))
        .filter(runtime_configuration::Column::SourceType.eq(EXPERIENCE_POLICY_SOURCE_TYPE))
        .order_by_asc(runtime_configuration::Column::SourceFilename)
        .all(&app_state.db)
        .await?;

    if rows.is_empty() {
        return Ok(None);
    }

    let live_filename =
        experience_policy::experience_policy_filename(experience_policy::EXPERIENCE_POLICY_SLUG)?;
    let mut matching = rows
        .iter()
        .filter(|row| row.source_filename.as_deref() == Some(live_filename.as_str()));
    let Some(row) = matching.next() else {
        let seen = rows
            .iter()
            .map(|row| row.source_filename.as_deref().unwrap_or("<none>"))
            .collect::<Vec<_>>()
            .join(", ");
        return Err(eyre!(
            "experience policy rows exist but none is named {live_filename}; saw: {seen}"
        ));
    };
    // The table has no uniqueness on (source_service, source_type,
    // source_filename), so first-match keeps the load deterministic — but a
    // duplicate points at a buggy writer.
    if matching.next().is_some() {
        tracing::warn!(
            source_filename = %live_filename,
            "Multiple experience policy rows share the live filename; using the first"
        );
    }

    let contents = app_state.decrypt(&row.config)?;
    let document = experience_policy::parse_experience_policy(&contents)?;
    Ok(Some(document))
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
