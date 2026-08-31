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
    /// An `assistant_hub_assistants.id`, not an `assistants.id`, which is
    /// minted fresh on every republish. `Some(None)` removes the pick.
    pub starting_hub_assistant_id: Option<Option<Uuid>>,
    pub starting_assistant_cleared: Option<bool>,
}

/// Apply the tri-state start-screen patches on top of the current state:
/// never set (inherit an audience pin), explicitly cleared, or an own pick.
///
/// The clear needs its own boolean because [`normalize_optional_text`]
/// collapses `""`/whitespace/null to NULL, so a single nullable column cannot
/// tell "cleared" from "never set" and would silently re-apply the admin's pin.
/// The pick patch is applied first, so a request carrying both resolves to
/// cleared; a row is never both, which the
/// `user_preferences_starting_assistant_state_check` constraint backstops.
fn apply_starting_assistant_patch(
    current: (Option<Uuid>, bool),
    starting_hub_assistant_id: Option<Option<Uuid>>,
    starting_assistant_cleared: Option<bool>,
) -> (Option<Uuid>, bool) {
    let (mut id, mut cleared) = current;
    if let Some(patch) = starting_hub_assistant_id {
        id = patch;
        if id.is_some() {
            cleared = false;
        }
    }
    if let Some(patch) = starting_assistant_cleared {
        cleared = patch;
        if cleared {
            id = None;
        }
    }
    (id, cleared)
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
        let existing_starting_hub_assistant_id = existing.starting_hub_assistant_id;
        let existing_starting_assistant_cleared = existing.starting_assistant_cleared;
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
        if input.starting_hub_assistant_id.is_some() || input.starting_assistant_cleared.is_some() {
            let (id, cleared) = apply_starting_assistant_patch(
                (
                    existing_starting_hub_assistant_id,
                    existing_starting_assistant_cleared,
                ),
                input.starting_hub_assistant_id,
                input.starting_assistant_cleared,
            );
            model.starting_hub_assistant_id = ActiveValue::Set(id);
            model.starting_assistant_cleared = ActiveValue::Set(cleared);
        }

        Ok(model.update(conn).await?)
    } else {
        // Fresh row: the same rule on top of "never set", so the first-ever
        // pick or clear is not dropped.
        let (starting_hub_assistant_id, starting_assistant_cleared) =
            apply_starting_assistant_patch(
                (None, false),
                input.starting_hub_assistant_id,
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
            starting_hub_assistant_id: ActiveValue::Set(starting_hub_assistant_id),
            starting_assistant_cleared: ActiveValue::Set(starting_assistant_cleared),
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
    use super::apply_starting_assistant_patch;
    use sea_orm::prelude::Uuid;

    #[test]
    fn absent_patches_leave_every_state_untouched() {
        let id = Uuid::new_v4();
        for state in [(None, false), (None, true), (Some(id), false)] {
            assert_eq!(apply_starting_assistant_patch(state, None, None), state);
        }
    }

    #[test]
    fn picking_an_assistant_unclears() {
        let id = Uuid::new_v4();
        assert_eq!(
            apply_starting_assistant_patch((None, true), Some(Some(id)), None),
            (Some(id), false)
        );
    }

    #[test]
    fn clearing_removes_a_pick() {
        let id = Uuid::new_v4();
        assert_eq!(
            apply_starting_assistant_patch((Some(id), false), None, Some(true)),
            (None, true)
        );
    }

    #[test]
    fn cleared_wins_when_one_request_carries_both() {
        let id = Uuid::new_v4();
        assert_eq!(
            apply_starting_assistant_patch((None, false), Some(Some(id)), Some(true)),
            (None, true)
        );
    }

    #[test]
    fn unclearing_alone_returns_to_inherit() {
        // cleared=false with no pick patch means "inherit again", not a pick.
        assert_eq!(
            apply_starting_assistant_patch((None, true), None, Some(false)),
            (None, false)
        );
    }

    #[test]
    fn removing_a_pick_returns_to_inherit_not_cleared() {
        // An explicit null pick withdraws the override without suppressing an
        // audience pin — only `starting_assistant_cleared` does that.
        let id = Uuid::new_v4();
        assert_eq!(
            apply_starting_assistant_patch((Some(id), false), Some(None), None),
            (None, false)
        );
    }
}
