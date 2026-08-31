//! Per-user resolution of the admin-pinned "starting assistant". An admin pins
//! an assistant-hub assistant for an audience (an Entra group) in the org-wide
//! experience policy document ([`crate::distribution::experience_policy`]); a
//! user in that audience lands there instead of on the welcome screen.
//!
//! This lives on the authenticated `/me` tree rather than the public bundle
//! route because the document is org-wide but its resolution depends on the
//! caller's group memberships.
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

use crate::distribution::experience_policy::{ExperienceAudience, ExperiencePolicyDocument};
use crate::models::{assistant_hub, share_grant};
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

/// Pick the winning audience for a user: the first entry of `priority_order`
/// naming an audience whose Entra group the user is a member of.
///
/// Precedence comes from `priority_order` alone, as `determine_chat_provider`
/// does for `chat_providers.priority_order`; the `audiences` map's iteration
/// order is arbitrary and must never decide the winner.
pub fn match_winning_audience<'a>(
    policy: &'a ExperiencePolicyDocument,
    user_groups: &[String],
) -> Option<(&'a str, &'a ExperienceAudience)> {
    policy.priority_order.iter().find_map(|audience_name| {
        policy
            .audiences
            .get_key_value(audience_name)
            .filter(|(_, audience)| {
                user_groups
                    .iter()
                    .any(|group| group == &audience.entra_group_id)
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
    let Some((audience_name, audience)) = match_winning_audience(&policy, &me_user.groups) else {
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

    // Check the AUDIENCE's own access, not the caller's: revoking the audience
    // grant must stop the pin even for users who keep personal access through
    // a direct grant.
    let assistant_id = record.assistant.id.to_string();
    match share_grant::is_resource_shared_with_organization_group(
        &app_state.db,
        "assistant",
        &assistant_id,
        &audience.entra_group_id,
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
    use sqlx::types::Uuid;
    use std::collections::HashMap;

    fn audience(entra_group_id: &str) -> ExperienceAudience {
        ExperienceAudience {
            entra_group_id: entra_group_id.to_string(),
            pinned_assistant_hub_assistant_id: Uuid::new_v4(),
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
        let user_groups = vec!["group-a".to_string(), "group-b".to_string()];

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
            let (winner, matched) = match_winning_audience(&policy, &user_groups).unwrap();
            assert_eq!(winner, "beta");
            assert_eq!(matched.entra_group_id, "group-b");

            // Reversing priority_order must flip the winner: the ordered key
            // is load-bearing.
            let policy = policy_with(entries, vec!["alpha", "beta"]);
            let (winner, matched) = match_winning_audience(&policy, &user_groups).unwrap();
            assert_eq!(winner, "alpha");
            assert_eq!(matched.entra_group_id, "group-a");
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
        let user_groups = vec!["group-b".to_string()];
        let (winner, _) = match_winning_audience(&policy, &user_groups).unwrap();
        assert_eq!(winner, "beta");
    }

    #[test]
    fn skips_unknown_priority_order_entries() {
        // The parser rejects these, but the resolver must stay total anyway.
        let policy = policy_with(vec![("beta", audience("group-b"))], vec!["ghost", "beta"]);
        let user_groups = vec!["group-b".to_string()];
        let (winner, _) = match_winning_audience(&policy, &user_groups).unwrap();
        assert_eq!(winner, "beta");
    }

    #[test]
    fn audience_absent_from_priority_order_never_wins() {
        let policy = policy_with(vec![("alpha", audience("group-a"))], vec![]);
        let user_groups = vec!["group-a".to_string()];
        assert!(match_winning_audience(&policy, &user_groups).is_none());
    }

    #[test]
    fn no_winner_for_empty_groups_or_empty_policy() {
        let policy = policy_with(vec![("alpha", audience("group-a"))], vec!["alpha"]);
        assert!(match_winning_audience(&policy, &[]).is_none());

        let empty = ExperiencePolicyDocument::default();
        assert!(match_winning_audience(&empty, &["group-a".to_string()]).is_none());
    }
}
