use crate::config::{McpServerConfig, McpServerOauth2AuthenticationConfig};
use crate::models::mcp_oauth;
use crate::services::mcp_transports::build_oauth_supporting_reqwest_client;
use crate::state::AppState;
use eyre::{Report, eyre};
use reqwest::Url;
use rmcp::transport::auth::OAuthClientConfig;
use rmcp::transport::{
    AuthError, AuthorizationManager, CredentialStore, StateStore, StoredAuthorizationState,
    StoredCredentials,
};
use sea_orm::prelude::Uuid;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;
use tracing::{Level, trace};
use url::form_urlencoded::Serializer;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedOauthCredentialsV1 {
    stored_credentials: StoredCredentials,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedOauthAuthorizationStateV1 {
    stored_state: StoredAuthorizationState,
}

#[derive(Debug, Clone)]
struct DatabaseCredentialStore {
    app_state: AppState,
    user_id: Uuid,
    mcp_server_id: String,
}

#[derive(Debug, Clone)]
struct DatabaseStateStore {
    app_state: AppState,
    user_id: Uuid,
    mcp_server_id: String,
}

#[async_trait::async_trait]
impl CredentialStore for DatabaseCredentialStore {
    async fn load(&self) -> Result<Option<StoredCredentials>, AuthError> {
        let Some(model) =
            mcp_oauth::get_oauth_credentials(&self.app_state.db, self.user_id, &self.mcp_server_id)
                .await
                .map_err(report_to_auth_error)?
        else {
            return Ok(None);
        };

        let decrypted = self
            .app_state
            .decrypt(&model.credentials_encrypted)
            .map_err(report_to_auth_error)?;
        let persisted: PersistedOauthCredentialsV1 =
            serde_json::from_str(&decrypted).map_err(other_auth_error)?;
        Ok(Some(persisted.stored_credentials))
    }

    async fn save(&self, credentials: StoredCredentials) -> Result<(), AuthError> {
        let payload = serde_json::to_string(&PersistedOauthCredentialsV1 {
            stored_credentials: credentials,
        })
        .map_err(other_auth_error)?;
        let encrypted = self
            .app_state
            .encrypt(&payload)
            .map_err(report_to_auth_error)?;
        mcp_oauth::upsert_oauth_credentials(
            &self.app_state.db,
            self.user_id,
            &self.mcp_server_id,
            encrypted,
        )
        .await
        .map_err(report_to_auth_error)?;
        Ok(())
    }

    async fn clear(&self) -> Result<(), AuthError> {
        mcp_oauth::delete_oauth_credentials(&self.app_state.db, self.user_id, &self.mcp_server_id)
            .await
            .map_err(report_to_auth_error)?;
        Ok(())
    }
}

#[async_trait::async_trait]
impl StateStore for DatabaseStateStore {
    async fn save(
        &self,
        csrf_token: &str,
        state: StoredAuthorizationState,
    ) -> Result<(), AuthError> {
        let payload = serde_json::to_string(&PersistedOauthAuthorizationStateV1 {
            stored_state: state,
        })
        .map_err(other_auth_error)?;
        let encrypted = self
            .app_state
            .encrypt(&payload)
            .map_err(report_to_auth_error)?;
        mcp_oauth::save_oauth_authorization_state(
            &self.app_state.db,
            self.user_id,
            &self.mcp_server_id,
            csrf_token,
            encrypted,
        )
        .await
        .map_err(report_to_auth_error)?;
        Ok(())
    }

    async fn load(&self, csrf_token: &str) -> Result<Option<StoredAuthorizationState>, AuthError> {
        let Some(model) = mcp_oauth::get_oauth_authorization_state(
            &self.app_state.db,
            self.user_id,
            &self.mcp_server_id,
            csrf_token,
        )
        .await
        .map_err(report_to_auth_error)?
        else {
            return Ok(None);
        };

        let decrypted = self
            .app_state
            .decrypt(&model.state_encrypted)
            .map_err(report_to_auth_error)?;
        let persisted: PersistedOauthAuthorizationStateV1 =
            serde_json::from_str(&decrypted).map_err(other_auth_error)?;
        Ok(Some(persisted.stored_state))
    }

    async fn delete(&self, csrf_token: &str) -> Result<(), AuthError> {
        mcp_oauth::delete_oauth_authorization_state(
            &self.app_state.db,
            self.user_id,
            &self.mcp_server_id,
            csrf_token,
        )
        .await
        .map_err(report_to_auth_error)?;
        Ok(())
    }
}

pub async fn resolve_oauth_access_token(
    app_state: &AppState,
    user_id: Uuid,
    mcp_server_id: &str,
    config: &McpServerConfig,
    oauth2: &McpServerOauth2AuthenticationConfig,
) -> Result<String, AuthError> {
    let manager = configured_authorization_manager(
        app_state,
        user_id,
        mcp_server_id,
        config,
        oauth2,
        &config.url,
    )
    .await?;
    let access_token = manager.get_access_token().await?;
    mcp_oauth::touch_oauth_credentials(&app_state.db, user_id, mcp_server_id)
        .await
        .map_err(report_to_auth_error)?;
    Ok(access_token)
}

pub async fn start_oauth_authorization(
    app_state: &AppState,
    user_id: Uuid,
    mcp_server_id: &str,
    config: &McpServerConfig,
    oauth2: &McpServerOauth2AuthenticationConfig,
    redirect_uri: &str,
) -> Result<String, AuthError> {
    let mut manager = authorization_manager(app_state, user_id, mcp_server_id, config).await?;
    let metadata = manager.discover_metadata().await?;
    trace!(
        mcp_server_id,
        user_id = %user_id,
        mcp_server_url = %config.url,
        oauth_metadata = ?metadata,
        "Discovered MCP OAuth server metadata before authorization start"
    );
    manager.set_metadata(metadata);

    let selected_scopes = if oauth2.scopes.is_empty() {
        manager.select_scopes(None, &[])
    } else {
        manager.select_scopes(
            None,
            &oauth2.scopes.iter().map(String::as_str).collect::<Vec<_>>(),
        )
    };
    let scope_refs = selected_scopes
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();

    if let Some(client_config) =
        load_or_build_client_config(app_state, mcp_server_id, oauth2, redirect_uri).await?
    {
        trace!(
            mcp_server_id,
            user_id = %user_id,
            redirect_uri,
            client_id = %client_config.client_id,
            has_client_secret = client_config.client_secret.is_some(),
            configured_scopes = ?client_config.scopes,
            "Using existing MCP OAuth client configuration"
        );
        manager.configure_client(client_config)?;
    } else {
        let requested_client_name = oauth2
            .client_name
            .as_deref()
            .unwrap_or("Erato MCP OAuth Client");
        trace!(
            mcp_server_id,
            user_id = %user_id,
            redirect_uri,
            requested_client_name,
            requested_scopes = ?scope_refs,
            "No MCP OAuth client configuration available, attempting dynamic client registration"
        );
        let registered_client = manager
            .register_client(requested_client_name, redirect_uri, &scope_refs)
            .await?;
        trace!(
            mcp_server_id,
            user_id = %user_id,
            redirect_uri = %registered_client.redirect_uri,
            client_id = %registered_client.client_id,
            has_client_secret = registered_client.client_secret.is_some(),
            registered_scopes = ?registered_client.scopes,
            "Dynamic client registration completed for MCP OAuth"
        );
        persist_client_config(app_state, mcp_server_id, &registered_client).await?;
    }

    mcp_oauth::clear_oauth_authorization_states_for_server(&app_state.db, user_id, mcp_server_id)
        .await
        .map_err(report_to_auth_error)?;
    manager.get_authorization_url(&scope_refs).await
}

pub struct CompleteOauthAuthorizationParams<'a> {
    pub app_state: &'a AppState,
    pub user_id: Uuid,
    pub mcp_server_id: &'a str,
    pub config: &'a McpServerConfig,
    pub oauth2: &'a McpServerOauth2AuthenticationConfig,
    pub redirect_uri: &'a str,
    pub code: &'a str,
    pub csrf_token: &'a str,
}

