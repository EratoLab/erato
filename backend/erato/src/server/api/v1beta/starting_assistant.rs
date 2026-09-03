//! Per-user resolution of the admin-pinned "starting assistant". An admin pins
//! an assistant-hub assistant for an audience — a list of subjects: directory
//! groups, named individuals, or the whole organization — in the org-wide
//! experience policy document ([`crate::distribution::experience_policy`]); a
//! user any of those subjects matches lands there instead of on the welcome
//! screen.
//!
//! This lives on the authenticated `/me` tree rather than the public bundle
//! route because the document is org-wide but its resolution depends on who
//! the caller is and which groups they are in.
//!
//! The response is always `200 OK`: every failure mode — no policy, no matching
//! audience, a stale or revoked pin, an infrastructure error — degrades to an
//! absent `starting_assistant` field, so a pin can never turn into an error
//! page for the very users it targets.
//!
//! The user's own tri-state override layers on top of the audience pin, and the
//! endpoint returns one decided answer: cleared > own pick > audience pin >
//! welcome screen. Unlike `default_chat_provider`, which composes preference
//! and config client-side in `useActiveModelSelection`, this precedence is
//! resolved here — the audience-pin leg needs the policy document and
//! authoritative group membership, neither of which the client can evaluate.

use crate::distribution::experience_policy::{
    AudienceSubject, ExperienceAudience, ExperiencePolicyDocument, STARTING_ASSISTANT_SETTING,
    resolution_order_for,
};
use crate::models::share_grant::ShareSubject;
use crate::models::{assistant_hub, share_grant};
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::state::AppState;
use axum::extract::State;
use axum::http::StatusCode;
use axum::{Extension, Json};
use chrono::{DateTime, Utc};
use serde::Serialize;
use utoipa::ToSchema;

/// Where a resolved starting assistant came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum StartingAssistantSource {
    /// The user's own start-screen pick (their preference override).
    UserPick,
    /// An admin's audience pin from the experience policy document.
    AudiencePin,
}

/// The resolved starting assistant for the calling user.
#[derive(Debug, Serialize, ToSchema)]
pub struct StartingAssistantInfo {
    /// The live `assistants.id` of the current published version. Resolved at
    /// read time from the pinned hub id, so it is always the id a client can
    /// open a chat with — even right after a republish minted a fresh clone.
    pub assistant_id: String,
    /// The stable `assistant_hub_assistants.id` the pick or pin stores.
    pub assistant_hub_assistant_id: String,
    /// Whether the user's own pick or an admin's audience pin won.
    pub source: StartingAssistantSource,
    /// The name of the audience (policy key) whose pin won for this user.
    /// Present only when `source` is `audience_pin`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub audience: Option<String>,
}

/// Response for `GET /me/starting-assistant`.
#[derive(Debug, Serialize, ToSchema)]
pub struct StartingAssistantResponse {
    /// Absent when no pin applies to the calling user; the client shows the
    /// ordinary welcome screen.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub starting_assistant: Option<StartingAssistantInfo>,
}

/// Who an audience's subjects are matched against.
///
/// Built from the caller's token, not from the database: an audience is
/// evaluated against the identity the request arrived with.
#[derive(Debug, Clone, Copy)]
pub struct AudienceIdentity<'a> {
    /// The token's `groups` claim, i.e. `MeProfile.groups` (rego
    /// `input.groups`) — not `Subject::organization_group_ids`, which is empty
    /// for the plain `Subject::User` variant and would silently match nothing.
    pub groups: &'a [String],
    /// The caller's directory user id from the `oid` claim. `None` for identity
    /// providers that emit none, in which case `user` subjects simply never
    /// match — the same way `groups` subjects never match without a `groups`
    /// claim.
    pub organization_user_id: Option<&'a str>,
}

impl<'a> AudienceIdentity<'a> {
    #[must_use]
    pub fn from_profile(profile: &'a MeProfile) -> Self {
        Self {
            groups: &profile.groups,
            organization_user_id: profile.organization_user_id.as_deref(),
        }
    }
}

