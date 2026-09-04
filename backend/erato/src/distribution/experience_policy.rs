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

/// The `setting_orders` key of the one live setting. Also the only setting
/// `priority_order` ever encoded, which is why it alone has a legacy fallback
/// in [`resolution_order_for`].
pub const STARTING_ASSISTANT_SETTING: &str = "starting_assistant";

/// The shared resolution-contract fixture: the cases every resolver of this
/// document must agree on. Downstream consumers keep a copy (the admin panel
/// does) and assert it against this one byte for byte; the
/// `starting_assistant` harness in this crate runs it.
pub const EXPERIENCE_POLICY_RESOLUTION_CONTRACT: &str =
    include_str!("experience_policy_resolution_contract.json");

/// The org-wide experience policy: which audiences exist and in which order
/// they are resolved for a user.
///
/// Deliberately not `deny_unknown_fields`, so a newer admin panel writing an
/// unknown field does not wedge the backend into keep-previous forever during
/// a mixed-version deployment.
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
pub struct ExperiencePolicyDocument {
    /// Keyed by DISPLAY NAME, which moves on rename — the reason
    /// [`ExperienceAudience::id`] exists. ERMAIN-706 §10 item 5 recorded when
    /// `priority_order` may be dropped (below), but re-keying this map by id
    /// is the bigger break, because the name-spelled key is coupled four
    /// ways: legacy `priority_order` names audiences by it; parse validation
    /// and the agreement invariant join on it (`priority_order`'s
    /// unknown-name check, and the id-belongs-to-the-name-at-this-position
    /// walk); it is externally visible as `audience` on
    /// `GET /me/starting-assistant`; and three tracing events in
    /// `starting_assistant` tag it. Only `resolution_order_for`'s id path
    /// already ignores it.
    ///
    /// A one-time re-key may therefore happen only after, in order: a
    /// value-held `name` field is dual-written into every audience → every
    /// replica reports and tags from the value-held name, never the key →
    /// `priority_order` is already dropped (its gate below is strictly
    /// contained by this one: a name-spelled order cannot outlive the
    /// name-spelled key) → the writer is pinned last. A floor on what the
    /// org runs, not a Cargo pin. Recorded only — nothing is dropped or
    /// re-keyed here.
    #[serde(default)]
    pub audiences: HashMap<String, ExperienceAudience>,
    /// Precedence lives in this separate ordered key, like
    /// `chat_providers.priority_order` and `language_detection_priority` —
    /// never in the map above, whose `HashMap` iteration order is arbitrary.
    /// An audience absent from here can never win.
    ///
    /// Since `setting_orders` arrived this is the LEGACY spelling of the
    /// starting-assistant order: dual-written by every new save and required
    /// by [`parse_experience_policy`] to agree with
    /// `setting_orders["starting_assistant"]`, because a pre-`setting_orders`
    /// erato resolves exclusively from here and a mixed-version deployment
    /// must not change any winner. That agreement check also rejects a
    /// document whose legacy list is absent or empty beside a non-empty
    /// starting-assistant order, so this list cannot be dropped while any
    /// replica runs an erato with the check: it may go only once every
    /// replica runs an erato whose parser no longer requires the two orders
    /// to agree, and then only from a writer pinned to that erato — a floor
    /// on what the org runs, not on any Cargo pin.
    #[serde(default)]
    pub priority_order: Vec<String>,
    /// One TOTAL first-match-wins order per setting, in audience ids — the
    /// per-setting successor to `priority_order` (ERMAIN-706 §10 item 5:
    /// order is a property of a setting, not of the audience list). An
    /// audience absent from a setting's order can never win that setting
    /// (staged), mirroring `priority_order`'s absence rule — while the setting
    /// has an entry here. When the `starting_assistant` key is absent,
    /// [`resolution_order_for`] falls back to `priority_order` for that one
    /// setting (the test
    /// `resolution_order_falls_back_to_the_legacy_list_only_for_the_starting_assistant`).
    ///
    /// Unknown setting KEYS parse — the same mixed-version stance as unknown
    /// fields — but every VALUE is validated uniformly, so a typo'd id fails
    /// loudly instead of silently never matching. The flat `Vec<String>`
    /// value type is a contract: a richer per-setting shape gets a NEW
    /// top-level field, never a reshaped value here.
    #[serde(default)]
    pub setting_orders: HashMap<String, Vec<String>>,
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
    /// not matched above": placed first in `priority_order` (or in a setting's
    /// `setting_orders` entry) it shadows every audience below it, placed last
    /// it is a catch-all default.
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
    /// A stable identity for this audience, minted by the admin panel. The
    /// `audiences` map key is the display name and changes on rename, so
    /// anything that must survive a rename — detail-page URLs, the
    /// `setting_orders` entries — keys on this instead. Opaque and
    /// uninterpreted, like subject ids: erato only ever compares it. Absent
    /// on documents written before ids existed, which must keep resolving
    /// without anyone re-saving them.
    #[serde(default)]
    pub id: Option<String>,
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
    /// `audiences`, `priority_order` and every `setting_orders` entry so the
    /// admin panel can show it inert rather than gone. Parsing checks
    /// well-formedness only — a past value must parse. Mirrored by the admin
    /// panel in `model/audiencePolicy.ts`.
    #[serde(default)]
    pub expires_at: Option<DateTime<Utc>>,
    /// Where a snapshot audience came from — see [`AudienceProvenance`] for
    /// what it may never be used for. Absent means the document predates
    /// provenance or the audience was not minted from an overlap, and absent
    /// stays absent: erato never writes this document, so a legacy row is
    /// never rewritten with the key (the S14f stance).
    #[serde(default)]
    pub provenance: Option<AudienceProvenance>,
}

