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
    verification_keys: std::collections::BTreeMap<String, DecodingKey>,
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
        // The issuer is pinned by the sidecar with exact string equality, so it
        // must be the canonical `scheme://host[:port]` serialization. The
        // scheme is not a trust input (the installed public key is), which
        // lets a plaintext development backend issue assertions. Only http
        // and https are accepted, matching the sidecar's trust policy.
        let url = url::Url::parse(origin).map_err(|_| eyre!("Invalid delegation issuer"))?;
        if !matches!(url.scheme(), "http" | "https")
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
            verification_keys: config
                .verification_keys
                .iter()
                .map(|(id, encoded)| {
                    URL_SAFE_NO_PAD
                        .decode(encoded)
                        .map(|bytes| (id.clone(), DecodingKey::from_ed_der(&bytes)))
                })
                .collect::<Result<_, _>>()?,
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
    /// Verify a backend receipt without imposing JWT expiry: durable receipts
    /// remain usable for lost-ack recovery after the original export expires.
    pub fn verify_receipt(&self, token: &str) -> Result<Value> {
        let header = jsonwebtoken::decode_header(token)?;
        let key = header
            .kid
            .as_ref()
            .and_then(|kid| self.verification_keys.get(kid))
            .ok_or_else(|| eyre!("Unknown receipt key"))?;
        let mut validation = Validation::new(Algorithm::EdDSA);
        validation.required_spec_claims.clear();
        validation.validate_exp = false;
        validation.set_audience(&["erato-local-export-receipt-v1"]);
        validation.set_issuer(&[&self.origin]);
        let claims = jsonwebtoken::decode::<Value>(token, key, &validation)?.claims;
        contract::validate("receipt-claims", &claims)?;
        Ok(claims)
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
    #[test]
    fn plaintext_development_origins_are_pinned_as_issuer() {
        // The sidecar verifies `iss` by exact equality against the installed
        // origin, so a loopback or non-loopback http dev host is a valid issuer.
        for origin in [
            "http://localhost:3130",
            "http://devhost:3130",
            "https://erato.example:8443",
        ] {
            let mut config = fixture();
            config.backend_origin = Some(origin.into());
            let signer = Signer::new(&config).unwrap_or_else(|error| panic!("{origin}: {error}"));
            assert_eq!(signer.origin, origin);
            let token = signer
                .context(
                    "owner",
                    "http://devhost:3131",
                    &"d".repeat(43),
                    &"c".repeat(43),
                )
                .unwrap();
            let public = URL_SAFE_NO_PAD
                .decode(&config.verification_keys["fixture"])
                .unwrap();
            let mut validation = Validation::new(Algorithm::EdDSA);
            validation.set_audience(&["erato-local-context-v1"]);
            validation.set_issuer(&[origin]);
            let verified = jsonwebtoken::decode::<Value>(
                &token,
                &DecodingKey::from_ed_der(&public),
                &validation,
            )
            .unwrap();
            assert_eq!(verified.claims["iss"], origin);
        }
    }
    #[test]
    fn non_canonical_issuers_are_rejected() {
        for origin in [
            "https://erato.example/",
            "https://erato.example/path",
            "https://erato.example:443",
            "HTTPS://erato.example",
            "http://devhost:3130/",
            // Canonical tuple origins, but not web schemes.
            "ws://devhost:3130",
            "wss://devhost:3130",
            "ftp://erato.example",
            "erato.example",
        ] {
            let mut config = fixture();
            config.backend_origin = Some(origin.into());
            assert!(Signer::new(&config).is_err(), "{origin:?} was accepted");
        }
    }
}
