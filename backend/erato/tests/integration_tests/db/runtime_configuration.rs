use crate::test_utils::hermetic_app_config;
use crate::{MIGRATOR, test_app_state};
use erato::config::ConfigSourceFile;
use erato::db::entity::prelude::RuntimeConfiguration;
use erato::db::entity::runtime_configuration;
use erato::models::runtime_configuration::{
    ERATO_BACKEND_SOURCE_SERVICE, ERATO_TOML_SOURCE_TYPE, TRANSLATION_PO_SOURCE_TYPE,
    mirror_erato_backend_sources, mirror_erato_backend_sources_with_translation_pos,
};
use erato::services::config_redaction::REDACTION_MARKER;
use sea_orm::{
    ActiveValue::Set, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder,
};
use sqlx::{Pool, Postgres};

const TEST_ENCRYPTION_KEY: &str = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

async fn app_state_with_encryption(pool: Pool<Postgres>) -> erato::state::AppState {
    let mut app_config = hermetic_app_config(None, None);
    app_config.server.encryption_key = Some(TEST_ENCRYPTION_KEY.into());
    test_app_state(app_config, pool).await
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn mirror_replaces_only_backend_rows_and_redacts_encryption_key(pool: Pool<Postgres>) {
    let app_state = app_state_with_encryption(pool).await;
    RuntimeConfiguration::insert_many([
        runtime_configuration::ActiveModel {
            source_service: Set(ERATO_BACKEND_SOURCE_SERVICE.to_string()),
            source_filename: Set(Some("stale.toml".to_string())),
            config: Set("stale-ciphertext".to_string()),
            ..Default::default()
        },
        runtime_configuration::ActiveModel {
            source_service: Set("admin_panel".to_string()),
            source_filename: Set(None),
            config: Set("admin-ciphertext".to_string()),
            ..Default::default()
        },
    ])
    .exec(&app_state.db)
    .await
    .unwrap();
    let invalid_sources = vec![ConfigSourceFile {
        source_filename: "invalid.toml".to_string(),
        contents: format!("[server\n encryption_key = \"{TEST_ENCRYPTION_KEY}\""),
    }];
    let error = mirror_erato_backend_sources(&app_state, &invalid_sources)
        .await
        .expect_err("redaction failure should abort before replacing rows");
    assert_eq!(
        error.to_string(),
        "Failed to parse configuration source for redaction"
    );
    assert!(!error.to_string().contains(TEST_ENCRYPTION_KEY));
    assert_eq!(
        RuntimeConfiguration::find()
            .filter(runtime_configuration::Column::SourceService.eq(ERATO_BACKEND_SOURCE_SERVICE))
            .count(&app_state.db)
            .await
            .unwrap(),
        1
    );

    let sources = vec![
        ConfigSourceFile {
            source_filename: "erato.toml".to_string(),
            contents: format!(
                "# primary\n[server]\nencryption_key = \"{TEST_ENCRYPTION_KEY}\" # protected\n"
            ),
        },
        ConfigSourceFile {
            source_filename: "secrets.auto.erato.toml".to_string(),
            contents: "# secondary\n[generation]\nmax_tool_calls_per_message = 42\n".to_string(),
        },
    ];

    mirror_erato_backend_sources(&app_state, &sources)
        .await
        .unwrap();

    let admin_rows = RuntimeConfiguration::find()
        .filter(runtime_configuration::Column::SourceService.eq("admin_panel"))
        .all(&app_state.db)
        .await
        .unwrap();
    assert_eq!(admin_rows.len(), 1);
    assert_eq!(admin_rows[0].config, "admin-ciphertext");

    let backend_rows = RuntimeConfiguration::find()
        .filter(runtime_configuration::Column::SourceService.eq(ERATO_BACKEND_SOURCE_SERVICE))
        .order_by_asc(runtime_configuration::Column::SourceFilename)
        .all(&app_state.db)
        .await
        .unwrap();
    assert_eq!(backend_rows.len(), 2);
    assert!(
        backend_rows
            .iter()
            .all(|row| row.config.starts_with("enc-v1:"))
    );
    assert!(
        backend_rows
            .iter()
            .all(|row| !row.config.contains(TEST_ENCRYPTION_KEY))
    );

    let primary = backend_rows
        .iter()
        .find(|row| row.source_filename.as_deref() == Some("erato.toml"))
        .unwrap();
    let decrypted_primary = app_state.decrypt(&primary.config).unwrap();
    assert_eq!(
        decrypted_primary,
        "# primary\n[server]\nencryption_key = \"<redacted>\" # protected\n"
    );
    assert!(decrypted_primary.contains(REDACTION_MARKER));
    assert!(!decrypted_primary.contains(TEST_ENCRYPTION_KEY));

    let secondary = backend_rows
        .iter()
        .find(|row| row.source_filename.as_deref() == Some("secrets.auto.erato.toml"))
        .unwrap();
    assert_eq!(
        app_state.decrypt(&secondary.config).unwrap(),
        sources[1].contents
    );

    mirror_erato_backend_sources(&app_state, &sources)
        .await
        .unwrap();
    assert_eq!(
        RuntimeConfiguration::find()
            .filter(runtime_configuration::Column::SourceService.eq(ERATO_BACKEND_SOURCE_SERVICE))
            .count(&app_state.db)
            .await
            .unwrap(),
        2
    );

    mirror_erato_backend_sources(&app_state, &[]).await.unwrap();
    assert_eq!(
        RuntimeConfiguration::find()
            .filter(runtime_configuration::Column::SourceService.eq(ERATO_BACKEND_SOURCE_SERVICE))
            .count(&app_state.db)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        RuntimeConfiguration::find()
            .filter(runtime_configuration::Column::SourceService.eq("admin_panel"))
            .count(&app_state.db)
            .await
            .unwrap(),
        1
    );
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn mirror_includes_and_replaces_translation_po_rows(pool: Pool<Postgres>) {
    let app_state = app_state_with_encryption(pool).await;
    let config_sources = vec![ConfigSourceFile {
        source_filename: "erato.toml".to_string(),
        contents: "[server]\nhttp_port = 8080\n".to_string(),
    }];
    let translation_sources = vec![ConfigSourceFile {
        source_filename: "/public/common/locales/de/messages.po".to_string(),
        contents: "msgid \"Hello\"\nmsgstr \"Hallo\"\n".to_string(),
    }];

    mirror_erato_backend_sources_with_translation_pos(
        &app_state,
        &config_sources,
        &translation_sources,
    )
    .await
    .unwrap();

    let rows = RuntimeConfiguration::find()
        .filter(runtime_configuration::Column::SourceService.eq(ERATO_BACKEND_SOURCE_SERVICE))
        .order_by_asc(runtime_configuration::Column::SourceFilename)
        .all(&app_state.db)
        .await
        .unwrap();
    assert_eq!(rows.len(), 2);
    let toml_row = rows
        .iter()
        .find(|row| row.source_filename.as_deref() == Some("erato.toml"))
        .unwrap();
    assert_eq!(toml_row.source_type, ERATO_TOML_SOURCE_TYPE);
    let po_row = rows
        .iter()
        .find(|row| row.source_filename.as_deref() == Some("/public/common/locales/de/messages.po"))
        .unwrap();
    assert_eq!(po_row.source_type, TRANSLATION_PO_SOURCE_TYPE);
    assert_eq!(
        app_state.decrypt(&po_row.config).unwrap(),
        translation_sources[0].contents
    );

    let replacement = vec![ConfigSourceFile {
        source_filename: "/public/component-kits/example/locales/en/messages.po".to_string(),
        contents: "msgid \"Goodbye\"\nmsgstr \"Auf Wiedersehen\"\n".to_string(),
    }];
    mirror_erato_backend_sources_with_translation_pos(&app_state, &[], &replacement)
        .await
        .unwrap();

    let rows = RuntimeConfiguration::find()
        .filter(runtime_configuration::Column::SourceService.eq(ERATO_BACKEND_SOURCE_SERVICE))
        .all(&app_state.db)
        .await
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].source_type, TRANSLATION_PO_SOURCE_TYPE);
    assert_eq!(
        rows[0].source_filename.as_deref(),
        Some("/public/component-kits/example/locales/en/messages.po")
    );
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn concurrent_mirrors_leave_one_complete_source_set(pool: Pool<Postgres>) {
    let app_state = app_state_with_encryption(pool).await;
    let first = vec![
        ConfigSourceFile {
            source_filename: "first-a.toml".to_string(),
            contents: "value = \"first-a\"\n".to_string(),
        },
        ConfigSourceFile {
            source_filename: "first-b.toml".to_string(),
            contents: "value = \"first-b\"\n".to_string(),
        },
    ];
    let second = vec![
        ConfigSourceFile {
            source_filename: "second-a.toml".to_string(),
            contents: "value = \"second-a\"\n".to_string(),
        },
        ConfigSourceFile {
            source_filename: "second-b.toml".to_string(),
            contents: "value = \"second-b\"\n".to_string(),
        },
    ];

    let (first_result, second_result) = tokio::join!(
        mirror_erato_backend_sources(&app_state, &first),
        mirror_erato_backend_sources(&app_state, &second),
    );
    first_result.unwrap();
    second_result.unwrap();

    let filenames = RuntimeConfiguration::find()
        .filter(runtime_configuration::Column::SourceService.eq(ERATO_BACKEND_SOURCE_SERVICE))
        .order_by_asc(runtime_configuration::Column::SourceFilename)
        .all(&app_state.db)
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.source_filename.unwrap())
        .collect::<Vec<_>>();

    assert!(
        filenames == vec!["first-a.toml", "first-b.toml"]
            || filenames == vec!["second-a.toml", "second-b.toml"]
    );
}