/// Whether one audience subject matches the caller.
#[must_use]
pub fn subject_matches(subject: &AudienceSubject, identity: AudienceIdentity<'_>) -> bool {
    match subject {
        // Everyone who got this far is authenticated.
        AudienceSubject::Organization => true,
        AudienceSubject::OrganizationGroup { group_id } => {
            identity.groups.iter().any(|group| group == group_id)
        }
        AudienceSubject::User {
            organization_user_id,
        } => identity.organization_user_id == Some(organization_user_id.as_str()),
    }
}

/// The subjects of `audience` that match the caller — usually one, but a person
/// can be in two of an audience's groups at once, and each match is a separate
/// reason the pin might still be granted.
///
/// Deliberately does not check expiry: it is only ever called on the winner
/// [`match_winning_audience`] already found active. A new caller must gate on
/// that function, not this one.
#[must_use]
pub fn matching_subjects<'a>(
    audience: &'a ExperienceAudience,
    identity: AudienceIdentity<'_>,
) -> Vec<&'a AudienceSubject> {
    audience
        .subjects
        .iter()
        .filter(|subject| subject_matches(subject, identity))
        .collect()
}

/// Pick the winning audience for a user: the first audience in the
/// starting-assistant resolution order that is still active at `now` and any
/// of whose subjects matches the caller.
///
/// Iteration order is delegated to [`resolution_order_for`], the one home for
/// the `setting_orders`-versus-`priority_order` precedence; the `audiences`
/// map's iteration order is arbitrary and must never decide the winner. An
/// audience whose subjects include the whole organization therefore shadows
/// everything below it and defaults everything above it, depending only on
/// where the admin put it in the order.
///
/// An expired audience is skipped exactly as if no subject matched, so the
/// next entry wins — a time-boxed announcement on top hands back to the
/// audiences it shadowed, rather than degrading everyone to the welcome
/// screen.
pub fn match_winning_audience<'a>(
    policy: &'a ExperiencePolicyDocument,
    identity: AudienceIdentity<'_>,
    now: DateTime<Utc>,
) -> Option<(&'a str, &'a ExperienceAudience)> {
    resolution_order_for(policy, STARTING_ASSISTANT_SETTING)
        .into_iter()
        .find(|(_, audience)| {
            audience.is_active_at(now)
                && audience
                    .subjects
                    .iter()
                    .any(|subject| subject_matches(subject, identity))
        })
}