pub async fn complete_oauth_authorization(
    params: CompleteOauthAuthorizationParams<'_>,
) -> Result<(), AuthError> {
    let manager = configured_authorization_manager(
        params.app_state,
        params.user_id,
        params.mcp_server_id,
        params.config,
        params.oauth2,
        params.redirect_uri,
    )
    .await?;

    manager
        .exchange_code_for_token(params.code, params.csrf_token)
        .await?;
    let access_token = manager.get_access_token().await?;
    debug_log_token_metadata(
        params.app_state,
        params.user_id,
        params.mcp_server_id,
        params.config,
        params.oauth2,
        params.redirect_uri,
        &access_token,
    )
    .await;
    mcp_oauth::touch_oauth_credentials(&params.app_state.db, params.user_id, params.mcp_server_id)
        .await
        .map_err(report_to_auth_error)?;

    Ok(())
}

pub async fn disconnect_oauth_authorization(
    app_state: &AppState,
    user_id: Uuid,
    mcp_server_id: &str,
) -> Result<(), AuthError> {
    mcp_oauth::clear_oauth_state_for_server(&app_state.db, user_id, mcp_server_id)
        .await
        .map_err(report_to_auth_error)?;
    Ok(())
}

async fn configured_authorization_manager(
    app_state: &AppState,
    user_id: Uuid,
    mcp_server_id: &str,
    config: &McpServerConfig,
    oauth2: &McpServerOauth2AuthenticationConfig,
    redirect_uri: &str,
) -> Result<AuthorizationManager, AuthError> {
    let mut manager = authorization_manager(app_state, user_id, mcp_server_id, config).await?;
    let metadata = manager.discover_metadata().await?;
    trace!(
        mcp_server_id,
        user_id = %user_id,
        mcp_server_url = %config.url,
        oauth_metadata = ?metadata,
        "Discovered MCP OAuth server metadata while configuring authorization manager"
    );
    manager.set_metadata(metadata);
    let client_config = load_or_build_client_config(app_state, mcp_server_id, oauth2, redirect_uri)
        .await?
        .ok_or(AuthError::AuthorizationRequired)?;
    trace!(
        mcp_server_id,
        user_id = %user_id,
        redirect_uri,
        client_id = %client_config.client_id,
        has_client_secret = client_config.client_secret.is_some(),
        configured_scopes = ?client_config.scopes,
        "Loaded MCP OAuth client configuration for configured authorization manager"
    );
    manager.configure_client(client_config)?;
    Ok(manager)
}

