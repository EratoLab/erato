//! Org-wide experience policy document, written by the admin panel as a
//! `runtime_configuration` row (source type `experience_policy`) and read back
//! on every reload. This is the policy document only; resolving it for a user
//! happens in `server::api::v1beta::starting_assistant`.

use chrono::{DateTime, Utc};
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

/// One subject an audience is composed of, in the same vocabulary a
/// `share_grants` row uses for `subject_type` / `subject_id_type` /
/// `subject_id` (see [`crate::models::share_grant`]).
///
/// Deliberately identity-provider agnostic: nothing on this path interprets an
/// id, it only compares it to what the token carried. Turning an id into a
/// human-readable name is the only Entra-specific step, and it happens in the
/// admin panel against MS Graph — the last possible moment.
///
/// The `subject_id_type` half of the share-grant triple is not on the wire
/// because each variant admits exactly one, so encoding it would only create
/// illegal states to validate:
///
/// | variant              | share-grant `subject_type` | `subject_id_type`       |
/// | -------------------- | -------------------------- | ----------------------- |
/// | `organization`       | `organization`             | `organization_id`       |
/// | `organization_group` | `organization_group`       | `organization_group_id` |
/// | `user`               | `user`                     | `organization_user_id`  |
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(tag = "subject_type", rename_all = "snake_case")]
pub enum AudienceSubject {
    /// Everyone who is authenticated — the org-wide audience. Mirrors a share
    /// grant whose subject is
    /// [`ORGANIZATION_SUBJECT_TYPE`](crate::models::share_grant::ORGANIZATION_SUBJECT_TYPE)
    /// and carries no per-user identifier.
    ///
    /// This says "this applies to everyone", which is not the same as "everyone
    /// not matched above": placed first in `priority_order` it shadows every
    /// audience below it, placed last it is a catch-all default.
    Organization,
    /// A directory group the caller is a member of.
    ///
    /// Matched against `MeProfile.groups` (rego `input.groups`), not the
    /// `Subject`'s `organization_group_ids` — the wrong one silently matches
    /// nothing.
    OrganizationGroup {
        /// The group's id as the identity provider writes it into the token's
        /// `groups` claim.
        group_id: String,
    },
    /// One named person, so an audience can pick up a handful of individuals
    /// without an IT department minting a group for three people.
    User {
        /// The caller's directory user id — the `oid` claim, surfaced as
        /// `MeProfile.organization_user_id`, and the id
        /// `GET /me/organization/users` hands a people-picker.
        ///
        /// Not the internal `users.id`: that row only exists once the person
        /// has logged in at least once, and an audience has to be able to name
        /// someone before their first login.
        organization_user_id: String,
    },
}

impl AudienceSubject {
    /// The wire tag for this variant, for error and log messages.
    #[must_use]
    pub fn subject_type(&self) -> &'static str {
        match self {
            Self::Organization => "organization",
            Self::OrganizationGroup { .. } => "organization_group",
            Self::User { .. } => "user",
        }
    }

    /// The id this subject names, or `None` for the org-wide subject, which
    /// names no one in particular.
    #[must_use]
    pub fn subject_id(&self) -> Option<&str> {
        match self {
            Self::Organization => None,
            Self::OrganizationGroup { group_id } => Some(group_id),
            Self::User {
                organization_user_id,
            } => Some(organization_user_id),
        }
    }
}

/// One audience an admin can pin a starting assistant for.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct ExperienceAudience {
    /// The subjects this audience is composed of. A person is in the audience
    /// if **any** subject matches them, so groups, named individuals and the
    /// whole organization compose freely — the same way a resource can be
    /// shared with several subjects at once.
    ///
    /// Required and non-empty: an audience that matches nobody is a mistake
    /// worth failing the whole document over, not a silently inert entry.
    pub subjects: Vec<AudienceSubject>,
    /// An `assistant_hub_assistants.id`, never an `assistants.id`:
    /// `clone_source_assistant` mints a fresh `assistants.id` on every
    /// republish, so a stored one goes stale silently. Resolved to the live
    /// id at read time via `get_published_current_version`.
    pub pinned_assistant_hub_assistant_id: Uuid,
    /// When this audience stops applying. Absent means it never expires.
    ///
    /// Per-audience, not per-setting — the fork is noted in ERMAIN-706 §10 and
    /// deliberately not re-argued while one setting exists. Evaluated at read
    /// time only, never filtered at parse or load: an expired audience stays in
    /// `audiences` and `priority_order` so the admin panel can show it inert
    /// rather than gone. Parsing checks well-formedness only — a past value
    /// must parse. Mirrored by the admin panel in `model/audiencePolicy.ts`.
    #[serde(default)]
    pub expires_at: Option<DateTime<Utc>>,
}

impl ExperienceAudience {
    /// Active iff `now < expires_at`: at the expiry instant itself the audience
    /// is already inert. The panel mirror transliterates exactly this rule.
    #[must_use]
    pub fn is_active_at(&self, now: DateTime<Utc>) -> bool {
        self.expires_at.is_none_or(|expires_at| now < expires_at)
    }
}

