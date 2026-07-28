use graph_rs_sdk::{GraphClient, GraphClientConfiguration, ODataQuery};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct GraphUser {
    #[serde(rename = "displayName")]
    display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GraphUsersResponse {
    value: Vec<GraphUser>,
}

pub struct MsGraphService {
    client: GraphClient,
}

impl MsGraphService {
    pub fn new(access_token: &str) -> Self {
        Self {
            client: GraphClient::from(
                GraphClientConfiguration::new()
                    .access_token(access_token)
                    .connection_verbose(true),
            ),
        }
    }

    pub async fn resolve_user_display_name(
        &self,
        subject: &str,
        email: Option<&str>,
    ) -> Option<String> {
        // Prefer the stored identity subject when it maps to the Graph object ID.
        // Email is less precise and is only used as a compatibility fallback.
        let subject_response = self
            .client
            .user(subject)
            .get_user()
            .select(&["displayName"])
            .send()
            .await;

        match subject_response {
            Ok(response) => match response.json::<GraphUser>().await {
                Ok(user) => {
                    if let Some(display_name) = non_empty_display_name(user) {
                        return Some(display_name);
                    }
                }
                Err(error) => {
                    tracing::warn!(
                        "Failed to parse user {} from Microsoft Graph: {:?}",
                        subject,
                        error
                    );
                }
            },
            Err(error) => {
                tracing::debug!(
                    "Could not resolve Microsoft Graph user by subject {}; falling back to email: {:?}",
                    subject,
                    error
                );
            }
        }

        let email = email?;
        let filter = user_email_filter(email);
        let response = match self
            .client
            .users()
            .list_user()
            .select(&["displayName"])
            .filter(&[filter.as_str()])
            .top("1")
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                tracing::warn!(
                    "Failed to resolve Microsoft Graph user {}: {:?}",
                    email,
                    error
                );
                return None;
            }
        };

        let user = match response.json::<GraphUsersResponse>().await {
            Ok(response) => response.value.into_iter().next(),
            Err(error) => {
                tracing::warn!(
                    "Failed to parse Microsoft Graph user {}: {:?}",
                    email,
                    error
                );
                return None;
            }
        };

        user.and_then(non_empty_display_name)
    }
}

fn non_empty_display_name(user: GraphUser) -> Option<String> {
    user.display_name
        .filter(|display_name| !display_name.trim().is_empty())
}

fn user_email_filter(email: &str) -> String {
    let escaped_email = email.replace('\'', "''");
    format!("mail eq '{escaped_email}' or userPrincipalName eq '{escaped_email}'")
}

#[cfg(test)]
mod tests {
    use super::user_email_filter;

    #[test]
    fn user_email_filter_matches_mail_and_user_principal_name() {
        assert_eq!(
            user_email_filter("person@example.com"),
            "mail eq 'person@example.com' or userPrincipalName eq 'person@example.com'"
        );
    }

    #[test]
    fn user_email_filter_escapes_odata_string_literals() {
        assert_eq!(
            user_email_filter("o'connor@example.com"),
            "mail eq 'o''connor@example.com' or userPrincipalName eq 'o''connor@example.com'"
        );
    }
}