async fn authorization_manager(
    app_state: &AppState,
    user_id: Uuid,
    mcp_server_id: &str,
    config: &McpServerConfig,
) -> Result<AuthorizationManager, AuthError> {
    let mut manager = AuthorizationManager::new(&config.url).await?;
    manager.with_client(
        crate::services::mcp_transports::build_oauth_supporting_reqwest_client(config)
            .map_err(report_to_auth_error)?,
    )?;
    manager.set_credential_store(DatabaseCredentialStore {
        app_state: app_state.clone(),
        user_id,
        mcp_server_id: mcp_server_id.to_string(),
    });
    manager.set_state_store(DatabaseStateStore {
        app_state: app_state.clone(),
        user_id,
        mcp_server_id: mcp_server_id.to_string(),
    });
    Ok(manager)
}

async fn load_or_build_client_config(
    app_state: &AppState,
    mcp_server_id: &str,
    oauth2: &McpServerOauth2AuthenticationConfig,
    redirect_uri: &str,
) -> Result<Option<OAuthClientConfig>, AuthError> {
    if let Some(client_id) = &oauth2.client_id {
        trace!(
            mcp_server_id,
            redirect_uri,
            client_id,
            has_client_secret = oauth2.client_secret.is_some(),
            configured_scopes = ?oauth2.scopes,
            "Using statically configured MCP OAuth client from config"
        );
        let mut config = OAuthClientConfig::new(client_id.clone(), redirect_uri.to_string())
            .with_scopes(oauth2.scopes.clone());
        if let Some(client_secret) = &oauth2.client_secret {
            config = config.with_client_secret(client_secret.expose_secret().to_string());
        }
        return Ok(Some(config));
    }

    let Some(stored_client) = mcp_oauth::get_oauth_client(&app_state.db, mcp_server_id)
        .await
        .map_err(report_to_auth_error)?
    else {
        trace!(
            mcp_server_id,
            redirect_uri,
            configured_scopes = ?oauth2.scopes,
            "No stored MCP OAuth client configuration found"
        );
        return Ok(None);
    };

    trace!(
        mcp_server_id,
        redirect_uri = %stored_client.redirect_uri,
        client_id = %stored_client.client_id,
        has_client_secret = stored_client.client_secret_encrypted.is_some(),
        configured_scopes = ?oauth2.scopes,
        "Loaded stored MCP OAuth client configuration from database"
    );

    let mut config = OAuthClientConfig::new(stored_client.client_id, stored_client.redirect_uri)
        .with_scopes(oauth2.scopes.clone());
    if let Some(client_secret_encrypted) = stored_client.client_secret_encrypted {
        let client_secret = app_state
            .decrypt(&client_secret_encrypted)
            .map_err(report_to_auth_error)?;
        config = config.with_client_secret(client_secret);
    }

    Ok(Some(config))
}

