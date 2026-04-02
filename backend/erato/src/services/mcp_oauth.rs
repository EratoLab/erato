use crate::config::{McpServerConfig, McpServerOauth2AuthenticationConfig};
use crate::models::mcp_oauth;
use crate::state::AppState;
use eyre::{Report, eyre};
use rmcp::transport::auth::OAuthClientConfig;
use rmcp::transport::{
    AuthError, AuthorizationManager, CredentialStore, StateStore, StoredAuthorizationState,
    StoredCredentials,
};
use sea_orm::prelude::Uuid;
use serde::{Deserialize, Serialize};

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
        manager.configure_client(client_config)?;
    } else {
        let registered_client = manager
            .register_client(
                oauth2
                    .client_name
                    .as_deref()
                    .unwrap_or("Erato MCP OAuth Client"),
                redirect_uri,
                &scope_refs,
            )
            .await?;
        persist_client_config(app_state, mcp_server_id, &registered_client).await?;
    }

    mcp_oauth::clear_oauth_authorization_states_for_server(&app_state.db, user_id, mcp_server_id)
        .await
        .map_err(report_to_auth_error)?;
    manager.get_authorization_url(&scope_refs).await
}

pub async fn complete_oauth_authorization(
    app_state: &AppState,
    user_id: Uuid,
    mcp_server_id: &str,
    config: &McpServerConfig,
    oauth2: &McpServerOauth2AuthenticationConfig,
    redirect_uri: &str,
    code: &str,
    csrf_token: &str,
) -> Result<(), AuthError> {
    let manager = configured_authorization_manager(
        app_state,
        user_id,
        mcp_server_id,
        config,
        oauth2,
        redirect_uri,
    )
    .await?;

    manager.exchange_code_for_token(code, csrf_token).await?;
    mcp_oauth::touch_oauth_credentials(&app_state.db, user_id, mcp_server_id)
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
    manager.set_metadata(metadata);
    let client_config = load_or_build_client_config(app_state, mcp_server_id, oauth2, redirect_uri)
        .await?
        .ok_or(AuthError::AuthorizationRequired)?;
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
        let mut config = OAuthClientConfig::new(client_id.clone(), redirect_uri.to_string())
            .with_scopes(oauth2.scopes.clone());
        if let Some(client_secret) = &oauth2.client_secret {
            config = config.with_client_secret(client_secret.clone());
        }
        return Ok(Some(config));
    }

    let Some(stored_client) = mcp_oauth::get_oauth_client(&app_state.db, mcp_server_id)
        .await
        .map_err(report_to_auth_error)?
    else {
        return Ok(None);
    };

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
