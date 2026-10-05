//! Microsoft Teams bot: Erato in personal chats, group chats and channels.
//!
//! Layout (kept self-contained so it can become its own crate later):
//! - protocol, no Erato dependencies: [`activity`], [`inbound_auth`],
//!   [`connector`], [`user_token`], [`graph`], [`cards`], [`render`],
//!   [`streaming`]
//! - [`handler`]: what the bot does with each activity, in terms of [`host`]
//! - [`host`]: the only file that touches Erato internals
//!
//! Identity: a user is recognized by the Entra object ID Teams sends with
//! every activity, matched against `users.entra_object_id` (recorded on web
//! and tab logins). Their delegated Graph token comes from the Azure Bot
//! OAuth connection and stands in for oauth2-proxy's forwarded access token.

pub mod activity;
pub mod cards;
pub mod citations;
pub mod connector;
mod controls;
pub mod graph;
mod handler;
pub mod host;
pub mod inbound_auth;
pub mod render;
pub mod streaming;
pub mod user_token;

use crate::state::AppState;
use activity::Activity;
use axum::Json;
use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use connector::{Connector, CredentialState};
use erato_config::config::TeamsBotConfig;
use eyre::{Report, eyre};
use graph::GraphIdentity;
use host::Host;
use inbound_auth::{InboundAuth, Rejection};
use sea_orm::prelude::Uuid;
use serde::Serialize;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use user_token::UserTokenClient;

/// The `X-Erato-Platform` value recorded on messages sent through Teams.
pub const TEAMS_PLATFORM: &str = "teams";
/// Path of the messaging endpoint configured on the Azure Bot resource.
pub const MESSAGES_ROUTE: &str = erato_config::config::TEAMS_BOT_MESSAGES_PATH;
/// Teams caps a message at about 100 KB; card actions and file metadata stay
/// well below this.
const MAX_ACTIVITY_BYTES: usize = 256 * 1024;
const HTTP_TIMEOUT: Duration = Duration::from_secs(30);
const IDENTITY_CACHE_TTL: Duration = Duration::from_secs(10 * 60);

pub struct TeamsBotSettings {
    pub tenant_id: String,
    pub public_base_url: Option<String>,
    pub assistant_id: Option<Uuid>,
    pub context_message_count: u32,
    pub streaming: bool,
    pub security_groups_only: bool,
}

pub struct TeamsBot {
    pub settings: TeamsBotSettings,
    inbound: InboundAuth,
    connector: Connector,
    user_tokens: UserTokenClient,
    /// Graph identity and groups per Entra object ID, to spare two Graph
    /// calls on every message.
    identities: moka::future::Cache<String, (GraphIdentity, Vec<String>)>,
    /// Whether an authenticated activity from the tenant arrived since the
    /// start, shown on the setup page.
    activity_received: AtomicBool,
}

/// What the setup page needs to guide the bot setup. Served on the public
/// setup route: identifiers that also appear in the Teams package, never
/// secrets.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupInfo {
    pub bot_app_id: String,
    pub auth_app_id: Option<String>,
    pub tenant_id: String,
    pub connection_name: String,
    pub sso_resource: Option<String>,
    pub messaging_endpoint: String,
    /// Whether `messaging_endpoint` comes from configuration rather than the
    /// address the setup page was opened at.
    pub messaging_endpoint_configured: bool,
    pub status: SetupStatus,
}

/// Observed by this Erato instance since its start.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStatus {
    pub activity_received: bool,
    pub credential: CredentialState,
}

