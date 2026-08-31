//! Org-wide experience policy document, written by the admin panel as a
//! `runtime_configuration` row (source type `experience_policy`) and read back
//! on every reload. This is the policy document only; resolving it for a user
//! happens in `server::api::v1beta::starting_assistant`.

use eyre::{Report, eyre};
use serde::Deserialize;
use sqlx::types::Uuid;
use std::collections::{HashMap, HashSet};

/// The slug of the single live policy document. Other valid slugs are reserved
/// for future drafts and are deliberately not loaded.
pub const EXPERIENCE_POLICY_SLUG: &str = "policy";

/// The org-wide experience policy: which audiences exist and in which order
/// they are resolved for a user.
///
/// Deliberately not `deny_unknown_fields`, so a newer admin panel writing an
/// unknown field does not wedge the backend into keep-previous forever during
/// a mixed-version deployment.
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
pub struct ExperiencePolicyDocument {
    #[serde(default)]
    pub audiences: HashMap<String, ExperienceAudience>,
    /// Precedence lives in this separate ordered key, like
    /// `chat_providers.priority_order` and `language_detection_priority` —
    /// never in the map above, whose `HashMap` iteration order is arbitrary.
    /// An audience absent from here can never win.
    #[serde(default)]
    pub priority_order: Vec<String>,
}

/// One audience an admin can pin a starting assistant for.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct ExperienceAudience {
    /// Matched against `MeProfile.groups` (rego `input.groups`), not the
    /// `Subject`'s `organization_group_ids` — the wrong one silently matches
    /// nothing.
    pub entra_group_id: String,
    /// An `assistant_hub_assistants.id`, never an `assistants.id`:
    /// `clone_source_assistant` mints a fresh `assistants.id` on every
    /// republish, so a stored one goes stale silently. Resolved to the live
    /// id at read time via `get_published_current_version`.
    pub pinned_assistant_hub_assistant_id: Uuid,
}

/// Parse and structurally validate an experience policy document.
///
/// A typo'd audience name in `priority_order` would otherwise silently never
/// match. Audiences absent from `priority_order` are allowed (staged rollout).
pub fn parse_experience_policy(contents: &str) -> Result<ExperiencePolicyDocument, Report> {
    let document: ExperiencePolicyDocument = serde_json::from_str(contents)?;

    let mut seen = HashSet::new();
    for name in &document.priority_order {
        if !document.audiences.contains_key(name) {
            return Err(eyre!("priority_order names unknown audience \"{name}\""));
        }
        if !seen.insert(name.as_str()) {
            return Err(eyre!(
                "priority_order lists audience \"{name}\" more than once"
            ));
        }
    }

    for (name, audience) in &document.audiences {
        if audience.entra_group_id.trim().is_empty() {
            return Err(eyre!("audience \"{name}\" has an empty entra_group_id"));
        }
    }

    Ok(document)
}

/// Return the slug encoded by an admin-panel experience policy filename.
///
/// Experience policy files intentionally have a narrow name contract:
/// `experience/<slug>.json`. Rejecting all other paths keeps loading
/// independent of filesystem path handling, as `translation_locale` does.
#[must_use]
pub fn experience_policy_slug(filename: &str) -> Option<&str> {
    let slug = filename
        .strip_prefix("experience/")?
        .strip_suffix(".json")?;
    if slug.is_empty()
        || slug.contains('/')
        || !slug
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return None;
    }
    Some(slug)
}

