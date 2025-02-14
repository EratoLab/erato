//! Normalize profile from the ID token claims of different OIDC providers
//! See <https://openid.net/specs/openid-connect-core-1_0.html#IDToken> for required claims.
//! See <https://openid.net/specs/openid-connect-core-1_0.html#StandardClaims> for standard claims.

use eyre::{eyre, Report};
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
pub struct IdTokenProfile {
    // Issuer = `iss`
    pub iss: String,
    // Subject = `sub`
    pub sub: String,
    // Email
    pub email: Option<String>,
    // Name. Usually given name and family name, but may follow different local cultural conventions.
    pub name: Option<String>,
    // Picture
    // Absolute URL of the user's profile picture, that is accessible from a frontend.
    pub picture: Option<String>,
    // Preferred language
    pub preferred_language: Option<String>,
}

// Normalize profile from the ID token claims of different OIDC providers.
pub fn normalize_profile(claims: Value) -> Result<IdTokenProfile, Report> {
    // Required claims per spec
    let iss = claims.get("iss").ok_or(eyre!("iss claim is required"))?;
    let sub = claims.get("sub").ok_or(eyre!("sub claim is required"))?;
    // Optional standard claims across providers
    let email = claims
        .get("email")
        .map(|v| v.as_str().map(String::from))
        .flatten();
    let name = claims
        .get("name")
        .map(|v| v.as_str().map(String::from))
        .flatten();
    let picture = claims
        .get("picture")
        .map(|v| v.as_str().map(String::from))
        .flatten();
    // xms_pl and xms_tpl; Entra ID specific
    let user_preferred_language = claims
        .get("xms_pl")
        .map(|v| v.as_str().map(String::from))
        .flatten();
    let tenant_preferred_language = claims
        .get("xms_tpl")
        .map(|v| v.as_str().map(String::from))
        .flatten();

    let preferred_language = user_preferred_language.or(tenant_preferred_language);

    let profile = IdTokenProfile {
        iss: iss.as_str().map(String::from).unwrap(),
        sub: sub.as_str().map(String::from).unwrap(),
        email,
        name,
        picture,
        preferred_language,
    };

    Ok(profile)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    pub fn test_normalize_dex_profile() {
        let claims = serde_json::json!({
          "at_hash": "o5VyVVqnw8MHcUN3isrsjw",
          "aud": "example-app",
          "c_hash": "fc0ndDjzLtvd2Ruo33-xqw",
          "email": "admin@example.com",
          "email_verified": true,
          "exp": 1739647694,
          "iat": 1739561294,
          "iss": "http://0.0.0.0:5556",
          "name": "admin",
          "sub": "CiQwOGE4Njg0Yi1kYjg4LTRiNzMtOTBhOS0zY2QxNjYxZjU0NjYSBWxvY2Fs"
        });
        let profile = normalize_profile(claims).unwrap();
        assert_eq!(profile.iss, "http://0.0.0.0:5556");
        assert_eq!(
            profile.sub,
            "CiQwOGE4Njg0Yi1kYjg4LTRiNzMtOTBhOS0zY2QxNjYxZjU0NjYSBWxvY2Fs"
        );
        assert_eq!(profile.email, Some("admin@example.com".to_string()));
        assert_eq!(profile.name, Some("admin".to_string()));
        assert_eq!(profile.preferred_language, None);
        assert_eq!(profile.picture, None);
    }

    #[test]
    #[ignore]
    // TODO: Need to setup entra id app with no additional claims and dump ID token claims.
    pub fn test_normalize_entra_id_minimal_profile() {
        let claims = serde_json::json!({
            "iss": "https://login.microsoftonline.com/1234567890/v2.0",
            "sub": "1234567890",
            "email": "test@example.com",
        });
    }

    // Test for entra_id with additional claims: email, family_name, given_name, preferred_username, xms_pl, xms_tpl
    // and scopes: openid, profile, email
    #[test]
    pub fn test_normalize_entra_id_full_profile() {
        let claims = serde_json::json!({
          "aud": "11111111-1111-1111-1111-111111111111",
          "email": "john.doe@example.com",
          "exp": 1739565362,
          "family_name": "Doe",
          "given_name": "John",
          "iat": 1739561462,
          "iss": "https://login.microsoftonline.com/22222222-2222-2222-2222-222222222222/v2.0",
          "name": "John Doe",
          "nbf": 1739561462,
          "oid": "33333333-3333-3333-3333-333333333333",
          "preferred_username": "john.doe@example.com",
          "rh": "1.Aa4ALT4IDRtp-06ozaigHQN3GWmN2QY6Ui5MiT1EvZgiazGtABmuAA.",
          "sid": "44444444-4444-4444-4444-444444444444",
          "sub": "55555555555555555555555555555555555555555555",
          "tid": "22222222-2222-2222-2222-222222222222",
          "uti": "EdnjOuz0tkaYrHfKVGMcAA",
          "ver": "2.0",
          "xms_pl": "en",
          "xms_tpl": "en"
        });
        let profile = normalize_profile(claims).unwrap();
        assert_eq!(
            profile.iss,
            "https://login.microsoftonline.com/22222222-2222-2222-2222-222222222222/v2.0"
        );
        assert_eq!(profile.sub, "55555555555555555555555555555555555555555555");
        assert_eq!(profile.email, Some("john.doe@example.com".to_string()));
        assert_eq!(profile.name, Some("John Doe".to_string()));
        assert_eq!(profile.preferred_language, Some("en".to_string()));
        assert_eq!(profile.picture, None);
    }
}