impl ExperienceAudience {
    /// Active iff `now < expires_at`: at the expiry instant itself the audience
    /// is already inert. The panel mirror transliterates exactly this rule.
    #[must_use]
    pub fn is_active_at(&self, now: DateTime<Utc>) -> bool {
        self.expires_at.is_none_or(|expires_at| now < expires_at)
    }
}

/// The origin of a snapshot audience: which pair it was promoted from and
/// when the overlap was read (ERMAIN-706 §5, scenario S14).
///
/// A record of ORIGIN, never an input to matching. The subjects are the
/// policy; provenance only says where they came from and what a drift check
/// would compare against. No resolution path may read it — an audience with
/// provenance must resolve byte-identically to its provenance-stripped twin
/// (`a_document_resolves_identically_to_its_provenance_stripped_twin`), which
/// is also why a dangling source reference is harmless: nothing joins on it.
///
/// Deserialize-only by design: the admin panel is the sole writer of this
/// document, so erato can never be the one to invent or rewrite provenance.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct AudienceProvenance {
    /// What kind of origin this records. Uninterpreted and deliberately not a
    /// closed enum: a newer panel minting a new kind must not wedge an older
    /// erato into keep-previous.
    pub kind: String,
    pub source_a: AudienceProvenanceSource,
    pub source_b: AudienceProvenanceSource,
    /// When the overlap was read from the directory — the "as of" a drift
    /// check reports against. Malformed rejects the whole document, the
    /// `rejects_a_malformed_expires_at` stance: only a hand-written row can
    /// carry one, and it should fail loudly.
    pub taken_at: DateTime<Utc>,
}

/// One side of the pair a snapshot audience was promoted from.
///
/// Both ids are frozen copies, not live references: the source audience can
/// be renamed, re-grouped or deleted after the snapshot without touching this
/// record, and [`parse_experience_policy`] deliberately never checks them
/// against the rest of the document (S14g).
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct AudienceProvenanceSource {
    pub audience_id: String,
    /// The display name at snapshot time — the map key then, which a rename
    /// moves; kept so the origin stays legible after the source is gone.
    pub audience_name: String,
    /// The source's group subject ids at snapshot time, for a future drift
    /// check to re-ask the directory about.
    pub group_ids: Vec<String>,
}

/// Parse and structurally validate an experience policy document.
///
/// A typo'd audience name in `priority_order` would otherwise silently never
/// match. Audiences absent from `priority_order` are allowed (staged rollout).
///
/// An unknown `subject_type` and a subject missing its id are rejected by the
/// derived `Deserialize` for [`AudienceSubject`]; what is left for this
/// function is the structure serde cannot express — an audience matching
/// nobody, an id that is present but blank or duplicated, a `setting_orders`
/// entry naming no audience, and the starting-assistant agreement invariant.
///
/// [`AudienceProvenance`] gets type-level validation ONLY — no structural or
/// cross-reference checks here, by decision (S14g): nothing joins on
/// provenance, so a reference check would let a deleted source audience kill
/// the whole document instead of leaving a harmless dangling record.
///
/// The AGREEMENT INVARIANT: whenever `setting_orders` carries the
/// `starting_assistant` key, that order and `priority_order` must be the same
/// order — same length, and the id at each position belongs to the audience
/// named at that position. A pre-`setting_orders` erato resolves exclusively
/// from `priority_order`, so any document where the two could disagree —
/// including one carrying only the new key — would resolve differently on old
/// and new readers; rejecting it whole (keep-previous + log upstream) means
/// no parseable document can make reader precedence matter.
///
/// The same-length half of that check is what pins the lifecycle of
/// [`ExperiencePolicyDocument::priority_order`]: N ids beside an absent or
/// empty legacy list is a disagreement, so that list may stop being written
/// only once every replica runs an erato without this check, and then only
/// from a writer pinned to that erato.
///
/// Both maps are walked in sorted key order so that a document with more
/// than one defect reports the same one on every parse.
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

    let mut audience_ids = HashSet::new();
    let mut audiences: Vec<_> = document.audiences.iter().collect();
    audiences.sort_by_key(|(name, _)| *name);
    for (name, audience) in audiences {
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
        if let Some(id) = audience.id.as_deref() {
            if id.trim().is_empty() {
                return Err(eyre!("audience \"{name}\" has a blank id"));
            }
            if !audience_ids.insert(id) {
                return Err(eyre!("audience id \"{id}\" is used more than once"));
            }
        }
    }

    let mut setting_orders: Vec<_> = document.setting_orders.iter().collect();
    setting_orders.sort_by_key(|(setting, _)| *setting);
    for (setting, order) in setting_orders {
        let mut seen_ids = HashSet::new();
        for id in order {
            if !audience_ids.contains(id.as_str()) {
                return Err(eyre!(
                    "setting_orders[\"{setting}\"] names unknown audience id \"{id}\""
                ));
            }
            if !seen_ids.insert(id.as_str()) {
                return Err(eyre!(
                    "setting_orders[\"{setting}\"] lists audience id \"{id}\" more than once"
                ));
            }
        }
    }

    if let Some(starting_order) = document.setting_orders.get(STARTING_ASSISTANT_SETTING) {
        if starting_order.len() != document.priority_order.len() {
            return Err(eyre!(
                "setting_orders[\"{STARTING_ASSISTANT_SETTING}\"] and priority_order disagree: \
                 {} ids versus {} names",
                starting_order.len(),
                document.priority_order.len()
            ));
        }
        for (position, (id, name)) in starting_order
            .iter()
            .zip(&document.priority_order)
            .enumerate()
        {
            let named_id = document
                .audiences
                .get(name)
                .and_then(|audience| audience.id.as_deref());
            if named_id != Some(id.as_str()) {
                return Err(eyre!(
                    "setting_orders[\"{STARTING_ASSISTANT_SETTING}\"] and priority_order disagree \
                     at position {position}: id \"{id}\" does not belong to audience \"{name}\""
                ));
            }
        }
    }

    Ok(document)
}