impl TeamsBot {
    /// The bot runtime, or `None` when the bot is disabled.
    pub fn from_config(config: &TeamsBotConfig) -> Result<Option<Arc<Self>>, Report> {
        if !config.enabled {
            return Ok(None);
        }
        let required = |value: &Option<String>, key: &str| {
            value
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .ok_or_else(|| eyre!("Teams bot `{key}` is required"))
        };
        let app_id = required(&config.app_id, "app_id")?;
        let tenant_id = required(&config.tenant_id, "tenant_id")?;
        let connection_name = required(&config.oauth_connection_name, "oauth_connection_name")?;
        let app_password = config
            .app_password
            .as_ref()
            .map(|password| password.expose_secret().to_string())
            .ok_or_else(|| eyre!("Teams bot `app_password` is required"))?;
        let assistant_id = config
            .assistant_id
            .as_deref()
            .map(|value| Uuid::parse_str(value.trim()))
            .transpose()?;
        let http = reqwest::Client::builder().timeout(HTTP_TIMEOUT).build()?;
        Ok(Some(Arc::new(Self {
            settings: TeamsBotSettings {
                tenant_id: tenant_id.clone(),
                public_base_url: config
                    .public_base_url
                    .as_deref()
                    .map(|url| url.trim_end_matches('/').to_string()),
                assistant_id,
                context_message_count: config.context_message_count,
                streaming: config.streaming,
                security_groups_only: config.security_groups_only,
            },
            inbound: InboundAuth::new(http.clone(), app_id.clone()),
            user_tokens: UserTokenClient::new(
                &config.token_service_url,
                connection_name,
                app_id.clone(),
            ),
            connector: Connector::new(
                http,
                connector::download_client(HTTP_TIMEOUT)?,
                app_id,
                app_password,
                tenant_id,
            ),
            identities: moka::future::Cache::builder()
                .time_to_live(IDENTITY_CACHE_TTL)
                .max_capacity(10_000)
                .build(),
            activity_received: AtomicBool::new(false),
        })))
    }

    pub fn setup_status(&self) -> SetupStatus {
        SetupStatus {
            activity_received: self.activity_received.load(Ordering::Relaxed),
            credential: self.connector.credential_state(),
        }
    }
}

impl SetupInfo {
    /// Setup values for a bot whose configuration has defaults applied, as
    /// seen from `base_url`, the address the setup page was opened at.
    pub fn new(
        config: &TeamsBotConfig,
        base_url: &str,
        status: SetupStatus,
    ) -> Result<Self, Report> {
        let required = |value: &Option<String>, key: &str| {
            value
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .ok_or_else(|| eyre!("Teams bot `{key}` is required"))
        };
        let base = url::Url::parse(base_url)?;
        let authority = match (base.host_str(), base.port()) {
            (Some(host), Some(port)) => format!("{host}:{port}"),
            (Some(host), None) => host.to_string(),
            (None, _) => return Err(eyre!("setup base URL has no host")),
        };
        let configured_endpoint = config.messaging_endpoint_url();
        Ok(Self {
            bot_app_id: required(&config.app_id, "app_id")?,
            auth_app_id: config.sso_app_id.clone(),
            tenant_id: required(&config.tenant_id, "tenant_id")?,
            connection_name: required(&config.oauth_connection_name, "oauth_connection_name")?,
            sso_resource: config.sso_resource_for_host(&authority),
            messaging_endpoint_configured: configured_endpoint.is_some(),
            messaging_endpoint: configured_endpoint.unwrap_or_else(|| {
                format!("{}{MESSAGES_ROUTE}", base.origin().ascii_serialization())
            }),
            status,
        })
    }
}

#[cfg(test)]
impl TeamsBot {
    /// A bot whose token service and Connector are local test servers.
    pub(crate) fn for_test(base: &str, streaming: bool) -> Self {
        Self {
            settings: TeamsBotSettings {
                tenant_id: "tenant".into(),
                public_base_url: None,
                assistant_id: None,
                context_message_count: 0,
                streaming,
                security_groups_only: false,
            },
            inbound: InboundAuth::with_static_keys("bot".into(), Vec::new()),
            connector: Connector::with_test_token(reqwest::Client::new()),
            user_tokens: UserTokenClient::new(base, "graph-sso".into(), "bot".into()),
            identities: moka::future::Cache::new(10),
            activity_received: AtomicBool::new(false),
        }
    }
}

