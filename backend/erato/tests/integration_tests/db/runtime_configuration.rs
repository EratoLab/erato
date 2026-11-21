use crate::test_utils::{JwtTokenBuilder, hermetic_app_config};
use crate::{MIGRATOR, test_app_state};
use erato::config::ConfigSourceFile;
use erato::db::entity::prelude::RuntimeConfiguration;
use erato::db::entity::runtime_configuration;
use erato::distribution::runtime::{ADMIN_PANEL_SOURCE_SERVICE, ReloadableAppState};
use erato::models::runtime_configuration::{
    ERATO_BACKEND_SOURCE_SERVICE, ERATO_TOML_SOURCE_TYPE, TRANSLATION_PO_SOURCE_TYPE,
    mirror_erato_backend_sources, mirror_erato_backend_sources_with_translation_pos,
};
use erato::services::config_redaction::REDACTION_MARKER;
use sea_orm::{
    ActiveValue::Set, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder,
};
use serde_json::{Value, json};
use sqlx::{ConnectOptions, Pool, Postgres};
use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::Duration;

const TEST_ENCRYPTION_KEY: &str = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

#[sqlx::test(migrator = "MIGRATOR")]
async fn internationalization_hot_reloads_in_the_running_server(pool: Pool<Postgres>) {
    // SQLx runs the real deploy scripts. Supply the registry entry Erato's
    // startup check expects from Sqitch.
    sqlx::query("CREATE TABLE changes (change_id text PRIMARY KEY)")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO changes (change_id) VALUES ($1)")
        .bind(include_str!("../../../../sqitch/latest_change.txt").trim())
        .execute(&pool)
        .await
        .unwrap();

    let test_dir = tempfile::tempdir().unwrap();
    fs::write(
        test_dir.path().join("erato.toml"),
        format!(
            r#"
[chat_provider]
provider_kind = "openai"
model_name = "gpt-4o"

[file_storage_providers]

[server]
encryption_key = "{TEST_ENCRYPTION_KEY}"

[runtime_configuration]
enabled = true

[logging]
format = "json"

[frontend]
web_frontend_bundle_path = "./web"
translation_po_compilation_mode = "precompiled"

[i18n.language]
default_language = "en"
language_detection_priority = ["id_token_any", "browser_accept_language"]
"#
        ),
    )
    .unwrap();
    let web = test_dir.path().join("web");
    let locales = web.join("public/common/locales");
    for (locale, id, translation) in [
        ("de", "fallback", "Deutsch"),
        ("fr", "fallback", "Français"),
        ("es", "local", "Español"),
    ] {
        let directory = locales.join(locale);
        fs::create_dir_all(&directory).unwrap();
        fs::write(
            directory.join("messages.po"),
            format!("#. js-lingui-explicit-id\nmsgid \"{id}\"\nmsgstr \"{translation}\"\n"),
        )
        .unwrap();
    }
    fs::write(
        locales.join("es/messages.json"),
        r#"{"messages":{"local":"Precompiled"}}"#,
    )
    .unwrap();
    fs::write(web.join("404.html"), "Not Found").unwrap();

    let app_state = app_state_with_encryption(pool.clone()).await;
    let saved = r#"
[frontend]
translation_po_compilation_mode = "just_in_time"
[i18n.language]
default_language = "de"
language_detection_priority = ["browser_accept_language", "id_token_any"]
"#;
    replace_admin_i18n(&app_state, &pool, Some(saved), false).await;

    let log_path = test_dir.path().join("erato.log");
    let log_file = fs::File::create(&log_path).unwrap();
    let _server = EratoProcess(
        Command::new(env!("CARGO_BIN_EXE_erato"))
            .current_dir(test_dir.path())
            .env_clear()
            .env(
                "DATABASE_URL",
                pool.connect_options().to_url_lossy().as_str(),
            )
            .env("ERATO_SKIP_DOTENV", "1")
            .env("ERATO_DEPLOYMENT_VERSION", "runtime-i18n-test")
            .env("HTTP_PORT", "0")
            .env("TOKIO_WORKER_THREADS", "4")
            .stderr(log_file.try_clone().unwrap())
            .stdout(log_file)
            .spawn()
            .unwrap(),
    );
    let address = wait_for_server_log(&log_path, |log| {
        log.lines().find_map(|line| {
            let event: Value = serde_json::from_str(line).ok()?;
            event["fields"]["listen_addr"].as_str().map(str::to_owned)
        })
    })
    .await;
    let base = format!("http://{address}");
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    let jwt = JwtTokenBuilder::new().preferred_language("pl").build();
    let profile = |browser_language: &str| {
        client
            .get(format!("{base}/api/v1beta/me/profile"))
            .bearer_auth(&jwt)
            .header("accept-language", browser_language)
    };
    let catalog = || client.get(format!("{base}/public/common/locales/es/messages.json"));
    let assert_profile = |language| {
        let request = profile("fr");
        async move {
            assert_eq!(get_json(request).await["preferred_language"], language);
        }
    };
    let assert_jit_catalog = || {
        let request = catalog();
        async move {
            assert_eq!(
                get_json(request).await["messages"],
                json!({ "local": ["Español"], "fallback": ["Deutsch"] }),
            );
        }
    };

    // Startup already honors the panel override. Wait for the listener's
    // subscription and initial reconciliation before changing the rows.
    assert_profile("fr").await;
    assert_jit_catalog().await;
    wait_for_reload(&log_path, 1).await;

    let invalid = r#"
[frontend]
translation_po_compilation_mode = "unknown"
[i18n.language]
default_language = "es"
language_detection_priority = []
"#;
    replace_admin_i18n(&app_state, &pool, Some(invalid), true).await;
    wait_for_reload(&log_path, 2).await;
    assert_profile("fr").await;
    assert_jit_catalog().await;
    assert_eq!(
        get_json(client.get(format!("{base}/public/common/overrides/de.json"))).await["messages"]["override"],
        json!(["Verwaltung"])
    );
    let log = fs::read_to_string(&log_path).unwrap();
    assert!(log.lines().any(|line| {
        line.contains("Failed to load internationalization settings")
            && line.contains("frontend.translation_po_compilation_mode")
    }));

    // Clear the override, then restore that revision using the same write
    // and notification contract as the panel's configuration-history revert.
    replace_admin_i18n(&app_state, &pool, None, false).await;
    wait_for_reload(&log_path, 3).await;
    assert_profile("pl").await;
    let precompiled = catalog().send().await.unwrap().error_for_status().unwrap();
    let precompiled_etag = precompiled.headers()["etag"].clone();
    assert_eq!(
        precompiled.json::<Value>().await.unwrap()["messages"]["local"],
        "Precompiled"
    );

    replace_admin_i18n(&app_state, &pool, Some(saved), false).await;
    wait_for_reload(&log_path, 4).await;
    assert_profile("fr").await;
    let jit = catalog()
        .header("if-none-match", precompiled_etag)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    let jit_etag = jit.headers()["etag"].clone();
    assert_eq!(
        jit.json::<Value>().await.unwrap()["messages"]["fallback"],
        json!(["Deutsch"])
    );

    // A fallback change in JIT must invalidate the compiled catalog even
    // though the requested PO and compilation mode have stayed the same.
    let empty_priority = r#"
[frontend]
translation_po_compilation_mode = "just_in_time"
[i18n.language]
default_language = "fr"
language_detection_priority = []
"#;
    replace_admin_i18n(&app_state, &pool, Some(empty_priority), false).await;
    wait_for_reload(&log_path, 5).await;
    assert_eq!(get_json(profile("de")).await["preferred_language"], "fr");
    assert_eq!(
        get_json(catalog().header("if-none-match", jit_etag)).await["messages"]["fallback"],
        json!(["Français"])
    );
}