#[utoipa::path(
    get,
    path = "/me/starting-assistant",
    responses(
        (status = OK, body = StartingAssistantResponse),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn starting_assistant(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
) -> Result<Json<StartingAssistantResponse>, StatusCode> {
    let no_pin = || {
        Ok(Json(StartingAssistantResponse {
            starting_assistant: None,
        }))
    };

    // An explicit clear must stick: it suppresses the audience pin outright,
    // which is why "cleared" is persisted distinctly from "never set".
    if me_user.preference_starting_assistant_cleared {
        return no_pin();
    }

    if !app_state.config.assistant_hub.enabled {
        return no_pin();
    }

    // The own pick is resolved before the policy document is consulted at all,
    // so it keeps working in a deployment with no policy loaded.
    if let Some(raw_pick) = me_user.preference_starting_hub_assistant_id.as_deref() {
        match raw_pick.parse::<sqlx::types::Uuid>() {
            Ok(pick) => {
                return Ok(Json(resolve_user_pick(&app_state, &me_user, pick).await));
            }
            Err(error) => {
                // The value comes from a uuid column, so this is corruption,
                // not user input.
                tracing::warn!(
                    user_id = %me_user.id,
                    raw_pick,
                    error = %error,
                    "Stored starting-assistant pick is not a uuid; serving welcome screen"
                );
                return no_pin();
            }
        }
    }

    // No override either way: fall back to the admin's audience pin. Clone out
    // of the read guard so a slow DB await below never holds the reload lock.
    let policy = { app_state.reloadable.read().await.experience_policy.clone() };
    let Some(policy) = policy else {
        return no_pin();
    };

    // Exactly one winner: if its pin fails to resolve below we degrade to the
    // welcome screen rather than falling through to the next matching audience.
    // The clock is read once so every audience in the order is judged against
    // the same instant.
    let identity = AudienceIdentity::from_profile(&me_user);
    let now = Utc::now();
    let Some((audience_name, audience)) = match_winning_audience(&policy, identity, now) else {
        return no_pin();
    };

    // Resolves the stable hub id to the current published clone's
    // `assistants.id`, and enforces that the caller can access it.
    let record = match assistant_hub::get_published_current_version(
        &app_state.db,
        &app_state.config.assistant_hub,
        &me_user.to_subject(),
        audience.pinned_assistant_hub_assistant_id,
    )
    .await
    {
        Ok(record) => record,
        Err(report) => {
            tracing::warn!(
                hub_assistant_id = %audience.pinned_assistant_hub_assistant_id,
                audience = %audience_name,
                error = ?report,
                "Pinned starting assistant did not resolve; serving welcome screen"
            );
            return no_pin();
        }
    };

    // Check the access of the SUBJECTS the caller matched on, not the caller's
    // own: revoking the audience grant must stop the pin even for users who
    // keep personal access through an unrelated direct grant. Any one matched
    // subject being granted is enough — a person in two of the audience's
    // groups is reached if either group can see the assistant.
    //
    // This is the last possible moment: the audience vocabulary is translated
    // into share-grant subjects only here, at the edge where grants are read.
    // A `user` subject is checked under both id types share grants recognise,
    // because a grant to that person is a grant to that person however the
    // sharer addressed them.
    //
    // NOTE (see PR #1072 review): the predicate below is grant interpretation
    // in Rust that arguably belongs in the PolicyEngine; see
    // `share_grant::is_resource_shared_with_any_subject` for why it cannot
    // move there yet and what it would take.
    let mut share_subjects: Vec<ShareSubject<'_>> = Vec::new();
    for subject in matching_subjects(audience, identity) {
        match subject {
            AudienceSubject::Organization => share_subjects.push(ShareSubject::organization()),
            AudienceSubject::OrganizationGroup { group_id } => {
                share_subjects.push(ShareSubject::organization_group(group_id));
            }
            AudienceSubject::User {
                organization_user_id,
            } => {
                share_subjects.push(ShareSubject::organization_user(organization_user_id));
                share_subjects.push(ShareSubject::user(&me_user.id));
            }
        }
    }

    let assistant_id = record.assistant.id.to_string();
    match share_grant::is_resource_shared_with_any_subject(
        &app_state.db,
        "assistant",
        &assistant_id,
        &share_subjects,
    )
    .await
    {
        Ok(true) => {}
        Ok(false) => {
            tracing::debug!(
                hub_assistant_id = %audience.pinned_assistant_hub_assistant_id,
                audience = %audience_name,
                "Pinned starting assistant is no longer shared with its audience; serving welcome screen"
            );
            return no_pin();
        }
        Err(report) => {
            tracing::error!(
                hub_assistant_id = %audience.pinned_assistant_hub_assistant_id,
                audience = %audience_name,
                error = ?report,
                "Failed to check audience share for pinned starting assistant; serving welcome screen"
            );
            return no_pin();
        }
    }

    Ok(Json(StartingAssistantResponse {
        starting_assistant: Some(StartingAssistantInfo {
            assistant_id,
            assistant_hub_assistant_id: audience.pinned_assistant_hub_assistant_id.to_string(),
            source: StartingAssistantSource::AudiencePin,
            audience: Some(audience_name.to_string()),
        }),
    }))
}

/// Resolve the user's own start-screen pick to the current published clone's
/// live `assistants.id`.
///
/// A pick that no longer resolves (withdrawn, unpublished, access lost)
/// degrades to the welcome screen rather than falling through to an audience
/// pin: a user who overrode their start screen should not be silently
/// re-steered by policy when their choice disappears.
async fn resolve_user_pick(
    app_state: &AppState,
    me_user: &MeProfile,
    pick: sqlx::types::Uuid,
) -> StartingAssistantResponse {
    match assistant_hub::get_published_current_version(
        &app_state.db,
        &app_state.config.assistant_hub,
        &me_user.to_subject(),
        pick,
    )
    .await
    {
        Ok(record) => StartingAssistantResponse {
            starting_assistant: Some(StartingAssistantInfo {
                assistant_id: record.assistant.id.to_string(),
                assistant_hub_assistant_id: pick.to_string(),
                source: StartingAssistantSource::UserPick,
                audience: None,
            }),
        },
        Err(report) => {
            tracing::warn!(
                user_id = %me_user.id,
                hub_assistant_id = %pick,
                error = ?report,
                "User's own starting-assistant pick did not resolve; serving welcome screen"
            );
            StartingAssistantResponse {
                starting_assistant: None,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::distribution::experience_policy::parse_experience_policy;
    use sqlx::types::Uuid;
    use std::collections::HashMap;

    fn group(group_id: &str) -> AudienceSubject {
        AudienceSubject::OrganizationGroup {
            group_id: group_id.to_string(),
        }
    }

    fn person(organization_user_id: &str) -> AudienceSubject {
        AudienceSubject::User {
            organization_user_id: organization_user_id.to_string(),
        }
    }

    fn audience_of(subjects: Vec<AudienceSubject>) -> ExperienceAudience {
        ExperienceAudience {
            id: None,
            subjects,
            pinned_assistant_hub_assistant_id: Uuid::new_v4(),
            expires_at: None,
        }
    }

    fn expiring(mut audience: ExperienceAudience, expires_at: &str) -> ExperienceAudience {
        audience.expires_at = Some(at(expires_at));
        audience
    }

    fn at(timestamp: &str) -> DateTime<Utc> {
        timestamp.parse().unwrap()
    }

    /// The common single-group audience, still the shape most audiences take.
    fn audience(group_id: &str) -> ExperienceAudience {
        audience_of(vec![group(group_id)])
    }

    fn member_of(groups: &[&str]) -> Vec<String> {
        groups.iter().map(|group| (*group).to_string()).collect()
    }

    /// A caller in `groups` whose identity provider issued no `oid`.
    fn identity_of(groups: &[String]) -> AudienceIdentity<'_> {
        AudienceIdentity {
            groups,
            organization_user_id: None,
        }
    }

    fn policy_with(
        entries: Vec<(&str, ExperienceAudience)>,
        priority_order: Vec<&str>,
    ) -> ExperiencePolicyDocument {
        let mut audiences = HashMap::new();
        for (name, audience) in entries {
            audiences.insert(name.to_string(), audience);
        }
        ExperiencePolicyDocument {
            audiences,
            priority_order: priority_order
                .into_iter()
                .map(|name| name.to_string())
                .collect(),
            setting_orders: HashMap::new(),
        }
    }

    #[test]
    fn first_priority_order_entry_wins_regardless_of_map_insert_order() {
        let user_groups = member_of(&["group-a", "group-b"]);
        let identity = identity_of(&user_groups);

        // Insert the audiences in both orders: the winner must come from
        // priority_order, never from HashMap iteration/insertion order.
        for entries in [
            vec![
                ("alpha", audience("group-a")),
                ("beta", audience("group-b")),
            ],
            vec![
                ("beta", audience("group-b")),
                ("alpha", audience("group-a")),
            ],
        ] {
            let policy = policy_with(entries.clone(), vec!["beta", "alpha"]);
            let (winner, matched) = match_winning_audience(&policy, identity, Utc::now()).unwrap();
            assert_eq!(winner, "beta");
            assert_eq!(matched.subjects, vec![group("group-b")]);

            // Reversing priority_order must flip the winner: the ordered key
            // is load-bearing.
            let policy = policy_with(entries, vec!["alpha", "beta"]);
            let (winner, matched) = match_winning_audience(&policy, identity, Utc::now()).unwrap();
            assert_eq!(winner, "alpha");
            assert_eq!(matched.subjects, vec![group("group-a")]);
        }
    }

    #[test]
    fn skips_priority_order_entries_the_user_is_not_a_member_of() {
        let policy = policy_with(
            vec![
                ("alpha", audience("group-a")),
                ("beta", audience("group-b")),
            ],
            vec!["alpha", "beta"],
        );
        let user_groups = member_of(&["group-b"]);
        let (winner, _) =
            match_winning_audience(&policy, identity_of(&user_groups), Utc::now()).unwrap();
        assert_eq!(winner, "beta");
    }

    #[test]
    fn skips_unknown_priority_order_entries() {
        // The parser rejects these, but the resolver must stay total anyway.
        let policy = policy_with(vec![("beta", audience("group-b"))], vec!["ghost", "beta"]);
        let user_groups = member_of(&["group-b"]);
        let (winner, _) =
            match_winning_audience(&policy, identity_of(&user_groups), Utc::now()).unwrap();
        assert_eq!(winner, "beta");
    }

    #[test]
    fn audience_absent_from_priority_order_never_wins() {
        let policy = policy_with(vec![("alpha", audience("group-a"))], vec![]);
        let user_groups = member_of(&["group-a"]);
        assert!(match_winning_audience(&policy, identity_of(&user_groups), Utc::now()).is_none());
    }

    #[test]
    fn no_winner_for_empty_groups_or_empty_policy() {
        let policy = policy_with(vec![("alpha", audience("group-a"))], vec!["alpha"]);
        assert!(match_winning_audience(&policy, identity_of(&[]), Utc::now()).is_none());

        let empty = ExperiencePolicyDocument::default();
        let user_groups = member_of(&["group-a"]);
        assert!(match_winning_audience(&empty, identity_of(&user_groups), Utc::now()).is_none());
    }

    #[test]
    fn any_subject_of_a_multi_subject_audience_is_enough() {
        // One audience spanning two groups and one named person: each of the
        // three ways in reaches it on its own, and nobody else gets in.
        let policy = policy_with(
            vec![(
                "rollout",
                audience_of(vec![
                    group("group-a"),
                    group("group-b"),
                    person("oid-carol"),
                ]),
            )],
            vec!["rollout"],
        );

        for groups in [member_of(&["group-a"]), member_of(&["group-b"])] {
            let (winner, _) =
                match_winning_audience(&policy, identity_of(&groups), Utc::now()).unwrap();
            assert_eq!(winner, "rollout");
        }

        let carol = AudienceIdentity {
            groups: &[],
            organization_user_id: Some("oid-carol"),
        };
        let (winner, _) = match_winning_audience(&policy, carol, Utc::now()).unwrap();
        assert_eq!(winner, "rollout");

        let stranger = AudienceIdentity {
            groups: &member_of(&["group-z"]),
            organization_user_id: Some("oid-dave"),
        };
        assert!(match_winning_audience(&policy, stranger, Utc::now()).is_none());
    }

    #[test]
    fn a_user_subject_matches_only_that_user() {
        let policy = policy_with(
            vec![("named", audience_of(vec![person("oid-alice")]))],
            vec!["named"],
        );

        let alice = AudienceIdentity {
            groups: &[],
            organization_user_id: Some("oid-alice"),
        };
        assert_eq!(
            match_winning_audience(&policy, alice, Utc::now()).map(|(name, _)| name),
            Some("named")
        );

        let bob = AudienceIdentity {
            groups: &[],
            organization_user_id: Some("oid-bob"),
        };
        assert!(match_winning_audience(&policy, bob, Utc::now()).is_none());

        // An identity provider that issues no `oid` cannot match a user
        // subject — the id it would be compared against was never asserted.
        let groups = member_of(&["oid-alice"]);
        assert!(match_winning_audience(&policy, identity_of(&groups), Utc::now()).is_none());
    }

    #[test]
    fn an_organization_audience_matches_a_user_with_no_groups() {
        let policy = policy_with(
            vec![("everyone", audience_of(vec![AudienceSubject::Organization]))],
            vec!["everyone"],
        );

        let (winner, _) = match_winning_audience(&policy, identity_of(&[]), Utc::now()).unwrap();
        assert_eq!(winner, "everyone");
    }

    #[test]
    fn an_organization_audience_shadows_or_defaults_by_its_place_in_the_order() {
        let entries = vec![
            ("everyone", audience_of(vec![AudienceSubject::Organization])),
            ("engineering", audience("group-a")),
        ];
        let engineer = member_of(&["group-a"]);

        // Listed last it is a catch-all: the specific audience still wins for
        // the people it names, and everyone else falls through to it.
        let policy = policy_with(entries.clone(), vec!["engineering", "everyone"]);
        assert_eq!(
            match_winning_audience(&policy, identity_of(&engineer), Utc::now())
                .map(|(name, _)| name),
            Some("engineering")
        );
        assert_eq!(
            match_winning_audience(&policy, identity_of(&[]), Utc::now()).map(|(name, _)| name),
            Some("everyone")
        );

        // Listed first it shadows everything below it — an org-wide rollout,
        // deliberately, and visibly, from one ordered key.
        let policy = policy_with(entries, vec!["everyone", "engineering"]);
        assert_eq!(
            match_winning_audience(&policy, identity_of(&engineer), Utc::now())
                .map(|(name, _)| name),
            Some("everyone")
        );
    }

    #[test]
    fn matching_subjects_returns_every_reason_the_user_is_in_the_audience() {
        // The eligibility check downstream needs all of them: a person in two
        // of the audience's groups keeps the pin if either group is granted.
        let audience = audience_of(vec![
            group("group-a"),
            group("group-b"),
            group("group-c"),
            person("oid-alice"),
        ]);
        let groups = member_of(&["group-a", "group-c"]);
        let identity = AudienceIdentity {
            groups: &groups,
            organization_user_id: Some("oid-alice"),
        };

        assert_eq!(
            matching_subjects(&audience, identity),
            vec![&group("group-a"), &group("group-c"), &person("oid-alice")]
        );

        assert!(matching_subjects(&audience, identity_of(&[])).is_empty());
    }

    #[test]
    fn an_expired_audience_falls_through_to_the_next_priority_entry() {
        // Fall-through, not degrade-to-welcome: the expired entry is skipped
        // exactly as if no subject matched.
        let policy = policy_with(
            vec![
                (
                    "announcement",
                    expiring(
                        audience_of(vec![AudienceSubject::Organization]),
                        "2026-09-01T00:00:00Z",
                    ),
                ),
                ("engineering", audience("group-a")),
            ],
            vec!["announcement", "engineering"],
        );
        let engineer = member_of(&["group-a"]);
        let (winner, _) =
            match_winning_audience(&policy, identity_of(&engineer), at("2026-09-02T00:00:00Z"))
                .unwrap();
        assert_eq!(winner, "engineering");
    }

    #[test]
    fn expiry_boundary_is_active_iff_now_strictly_before_expires_at() {
        let expires_at = at("2026-09-08T00:00:00Z");
        let policy = policy_with(
            vec![(
                "announcement",
                expiring(
                    audience_of(vec![AudienceSubject::Organization]),
                    "2026-09-08T00:00:00Z",
                ),
            )],
            vec!["announcement"],
        );
        let identity = identity_of(&[]);

        let one_second_earlier = expires_at - chrono::Duration::seconds(1);
        assert!(match_winning_audience(&policy, identity, one_second_earlier).is_some());
        // At the instant itself the audience is already inert.
        assert!(match_winning_audience(&policy, identity, expires_at).is_none());
    }

    #[test]
    fn absent_expires_at_never_expires() {
        let policy = policy_with(vec![("alpha", audience("group-a"))], vec!["alpha"]);
        let groups = member_of(&["group-a"]);
        let (winner, _) =
            match_winning_audience(&policy, identity_of(&groups), at("9999-12-31T23:59:59Z"))
                .unwrap();
        assert_eq!(winner, "alpha");
    }

    #[test]
    fn all_audiences_expired_yields_no_winner() {
        let policy = policy_with(
            vec![
                (
                    "announcement",
                    expiring(
                        audience_of(vec![AudienceSubject::Organization]),
                        "2026-09-01T00:00:00Z",
                    ),
                ),
                (
                    "engineering",
                    expiring(audience("group-a"), "2026-09-02T00:00:00Z"),
                ),
            ],
            vec!["announcement", "engineering"],
        );
        let engineer = member_of(&["group-a"]);
        assert!(
            match_winning_audience(&policy, identity_of(&engineer), at("2026-09-03T00:00:00Z"))
                .is_none()
        );
    }

    #[test]
    fn the_announcement_scenario_before_and_after_expiry() {
        // ERMAIN-706 §4: [Everyone (A-announce, expires Sep 8), Sales
        // (A-pipeline), HR (A-onboarding)]. Sam is in Sales, Dana in both,
        // Hana in HR only, Otto in neither group.
        let a_announce = Uuid::from_u128(1);
        let a_pipeline = Uuid::from_u128(2);
        let a_onboarding = Uuid::from_u128(3);
        let pinned = |pin, subjects| ExperienceAudience {
            id: None,
            subjects,
            pinned_assistant_hub_assistant_id: pin,
            expires_at: None,
        };
        let policy = policy_with(
            vec![
                (
                    "everyone",
                    expiring(
                        pinned(a_announce, vec![AudienceSubject::Organization]),
                        "2026-09-08T00:00:00Z",
                    ),
                ),
                ("sales", pinned(a_pipeline, vec![group("sales-group-id")])),
                ("hr", pinned(a_onboarding, vec![group("hr-group-id")])),
            ],
            vec!["everyone", "sales", "hr"],
        );

        let sam_groups = member_of(&["sales-group-id"]);
        let dana_groups = member_of(&["sales-group-id", "hr-group-id"]);
        let hana_groups = member_of(&["hr-group-id"]);
        let sam = identity_of(&sam_groups);
        let dana = identity_of(&dana_groups);
        let hana = identity_of(&hana_groups);
        let otto = identity_of(&[]);

        // Before expiry the announcement shadows everything for everybody.
        let before = at("2026-09-07T23:59:59Z");
        for identity in [sam, dana, hana, otto] {
            let (winner, audience) = match_winning_audience(&policy, identity, before).unwrap();
            assert_eq!(winner, "everyone");
            assert_eq!(audience.pinned_assistant_hub_assistant_id, a_announce);
        }

        // From the expiry instant on, the shadowed audiences take over. Dana
        // lands on sales, not hr: priority_order still decides below the
        // expired entry, while Hana falls through to hr. Otto matched only the
        // announcement, so with it inert nothing matches him.
        for now in [at("2026-09-08T00:00:00Z"), at("2026-09-09T00:00:00Z")] {
            for (identity, expected_winner, expected_pin) in [
                (sam, "sales", a_pipeline),
                (dana, "sales", a_pipeline),
                (hana, "hr", a_onboarding),
            ] {
                let (winner, audience) = match_winning_audience(&policy, identity, now).unwrap();
                assert_eq!(winner, expected_winner);
                assert_eq!(audience.pinned_assistant_hub_assistant_id, expected_pin);
            }
            assert!(match_winning_audience(&policy, otto, now).is_none());
        }
    }

    #[test]
    fn a_dual_document_resolves_like_its_setting_orders_stripped_twin() {
        // S10c without running the old binary: stripping `setting_orders`
        // reduces the document to exactly what a pre-setting_orders reader
        // resolves from (`accepts_unknown_fields_from_newer_writers` proves
        // that reader parses the dual document at all), so equal winners here
        // mean a mixed-version deployment cannot change anyone's start screen.
        let dual = r#"{
            "audiences": {
                "everyone": {
                    "id": "aud-everyone",
                    "subjects": [{"subject_type": "organization"}],
                    "pinned_assistant_hub_assistant_id": "11111111-1111-4111-8111-111111111111",
                    "expires_at": "2026-09-08T00:00:00Z"
                },
                "sales": {
                    "id": "aud-sales",
                    "subjects": [{"subject_type": "organization_group", "group_id": "sales-group-id"}],
                    "pinned_assistant_hub_assistant_id": "22222222-2222-4222-8222-222222222222"
                },
                "hr": {
                    "id": "aud-hr",
                    "subjects": [{"subject_type": "organization_group", "group_id": "hr-group-id"}],
                    "pinned_assistant_hub_assistant_id": "33333333-3333-4333-8333-333333333333"
                }
            },
            "priority_order": ["everyone", "sales", "hr"],
            "setting_orders": {"starting_assistant": ["aud-everyone", "aud-sales", "aud-hr"]}
        }"#;
        let mut stripped: serde_json::Value = serde_json::from_str(dual).unwrap();
        stripped
            .as_object_mut()
            .and_then(|document| document.remove("setting_orders"))
            .unwrap();

        let dual = parse_experience_policy(dual).unwrap();
        let stripped = parse_experience_policy(&stripped.to_string()).unwrap();

        let sam_groups = member_of(&["sales-group-id"]);
        let dana_groups = member_of(&["sales-group-id", "hr-group-id"]);
        let hana_groups = member_of(&["hr-group-id"]);
        let cast = [
            ("sam", identity_of(&sam_groups)),
            ("dana", identity_of(&dana_groups)),
            ("hana", identity_of(&hana_groups)),
            ("otto", identity_of(&[])),
        ];
        // Both sides of the expiry boundary, so the comparison crosses a
        // change of winner rather than holding one constant answer equal.
        for now in [
            at("2026-09-07T23:59:59Z"),
            at("2026-09-08T00:00:00Z"),
            at("2026-09-09T00:00:00Z"),
        ] {
            for (person, identity) in cast {
                assert_eq!(
                    match_winning_audience(&dual, identity, now).map(|(name, _)| name),
                    match_winning_audience(&stripped, identity, now).map(|(name, _)| name),
                    "{person} at {now}"
                );
            }
        }
    }

    #[derive(serde::Deserialize)]
    struct ContractFixture {
        identities: HashMap<String, ContractIdentity>,
        cases: Vec<ContractCase>,
    }

    #[derive(serde::Deserialize)]
    struct ContractIdentity {
        groups: Vec<String>,
        organization_user_id: Option<String>,
    }

    #[derive(serde::Deserialize)]
    struct ContractCase {
        name: String,
        kind: String,
        document: serde_json::Value,
        checks: Vec<ContractCheck>,
    }

    #[derive(serde::Deserialize)]
    struct ContractCheck {
        identity: String,
        now: String,
        winner: Option<String>,
    }

    #[test]
    fn the_shared_resolution_contract_fixture_holds_in_rust() {
        // One fixture, two resolvers: the admin panel runs the same file
        // against its resolver mirror, so a divergence between erato and the
        // panel preview shows up as a failing row on one side or the other
        // instead of as an admin being lied to.
        let fixture: ContractFixture = serde_json::from_str(include_str!(
            "../../../distribution/experience_policy_resolution_contract.json"
        ))
        .unwrap();

        for case in &fixture.cases {
            let mut documents = vec![("verbatim", case.document.to_string())];
            if case.kind == "dual" {
                let mut stripped = case.document.clone();
                stripped
                    .as_object_mut()
                    .and_then(|document| document.remove("setting_orders"))
                    .expect("a dual case must carry setting_orders");
                documents.push(("stripped", stripped.to_string()));
            }
            for (variant, contents) in &documents {
                let policy = parse_experience_policy(contents).unwrap();
                for check in &case.checks {
                    let spec = &fixture.identities[&check.identity];
                    let identity = AudienceIdentity {
                        groups: &spec.groups,
                        organization_user_id: spec.organization_user_id.as_deref(),
                    };
                    assert_eq!(
                        match_winning_audience(&policy, identity, at(&check.now))
                            .map(|(name, _)| name),
                        check.winner.as_deref(),
                        "{} / {variant} / {} at {}",
                        case.name,
                        check.identity,
                        check.now
                    );
                }
            }
        }
    }
}
