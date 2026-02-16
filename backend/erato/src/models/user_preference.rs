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

        Ok(model.update(conn).await?)
    } else {
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