/// `POST /api/integrations/ms_teams/messages`: the Azure Bot messaging endpoint.
///
/// Outside oauth2-proxy and the user middleware, and usually reachable from
/// the internet: the Connector token is verified before the body is read, the
/// activity is then bound to the token and the Teams channel, and restricted
/// to the deployment's tenant.
pub async fn messages_route(
    State(app_state): State<AppState>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    let Some(bot) = app_state.ms_teams_bot.clone() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let authorization = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok());
    let token = match bot.inbound.verify_token(authorization).await {
        Ok(token) => token,
        Err(rejection) => return reject(&rejection),
    };
    let Ok(body) = axum::body::to_bytes(body, MAX_ACTIVITY_BYTES).await else {
        return StatusCode::PAYLOAD_TOO_LARGE.into_response();
    };
    let Ok(activity) = serde_json::from_slice::<Activity>(&body) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if let Err(rejection) = token.check_activity(&activity) {
        return reject(&rejection);
    }
    if activity.tenant_id() != Some(bot.settings.tenant_id.as_str()) {
        tracing::warn!(tenant = ?activity.tenant_id(), "Rejected a Teams activity from another tenant");
        return StatusCode::FORBIDDEN.into_response();
    }
    bot.activity_received.store(true, Ordering::Relaxed);

    let host = Host::new(app_state);
    match activity.kind.as_str() {
        "message" => {
            tokio::spawn(handler::on_message(bot, host, activity));
            StatusCode::OK.into_response()
        }
        "messageUpdate" if activity.is_edit_message() => {
            tokio::spawn(handler::on_message_edit(bot, host, activity));
            StatusCode::OK.into_response()
        }
        "invoke" => {
            let (status, body) = handler::on_invoke(&bot, &host, &activity).await;
            (status, Json(body)).into_response()
        }
        "event" if activity.name.as_deref() == Some("tokens/response") => {
            tokio::spawn(handler::on_token_response(bot, host, activity));
            StatusCode::OK.into_response()
        }
        // conversationUpdate, installationUpdate, messageReaction, …
        _ => StatusCode::OK.into_response(),
    }
}

/// Log why an activity was refused (never the token) and answer as the Bot
/// Framework protocol expects.
fn reject(rejection: &Rejection) -> Response {
    match rejection {
        Rejection::Unauthenticated(error) => {
            tracing::warn!(%error, "Rejected a Teams activity with an invalid connector token");
            StatusCode::UNAUTHORIZED.into_response()
        }
        Rejection::Forbidden(error) => {
            tracing::warn!(%error, "Rejected a Teams activity that does not match its token");
            StatusCode::FORBIDDEN.into_response()
        }
    }
}

/// Called when a delivered background task result was answered: chats that
/// live in Teams get the answer pushed there. Fire and forget.
pub fn notify_task_reaction(app_state: &AppState, chat_id: Uuid, message_id: Uuid) {
    let Some(bot) = app_state.ms_teams_bot.clone() else {
        return;
    };
    let host = Host::new(app_state.clone());
    tokio::spawn(async move {
        if let Err(error) = handler::deliver_proactive(&bot, &host, chat_id, message_id).await {
            tracing::warn!(%error, %chat_id, "Could not deliver a task result to Teams");
        }
    });
}

#[cfg(test)]
mod setup_info_tests {
    use super::{CredentialState, SetupInfo, SetupStatus};
    use erato_config::config::TeamsBotConfig;

    const APP_ID: &str = "11111111-2222-3333-4444-555555555555";

    fn config() -> TeamsBotConfig {
        TeamsBotConfig {
            enabled: true,
            app_id: Some(APP_ID.into()),
            sso_app_id: Some(APP_ID.into()),
            tenant_id: Some("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee".into()),
            oauth_connection_name: Some("graph-sso".into()),
            ..TeamsBotConfig::default()
        }
    }

    fn status() -> SetupStatus {
        SetupStatus {
            activity_received: false,
            credential: CredentialState::Unknown,
        }
    }

    #[test]
    fn uses_the_setup_page_address_unless_an_endpoint_is_configured() {
        let info = SetupInfo::new(&config(), "https://erato.internal.example", status())
            .expect("setup info");
        assert_eq!(
            info.messaging_endpoint,
            "https://erato.internal.example/api/integrations/ms_teams/messages"
        );
        assert!(!info.messaging_endpoint_configured);
        assert_eq!(
            info.sso_resource.as_deref(),
            Some(format!("api://erato.internal.example/botid-{APP_ID}").as_str())
        );

        let config = TeamsBotConfig {
            messaging_endpoint: Some("https://teams-bot.example.com".into()),
            ..config()
        };
        let info = SetupInfo::new(&config, "https://erato.internal.example", status())
            .expect("setup info");
        assert_eq!(
            info.messaging_endpoint,
            "https://teams-bot.example.com/api/integrations/ms_teams/messages"
        );
        assert!(info.messaging_endpoint_configured);
        // Single sign-on stays tied to the host users download the package from.
        assert_eq!(
            info.sso_resource.as_deref(),
            Some(format!("api://erato.internal.example/botid-{APP_ID}").as_str())
        );
    }
}
