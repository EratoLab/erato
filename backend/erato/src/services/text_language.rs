//! The language of texts the backend writes itself: the Teams bot's cards
//! and replies, and what a delivered reminder offers. The web app has its
//! own catalogs. English and German only, German in the formal "Sie".

use crate::models::user_preference::get_user_preferences;
use eyre::Report;
use sea_orm::DatabaseConnection;
use sea_orm::prelude::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Lang {
    #[default]
    En,
    De,
}

impl Lang {
    /// `de`, `de-AT` or `de_CH` is German; any other tag is English.
    pub fn from_tag(tag: &str) -> Self {
        let primary = tag.trim().split(['-', '_']).next().unwrap_or_default();
        if primary.eq_ignore_ascii_case("de") {
            Self::De
        } else {
            Self::En
        }
    }

    /// The first language that is set decides: the user's stored one, then
    /// the one their client reports (only when answering a message), then
    /// the deployment's default.
    pub fn resolve(stored: Option<&str>, client: Option<&str>, default: &str) -> Self {
        let tag = [stored, client]
            .into_iter()
            .flatten()
            .find(|tag| !tag.trim().is_empty())
            .unwrap_or(default);
        Self::from_tag(tag)
    }

    pub fn pick<T>(self, english: T, german: T) -> T {
        match self {
            Self::En => english,
            Self::De => german,
        }
    }
}

/// The language for a message that answers nothing the user sent, such as a
/// reminder or a tip: the stored one, else the deployment's default.
pub async fn of_user(
    db: &DatabaseConnection,
    user_id: Uuid,
    default: &str,
) -> Result<Lang, Report> {
    let stored = get_user_preferences(db, &user_id)
        .await?
        .and_then(|prefs| prefs.language);
    Ok(Lang::resolve(stored.as_deref(), None, default))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn any_german_tag_is_german_and_everything_else_english() {
        for tag in ["de", "de-DE", "DE-at", "de_CH", " de "] {
            assert_eq!(Lang::from_tag(tag), Lang::De, "{tag}");
        }
        for tag in ["en-US", "fr-FR", "dsb", "", "deu"] {
            assert_eq!(Lang::from_tag(tag), Lang::En, "{tag}");
        }
    }

    #[test]
    fn the_stored_language_comes_first_then_the_client_then_the_default() {
        assert_eq!(Lang::resolve(Some("en-US"), Some("de-DE"), "de"), Lang::En);
        assert_eq!(Lang::resolve(None, Some("de-DE"), "en"), Lang::De);
        assert_eq!(Lang::resolve(Some(" "), Some("de-DE"), "en"), Lang::De);
        assert_eq!(Lang::resolve(None, None, "de"), Lang::De);
        // A set language that is neither decides for English, not the default.
        assert_eq!(Lang::resolve(Some("fr-FR"), None, "de"), Lang::En);
    }
}