/// Parse and structurally validate an experience policy document.
///
/// A typo'd audience name in `priority_order` would otherwise silently never
/// match. Audiences absent from `priority_order` are allowed (staged rollout).
///
/// An unknown `subject_type` and a subject missing its id are rejected by the
/// derived `Deserialize` for [`AudienceSubject`]; what is left for this
/// function is the structure serde cannot express — an audience matching
/// nobody, and an id that is present but blank.
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
        if audience.subjects.is_empty() {
            return Err(eyre!("audience \"{name}\" has no subjects"));
        }
        for subject in &audience.subjects {
            if subject.subject_id().is_some_and(|id| id.trim().is_empty()) {
                return Err(eyre!(
                    "audience \"{name}\" has a {} subject with an empty id",
                    subject.subject_type()
                ));
            }
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
                        "subjects": [
                            {"subject_type": "organization_group", "group_id": "8f7cb1f3-5c92-4e0f-9c39-89f65a852101"},
                            {"subject_type": "organization_group", "group_id": "2c4e6a80-1111-4222-8333-444455556666"},
                            {"subject_type": "user", "organization_user_id": "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a"}
                        ],
                        "pinned_assistant_hub_assistant_id": "6a3d2c76-2f6e-4e6f-8ad0-1f8f8f4f2a01"
                    },
                    "everyone": {
                        "subjects": [{"subject_type": "organization"}],
                        "pinned_assistant_hub_assistant_id": "0b1c2d3e-4f50-4161-8273-8495a6b7c8d9"
                    }
                },
                "priority_order": ["engineering", "everyone"]
            }"#,
        )
        .unwrap();

        assert_eq!(document.priority_order, vec!["engineering", "everyone"]);
        assert_eq!(document.audiences.len(), 2);

        let engineering = &document.audiences["engineering"];
        assert_eq!(
            engineering.subjects,
            vec![
                AudienceSubject::OrganizationGroup {
                    group_id: "8f7cb1f3-5c92-4e0f-9c39-89f65a852101".to_string(),
                },
                AudienceSubject::OrganizationGroup {
                    group_id: "2c4e6a80-1111-4222-8333-444455556666".to_string(),
                },
                AudienceSubject::User {
                    organization_user_id: "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a".to_string(),
                },
            ]
        );
        assert_eq!(
            engineering.pinned_assistant_hub_assistant_id,
            "6a3d2c76-2f6e-4e6f-8ad0-1f8f8f4f2a01"
                .parse::<Uuid>()
                .unwrap()
        );

        assert_eq!(
            document.audiences["everyone"].subjects,
            vec![AudienceSubject::Organization]
        );

        // Documents written before expiry existed deserialise to "never
        // expires".
        assert_eq!(engineering.expires_at, None);
    }

    #[test]
    fn expires_at_offsets_normalise_to_one_utc_instant() {
        // chrono accepts any RFC 3339 offset on ingest; erato compares
        // instants, so these two spellings must parse equal.
        let mut parsed = ["2026-09-08T00:00:00Z", "2026-09-08T02:00:00+02:00"]
            .into_iter()
            .map(|timestamp| {
                let document = parse_experience_policy(&format!(
                    r#"{{
                        "audiences": {{
                            "announcement": {{
                                "subjects": [{{"subject_type": "organization"}}],
                                "pinned_assistant_hub_assistant_id": "6a3d2c76-2f6e-4e6f-8ad0-1f8f8f4f2a01",
                                "expires_at": "{timestamp}"
                            }}
                        }},
                        "priority_order": ["announcement"]
                    }}"#
                ))
                .unwrap();
                document.audiences["announcement"].expires_at.unwrap()
            });
        let (zulu, offset) = (parsed.next().unwrap(), parsed.next().unwrap());
        assert_eq!(zulu, offset);
        assert_eq!(
            zulu,
            "2026-09-08T00:00:00Z".parse::<DateTime<Utc>>().unwrap()
        );
    }

    #[test]
    fn a_past_expires_at_parses_with_the_audience_still_present() {
        // Expiry is evaluated at read time; parsing an expired audience out of
        // the document would make it invisible to the panel instead of inert.
        let document = parse_experience_policy(
            r#"{
                "audiences": {
                    "announcement": {
                        "subjects": [{"subject_type": "organization"}],
                        "pinned_assistant_hub_assistant_id": "6a3d2c76-2f6e-4e6f-8ad0-1f8f8f4f2a01",
                        "expires_at": "1999-01-01T00:00:00Z"
                    }
                },
                "priority_order": ["announcement"]
            }"#,
        )
        .unwrap();
        assert!(document.audiences.contains_key("announcement"));
        assert_eq!(document.priority_order, vec!["announcement"]);
    }

    #[test]
    fn rejects_a_malformed_expires_at() {
        // Whole-document reject (keep-previous + error log upstream): the
        // panel BFF validates every write with this parser, so only a
        // hand-written row can hit this, and it should fail loudly.
        for timestamp in ["next tuesday", "2026-09-08", "2026-09-08T00:00:00"] {
            assert!(
                parse_experience_policy(&format!(
                    r#"{{
                        "audiences": {{
                            "announcement": {{
                                "subjects": [{{"subject_type": "organization"}}],
                                "pinned_assistant_hub_assistant_id": "6a3d2c76-2f6e-4e6f-8ad0-1f8f8f4f2a01",
                                "expires_at": "{timestamp}"
                            }}
                        }}
                    }}"#
                ))
                .is_err(),
                "expected {timestamp:?} to reject the document"
            );
        }
    }

    #[test]
    fn is_active_at_boundary_is_exact() {
        let expires_at = "2026-09-08T00:00:00Z".parse::<DateTime<Utc>>().unwrap();
        let audience = ExperienceAudience {
            subjects: vec![AudienceSubject::Organization],
            pinned_assistant_hub_assistant_id: Uuid::new_v4(),
            expires_at: Some(expires_at),
        };
        assert!(audience.is_active_at(expires_at - chrono::Duration::seconds(1)));
        assert!(!audience.is_active_at(expires_at));

        let never_expires = ExperienceAudience {
            expires_at: None,
            ..audience
        };
        assert!(never_expires.is_active_at("9999-12-31T23:59:59Z".parse().unwrap()));
    }

    #[test]
    fn rejects_priority_order_naming_an_unknown_audience() {
        let error = parse_experience_policy(
            r#"{
                "audiences": {
                    "engineering": {
                        "subjects": [{"subject_type": "organization_group", "group_id": "8f7cb1f3-5c92-4e0f-9c39-89f65a852101"}],
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
                        "subjects": [{"subject_type": "organization_group", "group_id": "8f7cb1f3-5c92-4e0f-9c39-89f65a852101"}],
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
    fn rejects_an_audience_with_no_subjects() {
        let error = parse_experience_policy(
            r#"{
                "audiences": {
                    "engineering": {
                        "subjects": [],
                        "pinned_assistant_hub_assistant_id": "6a3d2c76-2f6e-4e6f-8ad0-1f8f8f4f2a01"
                    }
                }
            }"#,
        )
        .unwrap_err();
        assert!(error.to_string().contains("has no subjects"));
    }

    #[test]
    fn rejects_a_subject_with_a_blank_id() {
        for (subject, expected) in [
            (
                r#"{"subject_type": "organization_group", "group_id": "   "}"#,
                "organization_group subject with an empty id",
            ),
            (
                r#"{"subject_type": "user", "organization_user_id": ""}"#,
                "user subject with an empty id",
            ),
        ] {
            let error = parse_experience_policy(&format!(
                r#"{{
                    "audiences": {{
                        "engineering": {{
                            "subjects": [{subject}],
                            "pinned_assistant_hub_assistant_id": "6a3d2c76-2f6e-4e6f-8ad0-1f8f8f4f2a01"
                        }}
                    }}
                }}"#
            ))
            .unwrap_err();
            assert!(
                error.to_string().contains(expected),
                "expected {expected:?} in {error}"
            );
        }
    }

    #[test]
    fn rejects_an_unknown_or_malformed_subject() {
        // An unknown `subject_type`, and a known one missing its id, are both
        // rejected by the derived Deserialize rather than reaching the
        // resolver as a subject that can never match.
        for subject in [
            r#"{"subject_type": "entra_group", "group_id": "g"}"#,
            r#"{"subject_type": "organization_group"}"#,
            r#"{"subject_type": "user", "group_id": "g"}"#,
            r#"{"group_id": "g"}"#,
        ] {
            assert!(
                parse_experience_policy(&format!(
                    r#"{{
                        "audiences": {{
                            "engineering": {{
                                "subjects": [{subject}],
                                "pinned_assistant_hub_assistant_id": "6a3d2c76-2f6e-4e6f-8ad0-1f8f8f4f2a01"
                            }}
                        }}
                    }}"#
                ))
                .is_err(),
                "expected {subject} to be rejected"
            );
        }
    }

    #[test]
    fn rejects_the_superseded_single_group_audience_shape() {
        // The pre-review shape carried one `entra_group_id` per audience. It is
        // a clean break, not an alias: `subjects` is required, so a stale
        // document fails loudly in `ReloadableAppState::load` (which keeps the
        // previous policy and logs) rather than silently matching nobody.
        let error = parse_experience_policy(
            r#"{
                "audiences": {
                    "engineering": {
                        "entra_group_id": "8f7cb1f3-5c92-4e0f-9c39-89f65a852101",
                        "pinned_assistant_hub_assistant_id": "6a3d2c76-2f6e-4e6f-8ad0-1f8f8f4f2a01"
                    }
                },
                "priority_order": ["engineering"]
            }"#,
        )
        .unwrap_err();
        assert!(error.to_string().contains("subjects"));
    }

    #[test]
    fn accepts_unknown_fields_from_newer_writers() {
        let document = parse_experience_policy(
            r#"{
                "audiences": {
                    "engineering": {
                        "subjects": [{
                            "subject_type": "organization_group",
                            "group_id": "8f7cb1f3-5c92-4e0f-9c39-89f65a852101",
                            "future_subject_field": "display name"
                        }],
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