/// Build the filename for a policy slug, validating by round-tripping through
/// [`experience_policy_slug`] so parser and writer cannot drift.
pub fn experience_policy_filename(slug: &str) -> Result<String, Report> {
    if experience_policy_slug(&format!("experience/{slug}.json")) != Some(slug) {
        return Err(eyre!("invalid experience policy slug"));
    }
    Ok(format!("experience/{slug}.json"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_experience_policy_filenames() {
        assert_eq!(
            experience_policy_slug("experience/policy.json"),
            Some("policy")
        );
        assert_eq!(
            experience_policy_slug("experience/draft-v2.json"),
            Some("draft-v2")
        );
        assert_eq!(experience_policy_slug("experience/policy.toml"), None);
        assert_eq!(experience_policy_slug("experience/nested/x.json"), None);
        assert_eq!(experience_policy_slug("../experience/policy.json"), None);
        assert_eq!(experience_policy_slug("experience/.json"), None);
    }

    #[test]
    fn filename_round_trips_through_the_slug_parser() {
        let filename = experience_policy_filename(EXPERIENCE_POLICY_SLUG).unwrap();
        assert_eq!(filename, "experience/policy.json");
        assert_eq!(
            experience_policy_slug(&filename),
            Some(EXPERIENCE_POLICY_SLUG)
        );

        assert!(experience_policy_filename("").is_err());
        assert!(experience_policy_filename("nested/slug").is_err());
        assert!(experience_policy_filename("dotted.slug").is_err());
    }

    #[test]
    fn parses_a_full_document() {
        let document = parse_experience_policy(
            r#"{
                "audiences": {
                    "engineering": {
                        "entra_group_id": "8f7cb1f3-5c92-4e0f-9c39-89f65a852101",
                        "pinned_assistant_hub_assistant_id": "6a3d2c76-2f6e-4e6f-8ad0-1f8f8f4f2a01"
                    },
                    "sales": {
                        "entra_group_id": "1f2e3d4c-5b6a-4978-8899-aabbccddeeff",
                        "pinned_assistant_hub_assistant_id": "0b1c2d3e-4f50-4161-8273-8495a6b7c8d9"
                    }
                },
                "priority_order": ["sales", "engineering"]
            }"#,
        )
        .unwrap();

        assert_eq!(document.priority_order, vec!["sales", "engineering"]);
        assert_eq!(document.audiences.len(), 2);
        let engineering = &document.audiences["engineering"];
        assert_eq!(
            engineering.entra_group_id,
            "8f7cb1f3-5c92-4e0f-9c39-89f65a852101"
        );
        assert_eq!(
            engineering.pinned_assistant_hub_assistant_id,
            "6a3d2c76-2f6e-4e6f-8ad0-1f8f8f4f2a01"
                .parse::<Uuid>()
                .unwrap()
        );
    }

    #[test]
    fn rejects_priority_order_naming_an_unknown_audience() {
        let error = parse_experience_policy(
            r#"{
                "audiences": {
                    "engineering": {
                        "entra_group_id": "8f7cb1f3-5c92-4e0f-9c39-89f65a852101",
                        "pinned_assistant_hub_assistant_id": "6a3d2c76-2f6e-4e6f-8ad0-1f8f8f4f2a01"
                    }
                },
                "priority_order": ["enginering"]
            }"#,
        )
        .unwrap_err();
        assert!(error.to_string().contains("unknown audience"));
    }

    #[test]
    fn rejects_duplicate_priority_order_entries() {
        let error = parse_experience_policy(
            r#"{
                "audiences": {
                    "engineering": {
                        "entra_group_id": "8f7cb1f3-5c92-4e0f-9c39-89f65a852101",
                        "pinned_assistant_hub_assistant_id": "6a3d2c76-2f6e-4e6f-8ad0-1f8f8f4f2a01"
                    }
                },
                "priority_order": ["engineering", "engineering"]
            }"#,
        )
        .unwrap_err();
        assert!(error.to_string().contains("more than once"));
    }

    #[test]
    fn rejects_an_empty_entra_group_id() {
        let error = parse_experience_policy(
            r#"{
                "audiences": {
                    "engineering": {
                        "entra_group_id": "   ",
                        "pinned_assistant_hub_assistant_id": "6a3d2c76-2f6e-4e6f-8ad0-1f8f8f4f2a01"
                    }
                }
            }"#,
        )
        .unwrap_err();
        assert!(error.to_string().contains("empty entra_group_id"));
    }

    #[test]
    fn accepts_unknown_fields_from_newer_writers() {
        let document = parse_experience_policy(
            r#"{
                "audiences": {
                    "engineering": {
                        "entra_group_id": "8f7cb1f3-5c92-4e0f-9c39-89f65a852101",
                        "pinned_assistant_hub_assistant_id": "6a3d2c76-2f6e-4e6f-8ad0-1f8f8f4f2a01",
                        "future_audience_field": true
                    }
                },
                "priority_order": ["engineering"],
                "future_top_level_field": {"nested": 1}
            }"#,
        )
        .unwrap();
        assert_eq!(document.priority_order, vec!["engineering"]);
    }

    #[test]
    fn parses_an_empty_document_to_defaults() {
        let document = parse_experience_policy("{}").unwrap();
        assert_eq!(document, ExperiencePolicyDocument::default());
    }
}
