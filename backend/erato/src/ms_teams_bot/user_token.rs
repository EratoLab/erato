//! The Bot Framework token service: the user's delegated Microsoft Graph token
//! from the configured OAuth connection, Teams SSO token exchange, and the
//! sign-in card for users who have not consented yet.

use super::activity::Activity;
use super::connector::Connector;
use base64::Engine as _;
use eyre::{Report, eyre};
use serde::Deserialize;
use serde_json::{Value, json};

const TEAMS_CHANNEL: &str = "msteams";

#[derive(Debug, Clone, Deserialize)]
struct TokenResponse {
    #[serde(default)]
    token: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignInResource {
    pub sign_in_link: String,
    #[serde(default)]
    pub token_exchange_resource: Option<Value>,
}

/// Binds a pending request to the authenticated callback's bot, user and chat.
#[derive(Debug, Clone)]
pub struct SignInScope {
    pub bot_app_id: String,
    pub tenant_id: String,
    pub connection_name: String,
    pub conversation_id: String,
    pub ms_teams_user_id: String,
    pub entra_object_id: String,
}

pub struct UserTokenClient {
    base_url: String,
    connection_name: String,
    app_id: String,
}

impl UserTokenClient {
    pub fn new(base_url: &str, connection_name: String, app_id: String) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            connection_name,
            app_id,
        }
    }

    pub fn connection_name(&self) -> &str {
        &self.connection_name
    }

    pub fn sign_in_scope(&self, activity: &Activity) -> Result<SignInScope, Report> {
        let required = |value: Option<&str>| {
            value
                .filter(|s| !s.is_empty())
                .map(ToOwned::to_owned)
                .ok_or_else(|| {
                    eyre!("sign-in activity is missing its tenant, conversation or user")
                })
        };
        Ok(SignInScope {
            bot_app_id: self.app_id.clone(),
            connection_name: self.connection_name.clone(),
            tenant_id: required(activity.tenant_id())?,
            conversation_id: required(activity.conversation_id())?,
            ms_teams_user_id: required(activity.from.as_ref().map(|from| from.id.as_str()))?,
            entra_object_id: required(activity.from_aad_object_id())?,
        })
    }

    /// The cached Graph token of a Teams user, if they have signed in.
    /// `code` is the magic code or `verifyState` value of a manual sign-in.
    pub async fn get_token(
        &self,
        connector: &Connector,
        ms_teams_user_id: &str,
        code: Option<&str>,
    ) -> Result<Option<String>, Report> {
        let mut url = self.url("/api/usertoken/GetToken")?;
        {
            let mut query = url.query_pairs_mut();
            query
                .append_pair("userId", ms_teams_user_id)
                .append_pair("connectionName", &self.connection_name)
                .append_pair("channelId", TEAMS_CHANNEL);
            if let Some(code) = code {
                query.append_pair("code", code);
            }
        }
        let response = connector
            .http()
            .get(url)
            .bearer_auth(connector.app_token().await?)
            .send()
            .await?;
        match response.status() {
            status if status.is_success() => {
                let token: TokenResponse = serde_json::from_slice(&response.bytes().await?)?;
                Ok(token.token.filter(|token| !token.is_empty()))
            }
            reqwest::StatusCode::NOT_FOUND => Ok(None),
            status => Err(eyre!("token service GetToken failed with {status}")),
        }
    }

    /// Exchange the Teams SSO token for the connection's Graph token.
    pub async fn exchange(
        &self,
        connector: &Connector,
        ms_teams_user_id: &str,
        sso_token: &str,
    ) -> Result<Option<String>, Report> {
        let mut url = self.url("/api/usertoken/exchange")?;
        url.query_pairs_mut()
            .append_pair("userId", ms_teams_user_id)
            .append_pair("connectionName", &self.connection_name)
            .append_pair("channelId", TEAMS_CHANNEL);
        let response = connector
            .http()
            .post(url)
            .bearer_auth(connector.app_token().await?)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(serde_json::to_vec(&json!({"token": sso_token}))?)
            .send()
            .await?;
        if !response.status().is_success() {
            // Consent is missing or the token is not exchangeable; the caller
            // answers the invoke with 412 so Teams falls back to the sign-in button.
            return Ok(None);
        }
        let token: TokenResponse = serde_json::from_slice(&response.bytes().await?)?;
        Ok(token.token.filter(|token| !token.is_empty()))
    }

    /// The sign-in link (and SSO exchange resource) for an OAuth card.
    pub async fn sign_in_resource(
        &self,
        connector: &Connector,
        activity: &Activity,
    ) -> Result<SignInResource, Report> {
        let state = json!({
            "ConnectionName": self.connection_name,
            "Conversation": {
                "activityId": activity.id,
                "user": activity.from,
                "bot": activity.recipient,
                "conversation": activity.conversation,
                "channelId": TEAMS_CHANNEL,
                "serviceUrl": activity.service_url,
                "locale": activity.locale,
            },
            "RelatesTo": null,
            "MsAppId": self.app_id,
        });
        let encoded = base64::engine::general_purpose::STANDARD.encode(serde_json::to_vec(&state)?);
        let mut url = self.url("/api/botsignin/GetSignInResource")?;
        url.query_pairs_mut().append_pair("state", &encoded);
        let response = connector
            .http()
            .get(url)
            .bearer_auth(connector.app_token().await?)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(eyre!(
                "token service GetSignInResource failed with {}",
                response.status()
            ));
        }
        Ok(serde_json::from_slice(&response.bytes().await?)?)
    }

    fn url(&self, path: &str) -> Result<url::Url, Report> {
        Ok(url::Url::parse(&format!("{}{path}", self.base_url))?)
    }
}

