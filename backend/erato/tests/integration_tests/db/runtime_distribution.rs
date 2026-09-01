//! Integration tests for `ReloadableAppState::load` covering the experience
//! policy source type beside runtime translations.

use crate::test_utils::hermetic_app_config;
use crate::{MIGRATOR, test_app_state};
use erato::db::entity::prelude::RuntimeConfiguration;
use erato::db::entity::runtime_configuration;
use erato::distribution::experience_policy::{
    AudienceSubject, ExperienceAudience, ExperiencePolicyDocument,
};
use erato::distribution::runtime::{ADMIN_PANEL_SOURCE_SERVICE, ReloadableAppState};
use erato::models::runtime_configuration::{
    EXPERIENCE_POLICY_SOURCE_TYPE, TRANSLATION_PO_SOURCE_TYPE,
};
use sea_orm::{ActiveValue::Set, ColumnTrait, EntityTrait, QueryFilter};
use sqlx::types::Uuid;
use sqlx::{Pool, Postgres};
use std::collections::HashMap;

const TEST_ENCRYPTION_KEY: &str = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

const VALID_POLICY_JSON: &str = r#"{
    "audiences": {
        "engineering": {
            "subjects": [
                {"subject_type": "organization_group", "group_id": "8f7cb1f3-5c92-4e0f-9c39-89f65a852101"},
                {"subject_type": "user", "organization_user_id": "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a"}
            ],
            "pinned_assistant_hub_assistant_id": "6a3d2c76-2f6e-4e6f-8ad0-1f8f8f4f2a01"
        }
    },
    "priority_order": ["engineering"]
}"#;

async fn app_state_with_encryption(pool: Pool<Postgres>) -> erato::state::AppState {
    let mut app_config = hermetic_app_config(None, None);
    app_config.server.encryption_key = Some(TEST_ENCRYPTION_KEY.into());
    test_app_state(app_config, pool).await
}

fn expected_policy_document() -> ExperiencePolicyDocument {
    ExperiencePolicyDocument {
        audiences: HashMap::from([(
            "engineering".to_string(),
            ExperienceAudience {
                subjects: vec![
                    AudienceSubject::OrganizationGroup {
                        group_id: "8f7cb1f3-5c92-4e0f-9c39-89f65a852101".to_string(),
                    },
                    AudienceSubject::User {
                        organization_user_id: "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a".to_string(),
                    },
                ],
                pinned_assistant_hub_assistant_id: "6a3d2c76-2f6e-4e6f-8ad0-1f8f8f4f2a01"
                    .parse::<Uuid>()
                    .unwrap(),
            },
        )]),
        priority_order: vec!["engineering".to_string()],
    }
}

fn admin_panel_row(
    source_type: &str,
    source_filename: Option<&str>,
    config: String,
) -> runtime_configuration::ActiveModel {
    runtime_configuration::ActiveModel {
        source_service: Set(ADMIN_PANEL_SOURCE_SERVICE.to_string()),
        source_type: Set(source_type.to_string()),
        source_filename: Set(source_filename.map(str::to_string)),
        config: Set(config),
        ..Default::default()
    }
}

async fn insert_rows(
    app_state: &erato::state::AppState,
    rows: impl IntoIterator<Item = runtime_configuration::ActiveModel>,
) {
    RuntimeConfiguration::insert_many(rows)
        .exec(&app_state.db)
        .await
        .unwrap();
}

async fn delete_policy_rows(app_state: &erato::state::AppState) {
    RuntimeConfiguration::delete_many()
        .filter(runtime_configuration::Column::SourceType.eq(EXPERIENCE_POLICY_SOURCE_TYPE))
        .exec(&app_state.db)
        .await
        .unwrap();
}