/// The audiences to try for `setting`, first-match-wins — the ONE home for
/// reader precedence: the setting's `setting_orders` entry when the key is
/// present (even empty; the agreement invariant guarantees a parseable
/// document cannot diverge from the legacy list), else the legacy
/// `priority_order` for the starting assistant — the only setting that list
/// ever encoded, so no other setting gets a fallback. Entries naming an
/// unknown id or name are skipped so resolution stays total even over a
/// document the parser would reject (the `skips_unknown_priority_order_entries`
/// precedent).
///
/// Deterministic for every document, including ones the parser rejects: when
/// two audiences share an id, the one with the smaller name resolves for that
/// id, never whichever the `audiences` map happens to yield first.
pub fn resolution_order_for<'a>(
    policy: &'a ExperiencePolicyDocument,
    setting: &str,
) -> impl Iterator<Item = (&'a str, &'a ExperienceAudience)> + use<'a> {
    let mut index: HashMap<&'a str, (&'a str, &'a ExperienceAudience)> = HashMap::new();
    for (name, audience) in &policy.audiences {
        if let Some(id) = audience.id.as_deref() {
            let held = index.entry(id).or_insert((name.as_str(), audience));
            if name.as_str() < held.0 {
                *held = (name.as_str(), audience);
            }
        }
    }

    let by_id = policy.setting_orders.get(setting);
    let legacy = (by_id.is_none() && setting == STARTING_ASSISTANT_SETTING)
        .then_some(&policy.priority_order);
    by_id
        .into_iter()
        .flatten()
        .filter_map(move |id| index.get(id.as_str()).copied())
        .chain(
            legacy
                .into_iter()
                .flatten()
                .filter_map(move |name| policy.audiences.get_key_value(name))
                .map(|(name, audience)| (name.as_str(), audience)),
        )
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
            id: None,
            subjects: vec![AudienceSubject::Organization],
            pinned_assistant_hub_assistant_id: Uuid::new_v4(),
            expires_at: Some(expires_at),
            provenance: None,
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

    /// A two-audience dual-write document varying only its two order keys, so
    /// each agreement-invariant test states just the disagreement it is about.
    fn sales_hr_document(priority_order: &str, setting_orders: &str) -> String {
        format!(
            r#"{{
                "audiences": {{
                    "sales": {{
                        "id": "aud-sales",
                        "subjects": [{{"subject_type": "organization_group", "group_id": "sales-group-id"}}],
                        "pinned_assistant_hub_assistant_id": "6a3d2c76-2f6e-4e6f-8ad0-1f8f8f4f2a01"
                    }},
                    "hr": {{
                        "id": "aud-hr",
                        "subjects": [{{"subject_type": "organization_group", "group_id": "hr-group-id"}}],
                        "pinned_assistant_hub_assistant_id": "0b1c2d3e-4f50-4161-8273-8495a6b7c8d9"
                    }}
                }},
                "priority_order": {priority_order},
                "setting_orders": {setting_orders}
            }}"#
        )
    }

    fn identified(id: &str, group_id: &str) -> ExperienceAudience {
        ExperienceAudience {
            id: Some(id.to_string()),
            subjects: vec![AudienceSubject::OrganizationGroup {
                group_id: group_id.to_string(),
            }],
            pinned_assistant_hub_assistant_id: Uuid::new_v4(),
            expires_at: None,
            provenance: None,
        }
    }

    fn document_of(
        entries: Vec<(&str, ExperienceAudience)>,
        priority_order: Vec<&str>,
        setting_orders: Vec<(&str, Vec<&str>)>,
    ) -> ExperiencePolicyDocument {
        ExperiencePolicyDocument {
            audiences: entries
                .into_iter()
                .map(|(name, audience)| (name.to_string(), audience))
                .collect(),
            priority_order: priority_order.into_iter().map(str::to_string).collect(),
            setting_orders: setting_orders
                .into_iter()
                .map(|(setting, ids)| {
                    (
                        setting.to_string(),
                        ids.into_iter().map(str::to_string).collect(),
                    )
                })
                .collect(),
        }
    }

    fn order_names(policy: &ExperiencePolicyDocument, setting: &str) -> Vec<String> {
        resolution_order_for(policy, setting)
            .map(|(name, _)| name.to_string())
            .collect()
    }

    #[test]
    fn parses_audience_ids_and_setting_orders() {
        let document = parse_experience_policy(&sales_hr_document(
            r#"["sales", "hr"]"#,
            r#"{"starting_assistant": ["aud-sales", "aud-hr"]}"#,
        ))
        .unwrap();
        assert_eq!(document.audiences["sales"].id.as_deref(), Some("aud-sales"));
        assert_eq!(document.audiences["hr"].id.as_deref(), Some("aud-hr"));
        assert_eq!(
            document.setting_orders[STARTING_ASSISTANT_SETTING],
            vec!["aud-sales", "aud-hr"]
        );
    }

    #[test]
    fn legacy_documents_default_the_new_fields() {
        // S9d's enabler: a document written before ids existed keeps loading
        // and resolving with nobody re-saving it.
        let document = parse_experience_policy(
            r#"{
                "audiences": {
                    "engineering": {
                        "subjects": [{"subject_type": "organization_group", "group_id": "8f7cb1f3-5c92-4e0f-9c39-89f65a852101"}],
                        "pinned_assistant_hub_assistant_id": "6a3d2c76-2f6e-4e6f-8ad0-1f8f8f4f2a01"
                    }
                },
                "priority_order": ["engineering"]
            }"#,
        )
        .unwrap();
        assert_eq!(document.audiences["engineering"].id, None);
        assert!(document.setting_orders.is_empty());
        // S14f's erato half: absent provenance stays absent — and since this
        // side is Deserialize-only, it can never be the one to add it.
        assert_eq!(document.audiences["engineering"].provenance, None);
        assert_eq!(
            order_names(&document, STARTING_ASSISTANT_SETTING),
            ["engineering"]
        );
    }

    #[test]
    fn rejects_a_blank_audience_id() {
        for id in ["", "   "] {
            let error = parse_experience_policy(&format!(
                r#"{{
                    "audiences": {{
                        "engineering": {{
                            "id": "{id}",
                            "subjects": [{{"subject_type": "organization"}}],
                            "pinned_assistant_hub_assistant_id": "6a3d2c76-2f6e-4e6f-8ad0-1f8f8f4f2a01"
                        }}
                    }}
                }}"#
            ))
            .unwrap_err();
            assert!(
                error.to_string().contains("blank id"),
                "for {id:?}: {error}"
            );
        }
    }

    #[test]
    fn reports_the_same_defective_audience_on_every_parse() {
        // Two audiences with blank ids: every parse builds a fresh `HashMap`
        // with its own hash seed, so only a sorted walk can name the same
        // audience (the smaller key) each time.
        let contents = r#"{
            "audiences": {
                "beta": {
                    "id": "",
                    "subjects": [{"subject_type": "organization"}],
                    "pinned_assistant_hub_assistant_id": "6a3d2c76-2f6e-4e6f-8ad0-1f8f8f4f2a01"
                },
                "alpha": {
                    "id": "",
                    "subjects": [{"subject_type": "organization"}],
                    "pinned_assistant_hub_assistant_id": "0b1c2d3e-4f50-4161-8273-8495a6b7c8d9"
                }
            }
        }"#;
        for _ in 0..50 {
            let error = parse_experience_policy(contents).unwrap_err();
            assert_eq!(error.to_string(), "audience \"alpha\" has a blank id");
        }
    }

    #[test]
    fn rejects_duplicate_audience_ids() {
        let error = parse_experience_policy(
            r#"{
                "audiences": {
                    "sales": {
                        "id": "aud-1",
                        "subjects": [{"subject_type": "organization_group", "group_id": "sales-group-id"}],
                        "pinned_assistant_hub_assistant_id": "6a3d2c76-2f6e-4e6f-8ad0-1f8f8f4f2a01"
                    },
                    "hr": {
                        "id": "aud-1",
                        "subjects": [{"subject_type": "organization_group", "group_id": "hr-group-id"}],
                        "pinned_assistant_hub_assistant_id": "0b1c2d3e-4f50-4161-8273-8495a6b7c8d9"
                    }
                }
            }"#,
        )
        .unwrap_err();
        assert!(error.to_string().contains("more than once"));
    }

    #[test]
    fn rejects_a_setting_order_naming_an_unknown_id() {
        let error = parse_experience_policy(&sales_hr_document(
            r#"["sales", "hr"]"#,
            r#"{"welcome_banner": ["ghost"]}"#,
        ))
        .unwrap_err();
        assert!(error.to_string().contains("unknown audience id"));
    }

    #[test]
    fn reports_the_same_defective_setting_order_on_every_parse() {
        // Two setting keys each naming an unknown id: the smaller key is the
        // one reported, regardless of the fresh hash seed each parse gets.
        for _ in 0..50 {
            let error = parse_experience_policy(&sales_hr_document(
                r#"["sales", "hr"]"#,
                r#"{"beta": ["ghost"], "alpha": ["ghost"]}"#,
            ))
            .unwrap_err();
            assert_eq!(
                error.to_string(),
                "setting_orders[\"alpha\"] names unknown audience id \"ghost\""
            );
        }
    }

    #[test]
    fn rejects_duplicate_ids_within_one_setting_order() {
        let error = parse_experience_policy(&sales_hr_document(
            r#"["sales", "hr"]"#,
            r#"{"welcome_banner": ["aud-sales", "aud-sales"]}"#,
        ))
        .unwrap_err();
        assert!(error.to_string().contains("more than once"));
    }

    #[test]
    fn accepts_unknown_setting_keys_with_valid_values() {
        // Unknown KEYS are the mixed-version stance; the VALUES are still held
        // to the uniform id rules, which the two rejection tests above pin.
        let document = parse_experience_policy(&sales_hr_document(
            r#"["sales", "hr"]"#,
            r#"{"future_setting": ["aud-hr"], "another_future_setting": []}"#,
        ))
        .unwrap();
        assert_eq!(document.setting_orders["future_setting"], vec!["aud-hr"]);
        assert!(document.setting_orders["another_future_setting"].is_empty());

        // Empty agrees with empty: the smallest parseable dual document.
        let document =
            parse_experience_policy(&sales_hr_document(r#"[]"#, r#"{"starting_assistant": []}"#))
                .unwrap();
        assert!(document.setting_orders[STARTING_ASSISTANT_SETTING].is_empty());
    }

    #[test]
    fn rejects_a_starting_assistant_order_disagreeing_with_the_legacy_list() {
        // Every shape here would resolve differently on a pre-setting_orders
        // reader, which is the S10c bug the agreement invariant exists to make
        // unrepresentable. Note the key's PRESENCE triggers the check: a
        // document carrying only the new key (or only the legacy list beside
        // an empty new key) is a disagreement, not a partial write.
        for (priority_order, setting_orders) in [
            // Length mismatch.
            (
                r#"["sales", "hr"]"#,
                r#"{"starting_assistant": ["aud-sales"]}"#,
            ),
            // Same length, positions swapped.
            (
                r#"["sales", "hr"]"#,
                r#"{"starting_assistant": ["aud-hr", "aud-sales"]}"#,
            ),
            // The new key alone: invisible to an old reader, decisive to a new
            // one.
            (
                r#"[]"#,
                r#"{"starting_assistant": ["aud-sales", "aud-hr"]}"#,
            ),
            // Present but empty beside a non-empty legacy list: an old reader
            // resolves, a new one never would.
            (r#"["sales", "hr"]"#, r#"{"starting_assistant": []}"#),
        ] {
            let error = parse_experience_policy(&sales_hr_document(priority_order, setting_orders))
                .unwrap_err();
            assert!(
                error.to_string().contains("disagree"),
                "for {setting_orders}: {error}"
            );
        }
    }

    #[test]
    fn rejects_a_starting_assistant_order_over_an_audience_with_no_id() {
        // Position-wise agreement means the id at i must BELONG to the
        // audience named at i — an id-less audience there cannot agree with
        // anything, even another audience's valid id.
        let error = parse_experience_policy(
            r#"{
                "audiences": {
                    "sales": {
                        "subjects": [{"subject_type": "organization_group", "group_id": "sales-group-id"}],
                        "pinned_assistant_hub_assistant_id": "6a3d2c76-2f6e-4e6f-8ad0-1f8f8f4f2a01"
                    },
                    "hr": {
                        "id": "aud-hr",
                        "subjects": [{"subject_type": "organization_group", "group_id": "hr-group-id"}],
                        "pinned_assistant_hub_assistant_id": "0b1c2d3e-4f50-4161-8273-8495a6b7c8d9"
                    },
                    "engineering": {
                        "id": "aud-eng",
                        "subjects": [{"subject_type": "organization_group", "group_id": "eng-group-id"}],
                        "pinned_assistant_hub_assistant_id": "0b1c2d3e-4f50-4161-8273-8495a6b7c8d8"
                    }
                },
                "priority_order": ["sales", "hr"],
                "setting_orders": {"starting_assistant": ["aud-eng", "aud-hr"]}
            }"#,
        )
        .unwrap_err();
        assert!(error.to_string().contains("position 0"));
    }

    #[test]
    fn rejects_a_starting_assistant_order_disagreeing_past_position_zero() {
        // Positions 0 agree and position 1 does not, so a parser comparing
        // only the heads of the two orders would wrongly accept this. Three
        // audiences are needed: with two, any order agreeing at 0 and
        // diverging at 1 fails the per-setting id checks first.
        let error = parse_experience_policy(
            r#"{
                "audiences": {
                    "sales": {
                        "id": "aud-sales",
                        "subjects": [{"subject_type": "organization_group", "group_id": "sales-group-id"}],
                        "pinned_assistant_hub_assistant_id": "6a3d2c76-2f6e-4e6f-8ad0-1f8f8f4f2a01"
                    },
                    "hr": {
                        "id": "aud-hr",
                        "subjects": [{"subject_type": "organization_group", "group_id": "hr-group-id"}],
                        "pinned_assistant_hub_assistant_id": "0b1c2d3e-4f50-4161-8273-8495a6b7c8d9"
                    },
                    "engineering": {
                        "id": "aud-eng",
                        "subjects": [{"subject_type": "organization_group", "group_id": "eng-group-id"}],
                        "pinned_assistant_hub_assistant_id": "0b1c2d3e-4f50-4161-8273-8495a6b7c8d8"
                    }
                },
                "priority_order": ["sales", "hr", "engineering"],
                "setting_orders": {"starting_assistant": ["aud-sales", "aud-eng", "aud-hr"]}
            }"#,
        )
        .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("at position 1: id \"aud-eng\" does not belong to audience \"hr\""),
            "{error}"
        );
    }

    #[test]
    fn accepts_a_setting_order_that_is_not_a_subset_of_the_legacy_list() {
        // The agreement invariant binds only the starting-assistant order to
        // the legacy list; another setting may order audiences the legacy
        // list never mentions.
        let document = parse_experience_policy(&sales_hr_document(
            r#"["sales"]"#,
            r#"{"starting_assistant": ["aud-sales"], "welcome_banner": ["aud-hr", "aud-sales"]}"#,
        ))
        .unwrap();
        assert_eq!(
            order_names(&document, STARTING_ASSISTANT_SETTING),
            ["sales"]
        );
        assert_eq!(order_names(&document, "welcome_banner"), ["hr", "sales"]);
    }

    #[test]
    fn resolution_order_prefers_a_present_setting_orders_key() {
        // Constructed directly: the parser rejects any disagreeing document,
        // so a struct the wire cannot carry is the only way to observe which
        // path the reader takes.
        let entries = || {
            vec![
                ("sales", identified("aud-sales", "sales-group-id")),
                ("hr", identified("aud-hr", "hr-group-id")),
            ]
        };
        let policy = document_of(
            entries(),
            vec!["sales", "hr"],
            vec![(STARTING_ASSISTANT_SETTING, vec!["aud-hr"])],
        );
        assert_eq!(order_names(&policy, STARTING_ASSISTANT_SETTING), ["hr"]);

        // Present but empty is still the per-setting path — nobody can win —
        // not a fallback to the legacy list.
        let policy = document_of(
            entries(),
            vec!["sales", "hr"],
            vec![(STARTING_ASSISTANT_SETTING, vec![])],
        );
        assert!(
            resolution_order_for(&policy, STARTING_ASSISTANT_SETTING)
                .next()
                .is_none()
        );
    }

    #[test]
    fn resolution_order_falls_back_to_the_legacy_list_only_for_the_starting_assistant() {
        // Another setting's arrival must not perturb the fallback: the legacy
        // list only ever encoded the starting-assistant order, so no other
        // setting may inherit it.
        let policy = document_of(
            vec![
                ("sales", identified("aud-sales", "sales-group-id")),
                ("hr", identified("aud-hr", "hr-group-id")),
            ],
            vec!["hr", "sales"],
            vec![("welcome_banner", vec!["aud-sales"])],
        );
        assert_eq!(
            order_names(&policy, STARTING_ASSISTANT_SETTING),
            ["hr", "sales"]
        );
        assert_eq!(order_names(&policy, "welcome_banner"), ["sales"]);
        assert!(
            resolution_order_for(&policy, "unordered_setting")
                .next()
                .is_none()
        );
    }

    #[test]
    fn resolution_order_skips_unknown_ids() {
        // The parser rejects these, but the resolver must stay total anyway —
        // the `skips_unknown_priority_order_entries` precedent, on the id path.
        let policy = document_of(
            vec![("sales", identified("aud-sales", "sales-group-id"))],
            vec!["sales"],
            vec![(STARTING_ASSISTANT_SETTING, vec!["ghost", "aud-sales"])],
        );
        assert_eq!(order_names(&policy, STARTING_ASSISTANT_SETTING), ["sales"]);
    }

    #[test]
    fn resolution_order_resolves_a_shared_id_to_the_smaller_name() {
        // The parser rejects a shared id, but a struct-built document can
        // carry one, and the resolver must then pick the same audience for it
        // every time — the smaller name — never whichever entry the fresh
        // `audiences` map of each document happens to yield first.
        for _ in 0..50 {
            let policy = document_of(
                vec![
                    ("zulu", identified("x", "zulu-group-id")),
                    ("alpha", identified("x", "alpha-group-id")),
                ],
                vec![],
                vec![(STARTING_ASSISTANT_SETTING, vec!["x"])],
            );
            assert_eq!(order_names(&policy, STARTING_ASSISTANT_SETTING), ["alpha"]);
        }
    }

    /// A snapshot audience minted from the Sales/HR overlap, with the
    /// `provenance` value injectable so each provenance test states only the
    /// record it is about.
    fn snapshot_document(provenance: &str) -> String {
        format!(
            r#"{{
                "audiences": {{
                    "sales": {{
                        "id": "aud-sales",
                        "subjects": [{{"subject_type": "organization_group", "group_id": "sales-group-id"}}],
                        "pinned_assistant_hub_assistant_id": "6a3d2c76-2f6e-4e6f-8ad0-1f8f8f4f2a01"
                    }},
                    "hr": {{
                        "id": "aud-hr",
                        "subjects": [{{"subject_type": "organization_group", "group_id": "hr-group-id"}}],
                        "pinned_assistant_hub_assistant_id": "0b1c2d3e-4f50-4161-8273-8495a6b7c8d9"
                    }},
                    "overlap": {{
                        "id": "aud-snap",
                        "subjects": [{{"subject_type": "user", "organization_user_id": "oid-dana"}}],
                        "pinned_assistant_hub_assistant_id": "3c2b1a09-8d7e-4f6a-b5c4-d3e2f1a0b9c8",
                        "provenance": {provenance}
                    }}
                }},
                "priority_order": ["overlap", "sales", "hr"],
                "setting_orders": {{"starting_assistant": ["aud-snap", "aud-sales", "aud-hr"]}}
            }}"#
        )
    }

    #[test]
    fn parses_snapshot_provenance() {
        // S14a: a promote records the pair and both group id lists, so a
        // drift check can later re-ask the directory what the overlap looks
        // like now — without ever treating the answer as membership.
        let document = parse_experience_policy(&snapshot_document(
            r#"{
                "kind": "overlap_promotion",
                "source_a": {"audience_id": "aud-sales", "audience_name": "sales", "group_ids": ["sales-group-id"]},
                "source_b": {"audience_id": "aud-hr", "audience_name": "hr", "group_ids": ["hr-group-id", "hr-emea-group-id"]},
                "taken_at": "2026-09-04T12:00:00Z"
            }"#,
        ))
        .unwrap();

        let provenance = document.audiences["overlap"].provenance.as_ref().unwrap();
        assert_eq!(provenance.kind, "overlap_promotion");
        assert_eq!(provenance.source_a.audience_id, "aud-sales");
        assert_eq!(provenance.source_a.audience_name, "sales");
        assert_eq!(provenance.source_a.group_ids, vec!["sales-group-id"]);
        assert_eq!(provenance.source_b.audience_id, "aud-hr");
        assert_eq!(
            provenance.source_b.group_ids,
            vec!["hr-group-id", "hr-emea-group-id"]
        );
        assert_eq!(
            provenance.taken_at,
            "2026-09-04T12:00:00Z".parse::<DateTime<Utc>>().unwrap()
        );
        assert_eq!(document.audiences["sales"].provenance, None);
    }

    #[test]
    fn dangling_provenance_source_ids_parse() {
        // S14g, by decision rather than omission: provenance is a record of
        // origin, not a live dependency, and nothing joins on it — so a
        // cross-reference check would let deleting a source audience kill the
        // whole document, turning a harmless dangling record into a policy
        // outage.
        let document = parse_experience_policy(&snapshot_document(
            r#"{
                "kind": "overlap_promotion",
                "source_a": {"audience_id": "aud-deleted", "audience_name": "a name the map no longer holds", "group_ids": ["group-nobody-remembers"]},
                "source_b": {"audience_id": "aud-also-deleted", "audience_name": "gone too", "group_ids": []},
                "taken_at": "2026-09-04T12:00:00Z"
            }"#,
        ))
        .unwrap();
        assert!(document.audiences["overlap"].provenance.is_some());
    }

    #[test]
    fn unknown_provenance_kinds_parse() {
        // Uninterpreted String, not a closed enum: a newer panel minting a
        // new kind must not wedge this reader into keep-previous.
        let document = parse_experience_policy(&snapshot_document(
            r#"{
                "kind": "a_kind_this_reader_has_never_heard_of",
                "source_a": {"audience_id": "aud-sales", "audience_name": "sales", "group_ids": []},
                "source_b": {"audience_id": "aud-hr", "audience_name": "hr", "group_ids": []},
                "taken_at": "2026-09-04T12:00:00Z"
            }"#,
        ))
        .unwrap();
        assert_eq!(
            document.audiences["overlap"]
                .provenance
                .as_ref()
                .unwrap()
                .kind,
            "a_kind_this_reader_has_never_heard_of"
        );
    }

    #[test]
    fn rejects_a_malformed_provenance_taken_at() {
        // The `rejects_a_malformed_expires_at` stance: the panel BFF
        // validates every write with this parser, so only a hand-written row
        // can carry one, and it should fail the whole document loudly.
        for timestamp in ["next tuesday", "2026-09-08", "2026-09-08T00:00:00"] {
            assert!(
                parse_experience_policy(&snapshot_document(&format!(
                    r#"{{
                        "kind": "overlap_promotion",
                        "source_a": {{"audience_id": "aud-sales", "audience_name": "sales", "group_ids": []}},
                        "source_b": {{"audience_id": "aud-hr", "audience_name": "hr", "group_ids": []}},
                        "taken_at": "{timestamp}"
                    }}"#
                )))
                .is_err(),
                "expected {timestamp:?} to reject the document"
            );
        }

        // Absent entirely is also a reject: a snapshot without its "as of"
        // records nothing a drift check could ever compare against.
        assert!(
            parse_experience_policy(&snapshot_document(
                r#"{
                    "kind": "overlap_promotion",
                    "source_a": {"audience_id": "aud-sales", "audience_name": "sales", "group_ids": []},
                    "source_b": {"audience_id": "aud-hr", "audience_name": "hr", "group_ids": []}
                }"#,
            ))
            .is_err()
        );
    }

    /// The document as it would look had the snapshot never recorded its
    /// origin.
    fn without_provenance(document: &str) -> String {
        let mut stripped: serde_json::Value = serde_json::from_str(document).unwrap();
        let removed = stripped["audiences"]
            .as_object_mut()
            .unwrap()
            .values_mut()
            .filter_map(|audience| {
                audience
                    .as_object_mut()
                    .and_then(|audience| audience.remove("provenance"))
            })
            .count();
        assert!(removed > 0, "the twin fixture must carry provenance");
        stripped.to_string()
    }

    #[test]
    fn a_document_resolves_identically_to_its_provenance_stripped_twin() {
        // The S10c pattern aimed at the S14 trap: provenance is a record of
        // origin, never an input to matching — the subjects are the policy.
        // The sources here DANGLE on purpose, so a resolution path that
        // dereferenced provenance could not behave identically across the two
        // variants by luck.
        let with_provenance = snapshot_document(
            r#"{
                "kind": "overlap_promotion",
                "source_a": {"audience_id": "aud-deleted", "audience_name": "deleted", "group_ids": ["group-deleted"]},
                "source_b": {"audience_id": "aud-hr", "audience_name": "hr", "group_ids": ["hr-group-id"]},
                "taken_at": "2026-09-04T12:00:00Z"
            }"#,
        );
        let parsed = parse_experience_policy(&with_provenance).unwrap();
        // Guard against a vacuous pass: a misspelled key would deserialize to
        // None and make every comparison below trivially true.
        assert!(parsed.audiences["overlap"].provenance.is_some());
        let stripped = parse_experience_policy(&without_provenance(&with_provenance)).unwrap();

        let resolved = |policy: &ExperiencePolicyDocument| {
            resolution_order_for(policy, STARTING_ASSISTANT_SETTING)
                .map(|(name, audience)| {
                    (
                        name.to_string(),
                        audience.pinned_assistant_hub_assistant_id,
                        audience.expires_at,
                        audience.subjects.clone(),
                    )
                })
                .collect::<Vec<_>>()
        };
        assert_eq!(resolved(&parsed), resolved(&stripped));

        // The twins differ in nothing else: clearing provenance from the full
        // parse yields exactly the stripped parse, so the resolution
        // comparison above spans the whole document rather than a lucky
        // corner of it.
        let mut cleared = parsed.clone();
        for audience in cleared.audiences.values_mut() {
            audience.provenance = None;
        }
        assert_eq!(cleared, stripped);
    }

    #[test]
    fn resolution_order_expresses_divergent_orders_per_setting() {
        // S10e: "Sales above HR for setting X, below for setting Y" is
        // representable today even though nothing exercises it yet — the
        // property the whole migration exists to buy.
        let policy = document_of(
            vec![
                ("sales", identified("aud-sales", "sales-group-id")),
                ("hr", identified("aud-hr", "hr-group-id")),
            ],
            vec!["sales", "hr"],
            vec![
                (STARTING_ASSISTANT_SETTING, vec!["aud-sales", "aud-hr"]),
                ("welcome_banner", vec!["aud-hr", "aud-sales"]),
            ],
        );
        assert_eq!(
            order_names(&policy, STARTING_ASSISTANT_SETTING),
            ["sales", "hr"]
        );
        assert_eq!(order_names(&policy, "welcome_banner"), ["hr", "sales"]);
    }
}
