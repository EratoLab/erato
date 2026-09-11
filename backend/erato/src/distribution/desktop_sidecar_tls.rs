//! Server identities for bootstrap personalization. Signing keys stay on the backend.

use std::{fmt, sync::Arc};

use erato_config::config::{DesktopSidecarTlsConfig, SecretConfigString};
use eyre::{Context, Result, bail, ensure};
use rcgen::{CertificateParams, ExtendedKeyUsagePurpose, Issuer, KeyPair, KeyUsagePurpose};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, pem::PemObject};
use time::{Duration, OffsetDateTime};
use x509_parser::prelude::{FromDer, GeneralName, X509Certificate};

#[derive(Clone)]
pub(super) enum BootstrapTls {
    Fixed {
        certificate: String,
        key: SecretConfigString,
    },
    Intermediate {
        certificate: String,
        key: SecretConfigString,
        validity_days: u32,
    },
}

impl fmt::Debug for BootstrapTls {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("BootstrapTls([REDACTED])")
    }
}

impl BootstrapTls {
    pub(super) fn from_config(config: &DesktopSidecarTlsConfig) -> Result<Option<Self>> {
        let identity = match (
            &config.certificate_pem,
            &config.private_key_pem,
            &config.intermediate_certificate_pem,
            &config.intermediate_private_key_pem,
        ) {
            (None, None, None, None) if config.validity_days.is_none() => return Ok(None),
            (Some(certificate), Some(key), None, None) if config.validity_days.is_none() => {
                validate_identity(certificate, key.expose_secret(), false)?;
                Self::Fixed {
                    certificate: certificate.clone(),
                    key: key.clone(),
                }
            }
            (None, None, Some(certificate), Some(key)) => {
                let validity_days = config.validity_days.unwrap_or(365);
                ensure!(
                    (1..=3650).contains(&validity_days),
                    "Desktop sidecar TLS validity_days must be between 1 and 3650"
                );
                validate_identity(certificate, key.expose_secret(), true)?;
                // Check that rcgen supports the configured signing key at startup.
                KeyPair::from_pem(key.expose_secret())
                    .wrap_err("Invalid desktop sidecar intermediate signing key")?;
                Self::Intermediate {
                    certificate: certificate.clone(),
                    key: key.clone(),
                    validity_days,
                }
            }
            _ => bail!(
                "Desktop sidecar TLS requires either certificate_pem/private_key_pem or intermediate_certificate_pem/intermediate_private_key_pem; validity_days is only valid with an intermediate"
            ),
        };
        Ok(Some(identity))
    }

    pub(super) fn issue(&self) -> Result<(String, SecretConfigString)> {
        match self {
            Self::Fixed { certificate, key } => {
                validate_identity(certificate, key.expose_secret(), false)?;
                Ok((certificate.clone(), key.clone()))
            }
            Self::Intermediate {
                certificate,
                key,
                validity_days,
            } => {
                let (issuer_start, issuer_end) =
                    validate_identity(certificate, key.expose_secret(), true)?;
                let signing_key = KeyPair::from_pem(key.expose_secret())?;
                let issuer = Issuer::from_ca_cert_pem(certificate, signing_key)?;
                let leaf_key = KeyPair::generate()?;
                let mut params = CertificateParams::new(vec![
                    "127.0.0.1".into(),
                    "localhost".into(),
                    "::1".into(),
                ])?;
                let now = OffsetDateTime::now_utc();
                params.not_before = (now - Duration::minutes(5)).max(issuer_start);
                params.not_after =
                    (now + Duration::days(i64::from(*validity_days))).min(issuer_end);
                params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
                params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
                let leaf = params.signed_by(&leaf_key, &issuer)?;
                Ok((
                    format!("{}\n{}", leaf.pem(), certificate.trim()),
                    leaf_key.serialize_pem().into(),
                ))
            }
        }
    }
}

