use crate::db::entity::prelude::*;
use crate::db::entity::user_preferences;
use eyre::Report;
use sea_orm::prelude::Uuid;
use sea_orm::{ActiveModelTrait, ActiveValue, DatabaseConnection, EntityTrait, IntoActiveModel};

#[derive(Debug, Clone, Default)]
pub struct UpdateUserPreferencesInput {
    pub nickname: Option<Option<String>>,
    pub job_title: Option<Option<String>>,
    pub assistant_custom_instructions: Option<Option<String>>,
    pub assistant_additional_information: Option<Option<String>>,
    pub default_chat_provider: Option<Option<String>>,
    /// An `assistant_hub_assistants.id`, not the clone's `assistants.id`,
    /// which is minted fresh on every republish. `Some(None)` removes the pick.
    pub starting_hub_assistant_id: Option<Option<Uuid>>,
    /// An `assistants.id` for an assistant that was never published to the hub
    /// and so has no stable hub id to point at. `Some(None)` removes the pick.
    pub starting_assistant_id: Option<Option<Uuid>>,
    pub starting_assistant_cleared: Option<bool>,
}

/// The stored start-screen state: never set (inherit an audience pin),
/// explicitly cleared, a hub pick, or a plain-assistant pick. The two id
/// fields are alternatives, never both set.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
struct StartingAssistantState {
    hub_assistant_id: Option<Uuid>,
    assistant_id: Option<Uuid>,
    cleared: bool,
}

/// Apply the start-screen patches on top of the current state.
///
/// The clear needs its own boolean because [`normalize_optional_text`]
/// collapses `""`/whitespace/null to NULL, so a single nullable column cannot
/// tell "cleared" from "never set" and would silently re-apply the admin's pin.
///
/// Setting either pick clears the other and un-clears; clearing removes both.
/// The patches are applied pick-then-clear, so a request carrying both resolves
/// to cleared, and plain-then-hub, so one carrying both picks resolves to the
/// hub pick. The `user_preferences_starting_assistant_state_check` and
/// `..._single_pick_check` constraints backstop all of this.
fn apply_starting_assistant_patch(
    current: StartingAssistantState,
    starting_hub_assistant_id: Option<Option<Uuid>>,
    starting_assistant_id: Option<Option<Uuid>>,
    starting_assistant_cleared: Option<bool>,
) -> StartingAssistantState {
    let mut state = current;
    if let Some(patch) = starting_assistant_id {
        state.assistant_id = patch;
        if patch.is_some() {
            state.hub_assistant_id = None;
            state.cleared = false;
        }
    }
    if let Some(patch) = starting_hub_assistant_id {
        state.hub_assistant_id = patch;
        if patch.is_some() {
            state.assistant_id = None;
            state.cleared = false;
        }
    }
    if let Some(patch) = starting_assistant_cleared {
        state.cleared = patch;
        if patch {
            state.hub_assistant_id = None;
            state.assistant_id = None;
        }
    }
    state
}

pub async fn get_user_preferences(
    conn: &DatabaseConnection,
    user_id: &Uuid,
) -> Result<Option<user_preferences::Model>, Report> {
    Ok(UserPreferences::find_by_id(*user_id).one(conn).await?)
}

