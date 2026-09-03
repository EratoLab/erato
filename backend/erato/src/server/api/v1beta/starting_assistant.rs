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
//!
//! An own pick is one of two kinds. A hub assistant is picked by its stable
//! `assistant_hub_assistants.id` and resolved through the hub, because the
//! clone's `assistants.id` is minted fresh on every republish. An assistant
//! that was never published to the hub — the private one a person tuned for
//! themselves — has no hub row, so it is picked by `assistants.id` directly and
//! resolved through the ordinary assistant read path, which does not require
//! the hub to be enabled at all.

use crate::distribution::experience_policy::{
    AudienceSubject, ExperienceAudience, ExperiencePolicyDocument,
};
use crate::models::share_grant::ShareSubject;
use crate::models::{assistant, assistant_hub, share_grant};
use crate::policy::engine::PolicyEngine;
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::state::AppState;
use axum::extract::State;
use axum::http::StatusCode;
use axum::{Extension, Json};
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
    /// The live `assistants.id` a client can open a chat with. For a hub
    /// assistant it is resolved at read time from the stable hub id, so it is
    /// right even after a republish minted a fresh clone.
    pub assistant_id: String,
    /// The stable `assistant_hub_assistants.id` the pick or pin stores. Absent
    /// when the user picked an assistant that was never published to the hub,
    /// which has no hub row.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub assistant_hub_assistant_id: Option<String>,
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

/// Pick the winning audience for a user: the first entry of `priority_order`
/// naming an audience any of whose subjects matches the caller.
///
/// Precedence comes from `priority_order` alone, as `determine_chat_provider`
/// does for `chat_providers.priority_order`; the `audiences` map's iteration
/// order is arbitrary and must never decide the winner. An audience whose
/// subjects include the whole organization therefore shadows everything below
/// it and defaults everything above it, depending only on where the admin put
/// it in the order.
pub fn match_winning_audience<'a>(
    policy: &'a ExperiencePolicyDocument,
    identity: AudienceIdentity<'_>,
) -> Option<(&'a str, &'a ExperienceAudience)> {
    policy.priority_order.iter().find_map(|audience_name| {
        policy
            .audiences
            .get_key_value(audience_name)
            .filter(|(_, audience)| {
                audience
                    .subjects
                    .iter()
                    .any(|subject| subject_matches(subject, identity))
            })
            .map(|(name, audience)| (name.as_str(), audience))
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
    Extension(policy): Extension<PolicyEngine>,
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

    // Both own-pick legs are resolved before the policy document is consulted
    // at all, so a pick keeps working in a deployment with no policy loaded.
    //
    // The plain-assistant leg comes first and is deliberately NOT behind the
    // hub gate: an assistant the user made for themselves has nothing to do
    // with the hub, and turning the hub off must not silently re-steer them.
    if let Some(raw_pick) = me_user.preference_starting_assistant_id.as_deref() {
        return match parse_stored_pick(&me_user, raw_pick) {
            Some(pick) => Ok(Json(
                resolve_assistant_pick(&app_state, &policy, &me_user, pick).await,
            )),
            None => no_pin(),
        };
    }

    if !app_state.config.assistant_hub.enabled {
        return no_pin();
    }

    if let Some(raw_pick) = me_user.preference_starting_hub_assistant_id.as_deref() {
        return match parse_stored_pick(&me_user, raw_pick) {
            Some(pick) => Ok(Json(resolve_hub_pick(&app_state, &me_user, pick).await)),
            None => no_pin(),
        };
    }

    // No override either way: fall back to the admin's audience pin. Clone out
    // of the read guard so a slow DB await below never holds the reload lock.
    let experience_policy = { app_state.reloadable.read().await.experience_policy.clone() };
    let Some(experience_policy) = experience_policy else {
        return no_pin();
    };

    // Exactly one winner: if its pin fails to resolve below we degrade to the
    // welcome screen rather than falling through to the next matching audience.
    let identity = AudienceIdentity::from_profile(&me_user);
    let Some((audience_name, audience)) = match_winning_audience(&experience_policy, identity)
    else {
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
            assistant_hub_assistant_id: Some(
                audience.pinned_assistant_hub_assistant_id.to_string(),
            ),
            source: StartingAssistantSource::AudiencePin,
            audience: Some(audience_name.to_string()),
        }),
    }))
}

/// Parse an id read back out of a uuid column. `None` means the value was
/// corrupt — it cannot be bad user input, because the column would not have
/// accepted it.
fn parse_stored_pick(me_user: &MeProfile, raw_pick: &str) -> Option<sqlx::types::Uuid> {
    match raw_pick.parse::<sqlx::types::Uuid>() {
        Ok(pick) => Some(pick),
        Err(error) => {
            tracing::warn!(
                user_id = %me_user.id,
                raw_pick,
                error = %error,
                "Stored starting-assistant pick is not a uuid; serving welcome screen"
            );
            None
        }
    }
}