async fn persist_client_config(
    app_state: &AppState,
    mcp_server_id: &str,
    client_config: &OAuthClientConfig,
) -> Result<(), AuthError> {
    trace!(
        mcp_server_id,
        redirect_uri = %client_config.redirect_uri,
        client_id = %client_config.client_id,
        has_client_secret = client_config.client_secret.is_some(),
        configured_scopes = ?client_config.scopes,
        "Persisting MCP OAuth client configuration"
    );
    let client_secret_encrypted = client_config
        .client_secret
        .as_ref()
        .map(|secret| app_state.encrypt(secret))
        .transpose()
        .map_err(report_to_auth_error)?;
    mcp_oauth::upsert_oauth_client(
        &app_state.db,
        mcp_server_id,
        &client_config.client_id,
        client_secret_encrypted,
        &client_config.redirect_uri,
    )
    .await
    .map_err(report_to_auth_error)?;
    Ok(())
}

fn report_to_auth_error(error: Report) -> AuthError {
    AuthError::InternalError(error.to_string())
}

fn other_auth_error(error: impl std::error::Error) -> AuthError {
    AuthError::InternalError(error.to_string())
}

pub fn map_auth_error(error: AuthError) -> Report {
    eyre!(error.to_string())
}

async fn debug_log_token_metadata(
    app_state: &AppState,
    user_id: Uuid,
    mcp_server_id: &str,
    config: &McpServerConfig,
    oauth2: &McpServerOauth2AuthenticationConfig,
    redirect_uri: &str,
    access_token: &str,
) {
    if !tracing::enabled!(Level::TRACE) {
        return;
    }

    let client = match build_oauth_supporting_reqwest_client(config) {
        Ok(client) => client,
        Err(error) => {
            trace!(
                mcp_server_id,
                user_id = %user_id,
                error = %error,
                "Failed to build HTTP client for OAuth token metadata debug logging"
            );
            return;
        }
    };

    let client_config =
        match load_or_build_client_config(app_state, mcp_server_id, oauth2, redirect_uri).await {
            Ok(client_config) => client_config,
            Err(error) => {
                trace!(
                    mcp_server_id,
                    user_id = %user_id,
                    error = %error,
                    "Failed to resolve OAuth client config for token metadata debug logging"
                );
                return;
            }
        };

    let base_url = match Url::parse(&config.url) {
        Ok(url) => url,
        Err(error) => {
            trace!(
                mcp_server_id,
                user_id = %user_id,
                mcp_server_url = %config.url,
                error = %error,
                "Failed to parse MCP server URL for OAuth token metadata debug logging"
            );
            return;
        }
    };

    let mut userinfo_endpoints = BTreeSet::new();
    let mut introspection_endpoints = BTreeSet::new();

    for discovery_url in debug_discovery_urls(&base_url) {
        let response = match client.get(discovery_url.clone()).send().await {
            Ok(response) => response,
            Err(error) => {
                trace!(
                    mcp_server_id,
                    user_id = %user_id,
                    discovery_url = %discovery_url,
                    error = %error,
                    "Failed to fetch OAuth discovery document for token metadata debug logging"
                );
                continue;
            }
        };

        let status = response.status();
        let body = match response.text().await {
            Ok(body) => body,
            Err(error) => {
                trace!(
                    mcp_server_id,
                    user_id = %user_id,
                    discovery_url = %discovery_url,
                    status = %status,
                    error = %error,
                    "Failed to read OAuth discovery document response body"
                );
                continue;
            }
        };

        trace!(
            mcp_server_id,
            user_id = %user_id,
            discovery_url = %discovery_url,
            status = %status,
            body = %body,
            "Fetched OAuth well-known discovery document for token metadata debug logging"
        );

        let json: Value = match serde_json::from_str(&body) {
            Ok(json) => json,
            Err(error) => {
                trace!(
                    mcp_server_id,
                    user_id = %user_id,
                    discovery_url = %discovery_url,
                    error = %error,
                    "Failed to parse OAuth discovery document JSON for token metadata debug logging"
                );
                continue;
            }
        };

        if let Some(userinfo_endpoint) = json.get("userinfo_endpoint").and_then(Value::as_str) {
            userinfo_endpoints.insert(userinfo_endpoint.to_string());
        }
        if let Some(introspection_endpoint) =
            json.get("introspection_endpoint").and_then(Value::as_str)
        {
            introspection_endpoints.insert(introspection_endpoint.to_string());
        }
    }

    for userinfo_endpoint in userinfo_endpoints {
        let response = match client
            .get(&userinfo_endpoint)
            .bearer_auth(access_token)
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                trace!(
                    mcp_server_id,
                    user_id = %user_id,
                    userinfo_endpoint,
                    error = %error,
                    "Failed to call OAuth userinfo endpoint for token metadata debug logging"
                );
                continue;
            }
        };

        let status = response.status();
        let body = match response.text().await {
            Ok(body) => body,
            Err(error) => {
                trace!(
                    mcp_server_id,
                    user_id = %user_id,
                    userinfo_endpoint,
                    status = %status,
                    error = %error,
                    "Failed to read OAuth userinfo response body"
                );
                continue;
            }
        };

        trace!(
            mcp_server_id,
            user_id = %user_id,
            userinfo_endpoint,
            status = %status,
            body = %body,
            "Fetched OAuth userinfo response for token metadata debug logging"
        );
    }

    for introspection_endpoint in introspection_endpoints {
        let request_body = {
            let mut serializer = Serializer::new(String::new());
            serializer.append_pair("token", access_token);
            if let Some(client_config) = client_config.as_ref()
                && client_config.client_secret.is_none()
            {
                serializer.append_pair("client_id", &client_config.client_id);
            }
            serializer.finish()
        };

        let mut request = client
            .post(&introspection_endpoint)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(request_body);
        if let Some(client_config) = client_config.as_ref()
            && let Some(client_secret) = client_config.client_secret.as_ref()
        {
            request = request.basic_auth(&client_config.client_id, Some(client_secret));
        }

        let response = match request.send().await {
            Ok(response) => response,
            Err(error) => {
                trace!(
                    mcp_server_id,
                    user_id = %user_id,
                    introspection_endpoint,
                    error = %error,
                    "Failed to call OAuth introspection endpoint for token metadata debug logging"
                );
                continue;
            }
        };

        let status = response.status();
        let body = match response.text().await {
            Ok(body) => body,
            Err(error) => {
                trace!(
                    mcp_server_id,
                    user_id = %user_id,
                    introspection_endpoint,
                    status = %status,
                    error = %error,
                    "Failed to read OAuth introspection response body"
                );
                continue;
            }
        };

        trace!(
            mcp_server_id,
            user_id = %user_id,
            introspection_endpoint,
            status = %status,
            body = %body,
            "Fetched OAuth introspection response for token metadata debug logging"
        );
    }
}

fn debug_discovery_urls(base_url: &Url) -> Vec<Url> {
    let path = base_url.path();
    let trimmed = path.trim_start_matches('/').trim_end_matches('/');
    let mut candidates = Vec::new();

    let mut push_candidate = |discovery_path: String| {
        let mut discovery_url = base_url.clone();
        discovery_url.set_query(None);
        discovery_url.set_fragment(None);
        discovery_url.set_path(&discovery_path);
        if !candidates.contains(&discovery_url) {
            candidates.push(discovery_url);
        }
    };

    if trimmed.is_empty() {
        push_candidate("/.well-known/oauth-authorization-server".to_string());
        push_candidate("/.well-known/openid-configuration".to_string());
    } else {
        push_candidate(format!("/.well-known/oauth-authorization-server/{trimmed}"));
        push_candidate(format!("/.well-known/openid-configuration/{trimmed}"));
        push_candidate(format!("/{trimmed}/.well-known/openid-configuration"));
        push_candidate("/.well-known/oauth-authorization-server".to_string());
        push_candidate("/.well-known/openid-configuration".to_string());
    }

    candidates
}