/// The OAuth card Teams renders as a sign-in button, or completes silently
/// through SSO when the manifest's `webApplicationInfo` matches the
/// connection's token exchange URL.
pub fn oauth_card(connection_name: &str, resource: &SignInResource, text: &str) -> Value {
    json!({
        "contentType": "application/vnd.microsoft.card.oauth",
        "content": {
            "text": text,
            "connectionName": connection_name,
            "tokenExchangeResource": resource.token_exchange_resource,
            "buttons": [{
                "type": "signin",
                "title": "Sign in",
                "value": resource.sign_in_link,
            }],
        },
    })
}

/// The recipient is required even in 1:1 chats: Teams treats OAuth cards as
/// ephemeral requests. Keep sign-in instructions inside the fallback card so
/// successful silent SSO does not leave a misleading message in the chat.
pub fn sign_in_activity(
    activity: &Activity,
    connection_name: &str,
    resource: &SignInResource,
) -> Result<Value, Report> {
    let recipient = activity
        .from
        .as_ref()
        .filter(|from| !from.id.is_empty())
        .ok_or_else(|| eyre!("sign-in activity has no recipient"))?;
    Ok(json!({
        "type": "message",
        "recipient": recipient,
        "attachments": [oauth_card(connection_name, resource,
            "Sign in to let Erato access your Microsoft 365 data.")],
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn incoming() -> Activity {
        serde_json::from_value(json!({
            "type": "message", "id": "message-1", "text": "test",
            "from": {"id": "29:user", "aadObjectId": "entra-user"},
            "recipient": {"id": "28:bot"},
            "conversation": {"id": "a:personal", "tenantId": "tenant", "conversationType": "personal"}
        })).unwrap()
    }

    #[test]
    fn oauth_message_targets_sender_without_visible_sign_in_text() {
        for kind in ["personal", "groupChat", "channel"] {
            let mut activity = incoming();
            activity.conversation.as_mut().unwrap().conversation_type = Some(kind.into());
            let resource = SignInResource {
                sign_in_link: "https://token.botframework.com/signin".into(),
                token_exchange_resource: Some(json!({"id": "exchange-1", "uri": "api://bot"})),
            };
            let outgoing = sign_in_activity(&activity, "graph-sso", &resource).unwrap();
            assert_eq!(outgoing["recipient"]["id"], "29:user");
            assert_ne!(
                outgoing["recipient"]["id"],
                activity.recipient.as_ref().unwrap().id
            );
            assert!(outgoing.get("text").is_none());
            let card = &outgoing["attachments"][0]["content"];
            assert_eq!(card["connectionName"], "graph-sso");
            assert_eq!(card["tokenExchangeResource"]["id"], "exchange-1");
            assert_eq!(card["buttons"][0]["type"], "signin");
            assert_eq!(card["buttons"][0]["value"], resource.sign_in_link);
        }
    }

    #[test]
    fn interactive_sign_in_card_keeps_its_button_without_an_exchange_resource() {
        let resource = SignInResource {
            sign_in_link: "https://token.botframework.com/signin".into(),
            token_exchange_resource: None,
        };
        let outgoing = sign_in_activity(&incoming(), "graph", &resource).unwrap();
        assert!(outgoing["attachments"][0]["content"]["tokenExchangeResource"].is_null());
        assert_eq!(
            outgoing["attachments"][0]["content"]["buttons"][0]["value"],
            resource.sign_in_link
        );
    }

    #[test]
    fn missing_sender_cannot_create_card_or_pending_scope() {
        let mut activity = incoming();
        activity.from = None;
        let client = UserTokenClient::new(
            "https://token.botframework.com",
            "graph".into(),
            "bot".into(),
        );
        assert!(client.sign_in_scope(&activity).is_err());
        assert!(
            sign_in_activity(
                &activity,
                "graph",
                &SignInResource {
                    sign_in_link: "link".into(),
                    token_exchange_resource: None,
                }
            )
            .is_err()
        );
    }
}