/// Resolve a hub pick to the current published clone's live `assistants.id`.
///
/// A pick that no longer resolves (withdrawn, unpublished, access lost)
/// degrades to the welcome screen rather than falling through to an audience
/// pin: a user who overrode their start screen should not be silently
/// re-steered by policy when their choice disappears.
async fn resolve_hub_pick(
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
                assistant_hub_assistant_id: Some(pick.to_string()),
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

/// Resolve a pick of an assistant that was never published to the hub.
///
/// The id is already the live one, so this is purely an access check, and it
/// uses the same read path as `GET /assistants/{id}`: owner or a viewer/editor
/// share grant, archived excluded. That path also refuses hub-version clones,
/// so a clone id stored here — which a republish would strand — can never
/// resolve; hub assistants have to come through [`resolve_hub_pick`].
///
/// Degrades to the welcome screen on any failure, for the same reason a hub
/// pick does.
async fn resolve_assistant_pick(
    app_state: &AppState,
    policy: &PolicyEngine,
    me_user: &MeProfile,
    pick: sqlx::types::Uuid,
) -> StartingAssistantResponse {
    match assistant::get_assistant_by_id(&app_state.db, policy, &me_user.to_subject(), pick).await {
        Ok(record) => StartingAssistantResponse {
            starting_assistant: Some(StartingAssistantInfo {
                assistant_id: record.id.to_string(),
                assistant_hub_assistant_id: None,
                source: StartingAssistantSource::UserPick,
                audience: None,
            }),
        },
        Err(report) => {
            tracing::warn!(
                user_id = %me_user.id,
                assistant_id = %pick,
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
            subjects,
            pinned_assistant_hub_assistant_id: Uuid::new_v4(),
        }
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
            let (winner, matched) = match_winning_audience(&policy, identity).unwrap();
            assert_eq!(winner, "beta");
            assert_eq!(matched.subjects, vec![group("group-b")]);

            // Reversing priority_order must flip the winner: the ordered key
            // is load-bearing.
            let policy = policy_with(entries, vec!["alpha", "beta"]);
            let (winner, matched) = match_winning_audience(&policy, identity).unwrap();
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
        let (winner, _) = match_winning_audience(&policy, identity_of(&user_groups)).unwrap();
        assert_eq!(winner, "beta");
    }

    #[test]
    fn skips_unknown_priority_order_entries() {
        // The parser rejects these, but the resolver must stay total anyway.
        let policy = policy_with(vec![("beta", audience("group-b"))], vec!["ghost", "beta"]);
        let user_groups = member_of(&["group-b"]);
        let (winner, _) = match_winning_audience(&policy, identity_of(&user_groups)).unwrap();
        assert_eq!(winner, "beta");
    }

    #[test]
    fn audience_absent_from_priority_order_never_wins() {
        let policy = policy_with(vec![("alpha", audience("group-a"))], vec![]);
        let user_groups = member_of(&["group-a"]);
        assert!(match_winning_audience(&policy, identity_of(&user_groups)).is_none());
    }

    #[test]
    fn no_winner_for_empty_groups_or_empty_policy() {
        let policy = policy_with(vec![("alpha", audience("group-a"))], vec!["alpha"]);
        assert!(match_winning_audience(&policy, identity_of(&[])).is_none());

        let empty = ExperiencePolicyDocument::default();
        let user_groups = member_of(&["group-a"]);
        assert!(match_winning_audience(&empty, identity_of(&user_groups)).is_none());
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
            let (winner, _) = match_winning_audience(&policy, identity_of(&groups)).unwrap();
            assert_eq!(winner, "rollout");
        }

        let carol = AudienceIdentity {
            groups: &[],
            organization_user_id: Some("oid-carol"),
        };
        let (winner, _) = match_winning_audience(&policy, carol).unwrap();
        assert_eq!(winner, "rollout");

        let stranger = AudienceIdentity {
            groups: &member_of(&["group-z"]),
            organization_user_id: Some("oid-dave"),
        };
        assert!(match_winning_audience(&policy, stranger).is_none());
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
            match_winning_audience(&policy, alice).map(|(name, _)| name),
            Some("named")
        );

        let bob = AudienceIdentity {
            groups: &[],
            organization_user_id: Some("oid-bob"),
        };
        assert!(match_winning_audience(&policy, bob).is_none());

        // An identity provider that issues no `oid` cannot match a user
        // subject — the id it would be compared against was never asserted.
        let groups = member_of(&["oid-alice"]);
        assert!(match_winning_audience(&policy, identity_of(&groups)).is_none());
    }

    #[test]
    fn an_organization_audience_matches_a_user_with_no_groups() {
        let policy = policy_with(
            vec![("everyone", audience_of(vec![AudienceSubject::Organization]))],
            vec!["everyone"],
        );

        let (winner, _) = match_winning_audience(&policy, identity_of(&[])).unwrap();
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
            match_winning_audience(&policy, identity_of(&engineer)).map(|(name, _)| name),
            Some("engineering")
        );
        assert_eq!(
            match_winning_audience(&policy, identity_of(&[])).map(|(name, _)| name),
            Some("everyone")
        );

        // Listed first it shadows everything below it — an org-wide rollout,
        // deliberately, and visibly, from one ordered key.
        let policy = policy_with(entries, vec!["everyone", "engineering"]);
        assert_eq!(
            match_winning_audience(&policy, identity_of(&engineer)).map(|(name, _)| name),
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
}