async fn replace_translation_row(app_state: &erato::state::AppState, contents: &str) {
    RuntimeConfiguration::delete_many()
        .filter(runtime_configuration::Column::SourceType.eq(TRANSLATION_PO_SOURCE_TYPE))
        .filter(runtime_configuration::Column::SourceService.eq(ADMIN_PANEL_SOURCE_SERVICE))
        .exec(&app_state.db)
        .await
        .unwrap();
    insert_rows(
        app_state,
        [admin_panel_row(
            TRANSLATION_PO_SOURCE_TYPE,
            Some("overrides/de.po"),
            app_state.encrypt(contents).unwrap(),
        )],
    )
    .await;
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn load_includes_experience_policy_beside_translations(pool: Pool<Postgres>) {
    let app_state = app_state_with_encryption(pool).await;
    insert_rows(
        &app_state,
        [admin_panel_row(
            EXPERIENCE_POLICY_SOURCE_TYPE,
            Some("experience/policy.json"),
            app_state.encrypt(VALID_POLICY_JSON).unwrap(),
        )],
    )
    .await;
    replace_translation_row(&app_state, "msgid \"Hello\"\nmsgstr \"Hallo\"\n").await;

    let loaded = ReloadableAppState::load(&app_state).await.unwrap();
    assert_eq!(loaded.experience_policy, Some(expected_policy_document()));
    let translation = loaded
        .distribution_bundle
        .file("overrides/de.po")
        .expect("translation file should load beside the policy");
    assert_eq!(translation.contents, "msgid \"Hello\"\nmsgstr \"Hallo\"\n");

    // Deleting the row is the admin panel's unpin operation: absence must
    // clear the policy, not survive as a ghost via keep-previous.
    delete_policy_rows(&app_state).await;
    *app_state.reloadable.write().await = loaded;
    let reloaded = ReloadableAppState::load(&app_state).await.unwrap();
    assert_eq!(reloaded.experience_policy, None);
    assert!(
        reloaded
            .distribution_bundle
            .file("overrides/de.po")
            .is_some()
    );
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn malformed_experience_policy_keeps_previous_policy_and_reloads_translations(
    pool: Pool<Postgres>,
) {
    let app_state = app_state_with_encryption(pool).await;
    insert_rows(
        &app_state,
        [admin_panel_row(
            EXPERIENCE_POLICY_SOURCE_TYPE,
            Some("experience/policy.json"),
            app_state.encrypt(VALID_POLICY_JSON).unwrap(),
        )],
    )
    .await;
    replace_translation_row(&app_state, "msgid \"Hello\"\nmsgstr \"Hallo\"\n").await;

    let good_state = ReloadableAppState::load(&app_state).await.unwrap();
    assert_eq!(
        good_state.experience_policy,
        Some(expected_policy_document())
    );
    *app_state.reloadable.write().await = good_state;

    let unknown_audience_json = r#"{
        "audiences": {},
        "priority_order": ["missing"]
    }"#;
    let malformed_configs = [
        // Non-JSON garbage that still decrypts.
        app_state.encrypt("this is not json").unwrap(),
        // Valid JSON that fails structural validation.
        app_state.encrypt(unknown_audience_json).unwrap(),
        // Well-formed enc-v1 envelope whose ciphertext cannot decrypt.
        "enc-v1:AAAAAAAAAAAAAAAA:AAAA".to_string(),
    ];

    for (index, malformed_config) in malformed_configs.into_iter().enumerate() {
        delete_policy_rows(&app_state).await;
        insert_rows(
            &app_state,
            [admin_panel_row(
                EXPERIENCE_POLICY_SOURCE_TYPE,
                Some("experience/policy.json"),
                malformed_config,
            )],
        )
        .await;
        let translation_contents = format!("msgid \"Hello\"\nmsgstr \"Hallo {index}\"\n");
        replace_translation_row(&app_state, &translation_contents).await;

        let loaded = ReloadableAppState::load(&app_state).await.unwrap();
        // The changed translation proves the load actually ran end to end.
        assert_eq!(
            loaded
                .distribution_bundle
                .file("overrides/de.po")
                .unwrap()
                .contents,
            translation_contents
        );
        assert_eq!(
            loaded.experience_policy,
            Some(expected_policy_document()),
            "variant {index} must keep the previous policy"
        );
    }
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn malformed_policy_at_cold_start_loads_translations_without_policy(pool: Pool<Postgres>) {
    let app_state = app_state_with_encryption(pool).await;
    insert_rows(
        &app_state,
        [admin_panel_row(
            EXPERIENCE_POLICY_SOURCE_TYPE,
            Some("experience/policy.json"),
            app_state.encrypt("this is not json").unwrap(),
        )],
    )
    .await;
    replace_translation_row(&app_state, "msgid \"Hello\"\nmsgstr \"Hallo\"\n").await;

    // The harness seeds `reloadable` as Default, so the previous policy is
    // None — the malformed row degrades to "no policy", never to a failed load
    // that would take the translation bundle down.
    let loaded = ReloadableAppState::load(&app_state).await.unwrap();
    assert_eq!(loaded.experience_policy, None);
    assert!(loaded.distribution_bundle.file("overrides/de.po").is_some());
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn foreign_filenames_never_silently_unpin(pool: Pool<Postgres>) {
    let app_state = app_state_with_encryption(pool).await;
    insert_rows(
        &app_state,
        [
            admin_panel_row(
                EXPERIENCE_POLICY_SOURCE_TYPE,
                Some("experience/draft.json"),
                app_state.encrypt(VALID_POLICY_JSON).unwrap(),
            ),
            admin_panel_row(
                EXPERIENCE_POLICY_SOURCE_TYPE,
                None,
                app_state.encrypt(VALID_POLICY_JSON).unwrap(),
            ),
            admin_panel_row(
                EXPERIENCE_POLICY_SOURCE_TYPE,
                Some("experience/policy.toml"),
                app_state.encrypt(VALID_POLICY_JSON).unwrap(),
            ),
        ],
    )
    .await;

    let previous = ReloadableAppState {
        experience_policy: Some(expected_policy_document()),
        ..Default::default()
    };
    *app_state.reloadable.write().await = previous;

    // Rows exist but none carries the live filename: a defective or
    // newer-admin-panel write must keep the previous policy, never silently
    // unpin the whole org.
    let loaded = ReloadableAppState::load(&app_state).await.unwrap();
    assert_eq!(loaded.experience_policy, Some(expected_policy_document()));
}