/// Verify PEM, key matching, validity and the certificate's intended role.
/// Return the chain's common validity window to bound generated leaves.
fn validate_identity(
    certificate: &str,
    key: &str,
    ca: bool,
) -> Result<(OffsetDateTime, OffsetDateTime)> {
    let certificates = CertificateDer::pem_slice_iter(certificate.as_bytes())
        .collect::<Result<Vec<_>, _>>()
        .wrap_err("Invalid desktop sidecar TLS certificate PEM")?;
    ensure!(
        !certificates.is_empty(),
        "Desktop sidecar TLS certificate chain is empty"
    );
    let private_key = PrivateKeyDer::from_pem_slice(key.as_bytes())
        .wrap_err("Invalid desktop sidecar TLS private key PEM")?;
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    rustls::ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()?
        .with_no_client_auth()
        .with_single_cert(certificates.clone(), private_key)
        .wrap_err("Invalid desktop sidecar TLS certificate/key pair")?;
    let mut start = OffsetDateTime::UNIX_EPOCH;
    let mut end = OffsetDateTime::now_utc() + Duration::days(36500);
    for (index, der) in certificates.iter().enumerate() {
        let (_, parsed) = X509Certificate::from_der(der.as_ref())
            .map_err(|_| eyre::eyre!("Invalid desktop sidecar X.509 certificate"))?;
        ensure!(
            parsed.validity().is_valid(),
            "Desktop sidecar TLS certificate is expired or not yet valid"
        );
        start = start.max(OffsetDateTime::from_unix_timestamp(
            parsed.validity().not_before.timestamp(),
        )?);
        end = end.min(OffsetDateTime::from_unix_timestamp(
            parsed.validity().not_after.timestamp(),
        )?);
        if index == 0 {
            if ca {
                ensure!(
                    parsed
                        .basic_constraints()?
                        .is_some_and(|constraints| constraints.value.ca),
                    "Desktop sidecar TLS intermediate must be a CA certificate"
                );
                ensure!(
                    parsed
                        .key_usage()?
                        .is_none_or(|usage| usage.value.key_cert_sign()),
                    "Desktop sidecar TLS intermediate does not permit certificate signing"
                );
            } else {
                ensure!(
                    !parsed.is_ca(),
                    "Desktop sidecar fixed TLS certificate must be a server leaf"
                );
                ensure!(
                    parsed
                        .extended_key_usage()?
                        .is_none_or(|usage| usage.value.server_auth || usage.value.any),
                    "Desktop sidecar TLS leaf does not permit server authentication"
                );
                ensure!(parsed.subject_alternative_name()?.is_some_and(|san| san.value.general_names.iter().any(|name| matches!(name, GeneralName::IPAddress(ip) if *ip == [127, 0, 0, 1]))), "Desktop sidecar TLS leaf must include the 127.0.0.1 IP subject alternative name");
            }
        }
    }
    Ok((start, end))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rcgen::{BasicConstraints, IsCa};
    use rustls::client::danger::ServerCertVerifier;
    use rustls::{
        RootCertStore,
        client::WebPkiServerVerifier,
        pki_types::{ServerName, UnixTime},
    };

    fn intermediate_config() -> DesktopSidecarTlsConfig {
        let root_key = KeyPair::generate().unwrap();
        let mut params = CertificateParams::default();
        params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        params.key_usages = vec![KeyUsagePurpose::KeyCertSign];
        params.not_before = OffsetDateTime::now_utc() - Duration::days(1);
        params.not_after = OffsetDateTime::now_utc() + Duration::days(60);
        params
            .distinguished_name
            .push(rcgen::DnType::CommonName, "Test root");
        let root = params.self_signed(&root_key).unwrap();
        let issuer = Issuer::new(params.clone(), root_key);
        let key = KeyPair::generate().unwrap();
        params.is_ca = IsCa::Ca(BasicConstraints::Constrained(0));
        params.not_after = OffsetDateTime::now_utc() + Duration::days(30);
        params
            .distinguished_name
            .push(rcgen::DnType::CommonName, "Test intermediate");
        let certificate = params.signed_by(&key, &issuer).unwrap();
        DesktopSidecarTlsConfig {
            intermediate_certificate_pem: Some(format!("{}{}", certificate.pem(), root.pem())),
            intermediate_private_key_pem: Some(key.serialize_pem().into()),
            ..Default::default()
        }
    }

    #[test]
    fn issued_leaves_are_fresh_trusted_loopback_identities_bounded_by_issuer() {
        let config = intermediate_config();
        let source = BootstrapTls::from_config(&config).unwrap().unwrap();
        let (first_cert, first_key) = source.issue().unwrap();
        let (second_cert, second_key) = source.issue().unwrap();
        assert_ne!(first_key, second_key);
        assert_ne!(first_cert, second_cert);
        assert!(
            !first_cert.contains(
                config
                    .intermediate_private_key_pem
                    .as_ref()
                    .unwrap()
                    .expose_secret()
            )
        );
        validate_identity(&first_cert, first_key.expose_secret(), false).unwrap();
        let certs = CertificateDer::pem_slice_iter(first_cert.as_bytes())
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(certs.len(), 3);
        let (_, leaf) = X509Certificate::from_der(certs[0].as_ref()).unwrap();
        let (_, ca) = X509Certificate::from_der(certs[1].as_ref()).unwrap();
        assert!(leaf.validity().not_after <= ca.validity().not_after);
        assert!(!leaf.is_ca());
        let mut roots = RootCertStore::empty();
        roots.add(certs[2].clone()).unwrap();
        let verifier = WebPkiServerVerifier::builder_with_provider(
            Arc::new(roots),
            Arc::new(rustls::crypto::ring::default_provider()),
        )
        .build()
        .unwrap();
        verifier
            .verify_server_cert(
                &certs[0],
                &certs[1..2],
                &ServerName::try_from("127.0.0.1").unwrap(),
                &[],
                UnixTime::now(),
            )
            .unwrap();
    }

    #[test]
    fn fixed_identity_is_preserved_and_secrets_are_redacted() {
        let (certificate, key) = BootstrapTls::from_config(&intermediate_config())
            .unwrap()
            .unwrap()
            .issue()
            .unwrap();
        let config = DesktopSidecarTlsConfig {
            certificate_pem: Some(certificate.clone()),
            private_key_pem: Some(key.clone()),
            ..Default::default()
        };
        let source = BootstrapTls::from_config(&config).unwrap().unwrap();
        assert_eq!(source.issue().unwrap(), (certificate, key.clone()));
        assert!(!format!("{source:?} {config:?}").contains(key.expose_secret()));
    }

    #[test]
    fn rejects_partial_mixed_mismatched_and_non_ca_configuration() {
        assert!(
            BootstrapTls::from_config(&DesktopSidecarTlsConfig::default())
                .unwrap()
                .is_none()
        );
        let valid = intermediate_config();
        let mut config = valid.clone();
        config.intermediate_private_key_pem = None;
        assert!(BootstrapTls::from_config(&config).is_err());
        let mut config = valid.clone();
        config.certificate_pem = Some("mixed".into());
        assert!(BootstrapTls::from_config(&config).is_err());
        let mut config = valid.clone();
        config.intermediate_private_key_pem =
            Some(KeyPair::generate().unwrap().serialize_pem().into());
        assert!(BootstrapTls::from_config(&config).is_err());
        for days in [0, 3651] {
            let mut config = valid.clone();
            config.validity_days = Some(days);
            assert!(BootstrapTls::from_config(&config).is_err());
        }
        let (certificate, key) = BootstrapTls::from_config(&valid)
            .unwrap()
            .unwrap()
            .issue()
            .unwrap();
        let config = DesktopSidecarTlsConfig {
            intermediate_certificate_pem: Some(certificate),
            intermediate_private_key_pem: Some(key),
            ..Default::default()
        };
        assert!(BootstrapTls::from_config(&config).is_err());
    }

    #[test]
    fn rejects_expired_ca_and_ca_without_signing_usage() {
        for expired in [false, true] {
            let key = KeyPair::generate().unwrap();
            let mut params = CertificateParams::default();
            params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
            params.not_before = OffsetDateTime::now_utc() - Duration::days(10);
            params.not_after =
                OffsetDateTime::now_utc() + Duration::days(if expired { -1 } else { 10 });
            params.key_usages = vec![if expired {
                KeyUsagePurpose::KeyCertSign
            } else {
                KeyUsagePurpose::DigitalSignature
            }];
            let config = DesktopSidecarTlsConfig {
                intermediate_certificate_pem: Some(params.self_signed(&key).unwrap().pem()),
                intermediate_private_key_pem: Some(key.serialize_pem().into()),
                ..Default::default()
            };
            assert!(BootstrapTls::from_config(&config).is_err());
        }
    }
}
