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
pub mod connector;
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
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use connector::Connector;
use erato_config::config::TeamsBotConfig;
use eyre::{Report, eyre};
use graph::GraphIdentity;
use host::Host;
use inbound_auth::InboundAuth;
use sea_orm::prelude::Uuid;
use std::sync::Arc;
use std::time::Duration;
use user_token::UserTokenClient;

/// The `X-Erato-Platform` value recorded on messages sent through Teams.
pub const TEAMS_PLATFORM: &str = "teams";
/// Path of the messaging endpoint configured on the Azure Bot resource.
pub const MESSAGES_ROUTE: &str = "/api/integrations/ms_teams/messages";
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
            connector: Connector::new(http, app_id, app_password, tenant_id),
            identities: moka::future::Cache::builder()
                .time_to_live(IDENTITY_CACHE_TTL)
                .max_capacity(10_000)
                .build(),
        })))
    }
}

/// `POST /api/integrations/ms_teams/messages`: the Azure Bot messaging endpoint.
///
/// Outside oauth2-proxy and the user middleware; authenticated by the Bot
/// Connector's signed JWT and restricted to the deployment's tenant.
pub async fn messages_route(
    State(app_state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let Some(bot) = app_state.ms_teams_bot.clone() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(activity) = serde_json::from_slice::<Activity>(&body) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let authorization = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok());
    let service_url = activity.service_url.as_deref().unwrap_or_default();
    if let Err(error) = bot.inbound.verify(authorization, service_url).await {
        tracing::warn!(%error, "Rejected a Teams activity with an invalid connector token");
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if activity.tenant_id() != Some(bot.settings.tenant_id.as_str()) {
        tracing::warn!(tenant = ?activity.tenant_id(), "Rejected a Teams activity from another tenant");
        return StatusCode::FORBIDDEN.into_response();
    }

    let host = Host::new(app_state);
    match activity.kind.as_str() {
        "message" => {
            tokio::spawn(handler::on_message(bot, host, activity));
            StatusCode::OK.into_response()
        }
        "invoke" => {
            let (status, body) = handler::on_invoke(&bot, &host, &activity).await;
            (status, Json(body)).into_response()
        }
        // conversationUpdate, installationUpdate, messageReaction, …
        _ => StatusCode::OK.into_response(),
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