pub async fn upsert_user_preferences(
    conn: &DatabaseConnection,
    user_id: &Uuid,
    input: UpdateUserPreferencesInput,
) -> Result<user_preferences::Model, Report> {
    if let Some(existing) = get_user_preferences(conn, user_id).await? {
        let existing_starting_assistant = StartingAssistantState {
            hub_assistant_id: existing.starting_hub_assistant_id,
            assistant_id: existing.starting_assistant_id,
            cleared: existing.starting_assistant_cleared,
        };
        let mut model = existing.into_active_model();

        if let Some(value) = input.nickname {
            model.nickname = ActiveValue::Set(normalize_optional_text(value));
        }
        if let Some(value) = input.job_title {
            model.job_title = ActiveValue::Set(normalize_optional_text(value));
        }
        if let Some(value) = input.assistant_custom_instructions {
            model.assistant_custom_instructions = ActiveValue::Set(normalize_optional_text(value));
        }
        if let Some(value) = input.assistant_additional_information {
            model.assistant_additional_information =
                ActiveValue::Set(normalize_optional_text(value));
        }
        if let Some(value) = input.default_chat_provider {
            model.default_chat_provider = ActiveValue::Set(normalize_optional_text(value));
        }
        if input.starting_hub_assistant_id.is_some()
            || input.starting_assistant_id.is_some()
            || input.starting_assistant_cleared.is_some()
        {
            let state = apply_starting_assistant_patch(
                existing_starting_assistant,
                input.starting_hub_assistant_id,
                input.starting_assistant_id,
                input.starting_assistant_cleared,
            );
            model.starting_hub_assistant_id = ActiveValue::Set(state.hub_assistant_id);
            model.starting_assistant_id = ActiveValue::Set(state.assistant_id);
            model.starting_assistant_cleared = ActiveValue::Set(state.cleared);
        }

        Ok(model.update(conn).await?)
    } else {
        // Fresh row: the same rule on top of "never set", so the first-ever
        // pick or clear is not dropped.
        let starting_assistant = apply_starting_assistant_patch(
            StartingAssistantState::default(),
            input.starting_hub_assistant_id,
            input.starting_assistant_id,
            input.starting_assistant_cleared,
        );
        let model = user_preferences::ActiveModel {
            user_id: ActiveValue::Set(*user_id),
            nickname: ActiveValue::Set(normalize_optional_text(input.nickname.unwrap_or(None))),
            job_title: ActiveValue::Set(normalize_optional_text(input.job_title.unwrap_or(None))),
            assistant_custom_instructions: ActiveValue::Set(normalize_optional_text(
                input.assistant_custom_instructions.unwrap_or(None),
            )),
            assistant_additional_information: ActiveValue::Set(normalize_optional_text(
                input.assistant_additional_information.unwrap_or(None),
            )),
            default_chat_provider: ActiveValue::Set(normalize_optional_text(
                input.default_chat_provider.unwrap_or(None),
            )),
            starting_hub_assistant_id: ActiveValue::Set(starting_assistant.hub_assistant_id),
            starting_assistant_id: ActiveValue::Set(starting_assistant.assistant_id),
            starting_assistant_cleared: ActiveValue::Set(starting_assistant.cleared),
            ..Default::default()
        };

        Ok(UserPreferences::insert(model)
            .exec_with_returning(conn)
            .await?)
    }
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value.and_then(|v| {
        let trimmed = v.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

#[cfg(test)]
mod tests {
    use super::{StartingAssistantState, apply_starting_assistant_patch};
    use sea_orm::prelude::Uuid;

    fn inherit() -> StartingAssistantState {
        StartingAssistantState::default()
    }

    fn cleared() -> StartingAssistantState {
        StartingAssistantState {
            cleared: true,
            ..StartingAssistantState::default()
        }
    }

    fn hub_pick(id: Uuid) -> StartingAssistantState {
        StartingAssistantState {
            hub_assistant_id: Some(id),
            ..StartingAssistantState::default()
        }
    }

    fn plain_pick(id: Uuid) -> StartingAssistantState {
        StartingAssistantState {
            assistant_id: Some(id),
            ..StartingAssistantState::default()
        }
    }

    #[test]
    fn absent_patches_leave_every_state_untouched() {
        let id = Uuid::new_v4();
        for state in [inherit(), cleared(), hub_pick(id), plain_pick(id)] {
            assert_eq!(
                apply_starting_assistant_patch(state, None, None, None),
                state
            );
        }
    }

    #[test]
    fn picking_an_assistant_unclears() {
        let id = Uuid::new_v4();
        assert_eq!(
            apply_starting_assistant_patch(cleared(), Some(Some(id)), None, None),
            hub_pick(id)
        );
        assert_eq!(
            apply_starting_assistant_patch(cleared(), None, Some(Some(id)), None),
            plain_pick(id)
        );
    }

    #[test]
    fn the_two_pick_kinds_replace_each_other() {
        let hub = Uuid::new_v4();
        let plain = Uuid::new_v4();
        assert_eq!(
            apply_starting_assistant_patch(hub_pick(hub), None, Some(Some(plain)), None),
            plain_pick(plain)
        );
        assert_eq!(
            apply_starting_assistant_patch(plain_pick(plain), Some(Some(hub)), None, None),
            hub_pick(hub)
        );
    }

    #[test]
    fn clearing_removes_a_pick() {
        let id = Uuid::new_v4();
        for state in [hub_pick(id), plain_pick(id)] {
            assert_eq!(
                apply_starting_assistant_patch(state, None, None, Some(true)),
                cleared()
            );
        }
    }

    #[test]
    fn cleared_wins_when_one_request_carries_both() {
        let id = Uuid::new_v4();
        assert_eq!(
            apply_starting_assistant_patch(inherit(), Some(Some(id)), None, Some(true)),
            cleared()
        );
        assert_eq!(
            apply_starting_assistant_patch(inherit(), None, Some(Some(id)), Some(true)),
            cleared()
        );
    }

    #[test]
    fn unclearing_alone_returns_to_inherit() {
        // cleared=false with no pick patch means "inherit again", not a pick.
        assert_eq!(
            apply_starting_assistant_patch(cleared(), None, None, Some(false)),
            inherit()
        );
    }

    #[test]
    fn removing_a_pick_returns_to_inherit_not_cleared() {
        // An explicit null pick withdraws the override without suppressing an
        // audience pin — only `starting_assistant_cleared` does that.
        let id = Uuid::new_v4();
        assert_eq!(
            apply_starting_assistant_patch(hub_pick(id), Some(None), None, None),
            inherit()
        );
        assert_eq!(
            apply_starting_assistant_patch(plain_pick(id), None, Some(None), None),
            inherit()
        );
    }

    #[test]
    fn nulling_one_kind_leaves_the_other_kinds_pick_alone() {
        // The dialog sends both id fields on every save, so a hub pick arrives
        // alongside an explicit null for the plain id and must survive it.
        let hub = Uuid::new_v4();
        let plain = Uuid::new_v4();
        assert_eq!(
            apply_starting_assistant_patch(inherit(), Some(Some(hub)), Some(None), None),
            hub_pick(hub)
        );
        assert_eq!(
            apply_starting_assistant_patch(inherit(), Some(None), Some(Some(plain)), None),
            plain_pick(plain)
        );
    }
}
