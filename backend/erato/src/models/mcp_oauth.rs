use crate::db::entity::mcp_server_oauth_authorization_states;
use crate::db::entity::mcp_server_oauth_clients;
use crate::db::entity::mcp_server_oauth_credentials;
use crate::db::entity::prelude::*;
use eyre::Report;
use sea_orm::prelude::Uuid;
use sea_orm::{ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set};

pub async fn get_oauth_client(
    conn: &DatabaseConnection,
    mcp_server_id: &str,
) -> Result<Option<mcp_server_oauth_clients::Model>, Report> {
    Ok(McpServerOauthClients::find_by_id(mcp_server_id.to_string())
        .one(conn)
        .await?)
}

pub async fn upsert_oauth_client(
    conn: &DatabaseConnection,
    mcp_server_id: &str,
    client_id: &str,
    client_secret_encrypted: Option<String>,
    redirect_uri: &str,
) -> Result<mcp_server_oauth_clients::Model, Report> {
    if let Some(existing) = get_oauth_client(conn, mcp_server_id).await? {
        let mut model: mcp_server_oauth_clients::ActiveModel = existing.into();
        model.client_id = Set(client_id.to_string());
        model.client_secret_encrypted = Set(client_secret_encrypted);
        model.redirect_uri = Set(redirect_uri.to_string());
        Ok(model.update(conn).await?)
    } else {
        Ok(
            McpServerOauthClients::insert(mcp_server_oauth_clients::ActiveModel {
                mcp_server_id: Set(mcp_server_id.to_string()),
                client_id: Set(client_id.to_string()),
                client_secret_encrypted: Set(client_secret_encrypted),
                redirect_uri: Set(redirect_uri.to_string()),
                registration_metadata: Set(None),
                ..Default::default()
            })
            .exec_with_returning(conn)
            .await?,
        )
    }
}

pub async fn get_oauth_credentials(
    conn: &DatabaseConnection,
    user_id: Uuid,
    mcp_server_id: &str,
) -> Result<Option<mcp_server_oauth_credentials::Model>, Report> {
    Ok(
        McpServerOauthCredentials::find_by_id((user_id, mcp_server_id.to_string()))
            .one(conn)
            .await?,
    )
}

pub async fn upsert_oauth_credentials(
    conn: &DatabaseConnection,
    user_id: Uuid,
    mcp_server_id: &str,
    credentials_encrypted: String,
) -> Result<mcp_server_oauth_credentials::Model, Report> {
    if let Some(existing) = get_oauth_credentials(conn, user_id, mcp_server_id).await? {
        let mut model: mcp_server_oauth_credentials::ActiveModel = existing.into();
        model.credentials_encrypted = Set(credentials_encrypted);
        Ok(model.update(conn).await?)
    } else {
        Ok(
            McpServerOauthCredentials::insert(mcp_server_oauth_credentials::ActiveModel {
                user_id: Set(user_id),
                mcp_server_id: Set(mcp_server_id.to_string()),
                credentials_encrypted: Set(credentials_encrypted),
                ..Default::default()
            })
            .exec_with_returning(conn)
            .await?,
        )
    }
}

pub async fn delete_oauth_credentials(
    conn: &DatabaseConnection,
    user_id: Uuid,
    mcp_server_id: &str,
) -> Result<(), Report> {
    McpServerOauthCredentials::delete_by_id((user_id, mcp_server_id.to_string()))
        .exec(conn)
        .await?;
    Ok(())
}

pub async fn touch_oauth_credentials(
    conn: &DatabaseConnection,
    user_id: Uuid,
    mcp_server_id: &str,
) -> Result<(), Report> {
    if let Some(existing) = get_oauth_credentials(conn, user_id, mcp_server_id).await? {
        let mut model: mcp_server_oauth_credentials::ActiveModel = existing.into();
        model.last_used_at = Set(Some(chrono::Utc::now().fixed_offset()));
        model.update(conn).await?;
    }
    Ok(())
}

pub async fn save_oauth_authorization_state(
    conn: &DatabaseConnection,
    user_id: Uuid,
    mcp_server_id: &str,
    csrf_token: &str,
    state_encrypted: String,
) -> Result<mcp_server_oauth_authorization_states::Model, Report> {
    if let Some(existing) =
        get_oauth_authorization_state(conn, user_id, mcp_server_id, csrf_token).await?
    {
        let mut model: mcp_server_oauth_authorization_states::ActiveModel = existing.into();
        model.state_encrypted = Set(state_encrypted);
        Ok(model.update(conn).await?)
    } else {
        Ok(McpServerOauthAuthorizationStates::insert(
            mcp_server_oauth_authorization_states::ActiveModel {
                user_id: Set(user_id),
                mcp_server_id: Set(mcp_server_id.to_string()),
                csrf_token: Set(csrf_token.to_string()),
                state_encrypted: Set(state_encrypted),
                ..Default::default()
            },
        )
        .exec_with_returning(conn)
        .await?)
    }
}

pub async fn get_oauth_authorization_state(
    conn: &DatabaseConnection,
    user_id: Uuid,
    mcp_server_id: &str,
    csrf_token: &str,
) -> Result<Option<mcp_server_oauth_authorization_states::Model>, Report> {
    Ok(McpServerOauthAuthorizationStates::find()
        .filter(mcp_server_oauth_authorization_states::Column::UserId.eq(user_id))
        .filter(
            mcp_server_oauth_authorization_states::Column::McpServerId
                .eq(mcp_server_id.to_string()),
        )
        .filter(mcp_server_oauth_authorization_states::Column::CsrfToken.eq(csrf_token.to_string()))
        .one(conn)
        .await?)
}

pub async fn delete_oauth_authorization_state(
    conn: &DatabaseConnection,
    user_id: Uuid,
    mcp_server_id: &str,
    csrf_token: &str,
) -> Result<(), Report> {
    McpServerOauthAuthorizationStates::delete_many()
        .filter(mcp_server_oauth_authorization_states::Column::UserId.eq(user_id))
        .filter(
            mcp_server_oauth_authorization_states::Column::McpServerId
                .eq(mcp_server_id.to_string()),
        )
        .filter(mcp_server_oauth_authorization_states::Column::CsrfToken.eq(csrf_token.to_string()))
        .exec(conn)
        .await?;
    Ok(())
}

pub async fn clear_oauth_authorization_states_for_server(
    conn: &DatabaseConnection,
    user_id: Uuid,
    mcp_server_id: &str,
) -> Result<(), Report> {
    McpServerOauthAuthorizationStates::delete_many()
        .filter(mcp_server_oauth_authorization_states::Column::UserId.eq(user_id))
        .filter(
            mcp_server_oauth_authorization_states::Column::McpServerId
                .eq(mcp_server_id.to_string()),
        )
        .exec(conn)
        .await?;
    Ok(())
}

pub async fn clear_oauth_state_for_server(
    conn: &DatabaseConnection,
    user_id: Uuid,
    mcp_server_id: &str,
) -> Result<(), Report> {
    delete_oauth_credentials(conn, user_id, mcp_server_id).await?;
    clear_oauth_authorization_states_for_server(conn, user_id, mcp_server_id).await?;
    Ok(())
}
