//! A deployment signing key creates attestations, never native cloud credentials.
use super::contract;
use crate::config::LocalDelegationConfig;
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use eyre::{Result, eyre};
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation};
use sea_orm::prelude::Uuid;
use serde_json::{Value, json};

pub struct Signer {
    pub origin: String,
    kid: String,
    key: EncodingKey,
}
impl Signer {
    pub fn new(config: &LocalDelegationConfig) -> Result<Self> {
        // Feature unification can enable another crypto implementation in tests
        // or downstream binaries. Select a provider explicitly before signing.
        let _ = jsonwebtoken::crypto::aws_lc::DEFAULT_PROVIDER.install_default();
        if !config.enabled {
            return Err(eyre!("Local delegation is disabled"));
        }
        let origin = config
            .backend_origin
            .as_deref()
            .ok_or_else(|| eyre!("Missing delegation issuer"))?;
        let url = url::Url::parse(origin).map_err(|_| eyre!("Invalid delegation issuer"))?;
        if url.scheme() != "https"
            || url.origin().ascii_serialization() != origin
            || config.verification_keys.is_empty()
            || config.verification_keys.len() > 8
        {
            return Err(eyre!("Invalid delegation trust policy"));
        }
        let kid = config
            .signing_key_id
            .as_deref()
            .ok_or_else(|| eyre!("Missing delegation key ID"))?;
        if kid.is_empty() || kid.len() > 128 {
            return Err(eyre!("Invalid delegation key ID"));
        }
        for public in config.verification_keys.values() {
            if URL_SAFE_NO_PAD.decode(public)?.len() != 32 {
                return Err(eyre!("Invalid delegation verification key"));
            }
        }
        let private = config
            .signing_private_key_pem
            .as_ref()
            .ok_or_else(|| eyre!("Missing delegation signing key"))?;
        let key = EncodingKey::from_ed_pem(private.expose_secret().as_bytes())
            .map_err(|_| eyre!("Invalid delegation signing key"))?;
        let signer = Self {
            origin: origin.into(),
            kid: kid.into(),
            key,
        };
        let public = URL_SAFE_NO_PAD.decode(
            config
                .verification_keys
                .get(kid)
                .ok_or_else(|| eyre!("Active delegation key is not pinned"))?,
        )?;
        // Catch a mismatched installed key before issuing unusable assertions.
        let probe = signer.sign_unchecked(
            &json!({"sub":"configuration-check","exp":chrono::Utc::now().timestamp()+60}),
        )?;
        jsonwebtoken::decode::<Value>(
            &probe,
            &DecodingKey::from_ed_der(&public),
            &Validation::new(Algorithm::EdDSA),
        )
        .map_err(|_| eyre!("Delegation signing and verification keys do not match"))?;
        Ok(signer)
    }
    fn sign_unchecked(&self, claims: &Value) -> Result<String> {
        let mut header = Header::new(Algorithm::EdDSA);
        header.kid = Some(self.kid.clone());
        jsonwebtoken::encode(&header, claims, &self.key)
            .map_err(|_| eyre!("Delegation assertion signing failed"))
    }
    pub fn sign(&self, kind: &str, claims: Value) -> Result<String> {
        contract::validate(kind, &claims)?;
        self.sign_unchecked(&claims)
    }
    pub fn context(
        &self,
        owner: &str,
        origin: &str,
        device: &str,
        challenge: &str,
    ) -> Result<String> {
        let now = chrono::Utc::now().timestamp();
        self.sign("context-claims",json!({"iss":self.origin,"aud":"erato-local-context-v1","sub":owner,"origin":origin,"deviceId":device,"challenge":challenge,"jti":Uuid::new_v4().simple().to_string(),"iat":now,"exp":now+300}))
    }
    pub fn job(&self, owner: &str, origin: &str, binding: &Value) -> Result<String> {
        let now = chrono::Utc::now().timestamp();
        self.sign("job-claims",json!({"iss":self.origin,"aud":"erato-local-job-v1","sub":owner,"origin":origin,"binding":binding,"jti":Uuid::new_v4().simple().to_string(),"iat":now,"exp":now+300}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // Synthetic, public test fixture (32-byte seed filled with 7). Never a deployment key.
    fn fixture() -> LocalDelegationConfig {
        LocalDelegationConfig {
            enabled: true,
            backend_origin: Some("https://erato.example".into()),
            signing_key_id: Some("fixture".into()),
            signing_private_key_pem: Some(
                concat!(
                    "-----BEGIN PRIVATE KEY-----\n",
                    "MC4CAQAwBQYDK2VwBCIEIAcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcH\n",
                    "-----END PRIVATE KEY-----\n"
                )
                .into(),
            ),
            verification_keys: std::collections::BTreeMap::from([(
                "fixture".into(),
                "6kpsY-KcUgq-9VB7Ey7F-ZVHdq6-vnuSQh7qaRRG0iw".into(),
            )]),
        }
    }
    #[test]
    fn signed_context_uses_exact_audience_and_installed_public_key() {
        let config = fixture();
        let signer = Signer::new(&config).unwrap();
        let token = signer
            .context(
                "owner",
                "https://app.example",
                &"d".repeat(43),
                &"c".repeat(43),
            )
            .unwrap();
        let public = URL_SAFE_NO_PAD
            .decode(&config.verification_keys["fixture"])
            .unwrap();
        let mut validation = Validation::new(Algorithm::EdDSA);
        validation.set_audience(&["erato-local-context-v1"]);
        validation.set_issuer(&["https://erato.example"]);
        let verified =
            jsonwebtoken::decode::<Value>(&token, &DecodingKey::from_ed_der(&public), &validation)
                .unwrap();
        assert_eq!(verified.claims["sub"], "owner");
        assert_eq!(verified.header.kid.as_deref(), Some("fixture"));
        assert_eq!(
            verified.claims["exp"].as_i64().unwrap() - verified.claims["iat"].as_i64().unwrap(),
            300
        );
        validation.set_audience(&["erato-local-job-v1"]);
        assert!(
            jsonwebtoken::decode::<Value>(&token, &DecodingKey::from_ed_der(&public), &validation)
                .is_err()
        );
    }
    #[test]
    fn disabled_or_mismatched_keys_cannot_issue_contexts() {
        let mut config = fixture();
        config.enabled = false;
        assert!(Signer::new(&config).is_err());
        config.enabled = true;
        config
            .verification_keys
            .insert("fixture".into(), URL_SAFE_NO_PAD.encode([0; 32]));
        assert!(Signer::new(&config).is_err());
        assert!(!format!("{config:?}").contains("MC4CAQ"));
    }
}