struct EratoProcess(std::process::Child);

impl Drop for EratoProcess {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

async fn wait_for_server_log<T>(path: &Path, find: impl Fn(&str) -> Option<T>) -> T {
    tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            let log = fs::read_to_string(path).unwrap();
            if let Some(value) = find(&log) {
                return value;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap_or_else(|_| {
        panic!(
            "Timed out waiting for Erato logs:\n{}",
            fs::read_to_string(path).unwrap()
        )
    })
}

async fn wait_for_reload(path: &Path, count: usize) {
    wait_for_server_log(path, |log| {
        (log.lines()
            .filter(|line| line.contains("Reloaded runtime distribution"))
            .count()
            >= count)
            .then_some(())
    })
    .await
}

async fn get_json(request: reqwest::RequestBuilder) -> Value {
    request
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap()
}

async fn replace_admin_i18n(
    app_state: &erato::state::AppState,
    pool: &Pool<Postgres>,
    toml: Option<&str>,
    add_translation: bool,
) {
    let mut transaction = pool.begin().await.unwrap();
    sqlx::query("DELETE FROM runtime_configuration WHERE source_service = $1 AND source_type = $2")
        .bind(ADMIN_PANEL_SOURCE_SERVICE)
        .bind(ERATO_TOML_SOURCE_TYPE)
        .execute(&mut *transaction)
        .await
        .unwrap();
    for (source_type, filename, contents) in [
        (ERATO_TOML_SOURCE_TYPE, "erato.toml", toml),
        (
            TRANSLATION_PO_SOURCE_TYPE,
            "overrides/de.po",
            add_translation
                .then_some("#. js-lingui-explicit-id\nmsgid \"override\"\nmsgstr \"Verwaltung\"\n"),
        ),
    ] {
        if let Some(contents) = contents {
            sqlx::query(
                "INSERT INTO runtime_configuration (source_service, source_type, source_filename, config) VALUES ($1, $2, $3, $4)",
            )
            .bind(ADMIN_PANEL_SOURCE_SERVICE)
            .bind(source_type)
            .bind(filename)
            .bind(app_state.encrypt(contents).unwrap())
            .execute(&mut *transaction)
            .await
            .unwrap();
        }
    }
    sqlx::query("SELECT pg_notify('configuration_changed', '')")
        .execute(&mut *transaction)
        .await
        .unwrap();
    transaction.commit().await.unwrap();
}

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

#[sqlx::test(migrator = "MIGRATOR")]
async fn reloadable_state_applies_admin_mcp_overrides_after_backend_sources(pool: Pool<Postgres>) {
    let app_state = app_state_with_encryption(pool).await;
    let backend_config = app_state
        .encrypt(
            r#"
[mcp_servers.docs]
transport_type = "streamable_http"
url = "https://backend.example.test/mcp"

[mcp_servers_global.default_tool_annotations]
open_world_hint = true
[mcp_servers.docs.default_tool_annotations]
read_only_hint = true

[mcp_server_permissions.rules.docs]
rule_type = "allow-all"
mcp_server_ids = ["docs"]
"#,
        )
        .unwrap();
    let admin_config = app_state
        .encrypt(
            r#"
[mcp_servers.docs]
url = "https://admin.example.test/mcp"
[mcp_servers.docs.tools.read_file.override_tool_annotations]
destructive_hint = false
"#,
        )
        .unwrap();
    RuntimeConfiguration::insert_many([
        runtime_configuration::ActiveModel {
            source_service: Set(ERATO_BACKEND_SOURCE_SERVICE.to_string()),
            source_type: Set(ERATO_TOML_SOURCE_TYPE.to_string()),
            source_filename: Set(Some("erato.toml".to_string())),
            config: Set(backend_config),
            ..Default::default()
        },
        runtime_configuration::ActiveModel {
            source_service: Set("erato_admin_panel".to_string()),
            source_type: Set(ERATO_TOML_SOURCE_TYPE.to_string()),
            source_filename: Set(Some("mcp-overrides.toml".to_string())),
            config: Set(admin_config),
            ..Default::default()
        },
    ])
    .exec(&app_state.db)
    .await
    .unwrap();

    let reloaded = ReloadableAppState::load(&app_state).await.unwrap();

    assert_eq!(
        reloaded.mcp.config.mcp_servers["docs"].url,
        "https://admin.example.test/mcp"
    );
    assert!(
        reloaded
            .mcp
            .config
            .mcp_server_permissions
            .rules
            .contains_key("docs")
    );
    assert_eq!(
        reloaded
            .mcp
            .config
            .mcp_servers_global
            .default_tool_annotations
            .open_world_hint,
        Some(true)
    );
    assert_eq!(
        reloaded.mcp.config.mcp_servers["docs"]
            .default_tool_annotations
            .read_only_hint,
        Some(true)
    );
    assert_eq!(
        reloaded.mcp.config.mcp_servers["docs"].tools["read_file"]
            .override_tool_annotations
            .destructive_hint,
        Some(false)
    );
    let valid_config = reloaded.mcp.config.clone();
    *app_state.reloadable.write().await = reloaded;

    RuntimeConfiguration::update_many()
        .filter(runtime_configuration::Column::SourceService.eq("erato_admin_panel"))
        .col_expr(
            runtime_configuration::Column::Config,
            sea_orm::sea_query::Expr::value(
                app_state
                    .encrypt("[mcp_servers.docs.default_tool_annotations]\nreadOnlyHint = true\n")
                    .unwrap(),
            ),
        )
        .exec(&app_state.db)
        .await
        .unwrap();
    assert!(ReloadableAppState::load(&app_state).await.is_err());
    assert_eq!(app_state.mcp_state().await.config, valid_config);
}

/// The Teams inactivity nudge is layered like the MCP sections: the admin
/// panel's override wins key by key over the mirrored file. An override that
/// fails validation keeps the previous nudge settings without holding up the
/// rest of the reload.
#[sqlx::test(migrator = "MIGRATOR")]
async fn reloadable_state_applies_admin_nudge_overrides_and_keeps_valid_settings(
    pool: Pool<Postgres>,
) {
    let app_state = app_state_with_encryption(pool).await;
    let row = |service: &str, contents: &str| runtime_configuration::ActiveModel {
        source_service: Set(service.to_string()),
        source_type: Set(ERATO_TOML_SOURCE_TYPE.to_string()),
        source_filename: Set(Some("erato.toml".to_string())),
        config: Set(app_state.encrypt(contents).unwrap()),
        ..Default::default()
    };
    RuntimeConfiguration::insert_many([
        row(
            ERATO_BACKEND_SOURCE_SERVICE,
            r#"
[integrations.ms_office.teams.bot.inactivity_nudge]
inactive_after = "7d"
tips = ["From the file"]
"#,
        ),
        row(
            "erato_admin_panel",
            r#"
[integrations.ms_office.teams.bot.inactivity_nudge]
inactive_after = "1h"
pilot_users = ["pilot@example.com"]

[integrations.ms_office.teams.bot.inactivity_nudge.send_window]
start_hour = 9
"#,
        ),
    ])
    .exec(&app_state.db)
    .await
    .unwrap();

    let reloaded = ReloadableAppState::load(&app_state).await.unwrap();
    let nudge = reloaded.teams_nudge.clone();
    assert_eq!(nudge.inactive_after, "1h");
    assert_eq!(nudge.tips, ["From the file"]);
    assert_eq!(nudge.pilot_users, ["pilot@example.com"]);
    assert_eq!(nudge.send_window.start_hour, 9);
    assert_eq!(nudge.send_window.end_hour, 18);
    *app_state.reloadable.write().await = reloaded;
    assert_eq!(
        app_state
            .effective_config()
            .await
            .integrations
            .ms_office
            .teams
            .bot
            .inactivity_nudge,
        nudge
    );

    // This deployment runs no Teams bot, and an enabled nudge needs one: the
    // override is refused and the previous settings stay, while the MCP
    // server beside it in the same file still applies.
    RuntimeConfiguration::update_many()
        .filter(runtime_configuration::Column::SourceService.eq("erato_admin_panel"))
        .col_expr(
            runtime_configuration::Column::Config,
            sea_orm::sea_query::Expr::value(
                app_state
                    .encrypt(
                        r#"
[integrations.ms_office.teams.bot.inactivity_nudge]
enabled = true

[mcp_servers.docs]
transport_type = "streamable_http"
url = "https://admin.example.test/mcp"
"#,
                    )
                    .unwrap(),
            ),
        )
        .exec(&app_state.db)
        .await
        .unwrap();
    let reloaded = ReloadableAppState::load(&app_state).await.unwrap();
    assert_eq!(reloaded.teams_nudge, nudge);
    assert!(reloaded.mcp.config.mcp_servers.contains_key("docs"));
}
