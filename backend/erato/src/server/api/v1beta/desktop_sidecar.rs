use crate::config::DesktopSidecarOrganizationConfiguration;
use crate::distribution::desktop_sidecar::{
    BootstrapTransport, DesktopSidecarDistribution, DistributionArtifact, DistributionTarget,
    EMBEDDED_BOOTSTRAP_SLOT_CAPACITY, encode_executable_bootstrap_slot,
};
use crate::policy::engine::{PolicyEngine, authorize};
use crate::policy::types::{Action, Resource};
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::services::file_storage::{ContentDispositionKind, build_content_disposition};
use crate::state::AppState;
use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::header::{CACHE_CONTROL, CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_TYPE};
use axum::http::{HeaderValue, StatusCode};
use axum::response::Response;
use axum::{Extension, Json};
use serde::{Deserialize, Serialize};
use std::io::{Read, Seek, SeekFrom};
use tokio_util::io::ReaderStream;
use utoipa::{IntoParams, ToSchema};

#[derive(Debug, Serialize, ToSchema)]
pub struct DesktopSidecarDistributionResponse {
    targets: Vec<DesktopSidecarDistributionTargetResponse>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DesktopSidecarDistributionTargetResponse {
    id: String,
    platform: DesktopSidecarDistributionPlatformResponse,
    default_file: String,
    files: Vec<DesktopSidecarDistributionFileResponse>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DesktopSidecarDistributionPlatformResponse {
    os: String,
    architecture: String,
    abi: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DesktopSidecarDistributionFileResponse {
    id: String,
    kind: String,
    download_filename: String,
    media_type: String,
    size: u64,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct DesktopSidecarDistributionDownloadQuery {
    /// Manifest target identifier.
    target: String,
    /// Manifest file identifier. The target's default is used when omitted.
    #[param(nullable = false)]
    file: Option<String>,
}

impl From<&DesktopSidecarDistribution> for DesktopSidecarDistributionResponse {
    fn from(distribution: &DesktopSidecarDistribution) -> Self {
        Self {
            targets: distribution
                .targets()
                .iter()
                .map(DesktopSidecarDistributionTargetResponse::from)
                .collect(),
        }
    }
}

impl From<&DistributionTarget> for DesktopSidecarDistributionTargetResponse {
    fn from(target: &DistributionTarget) -> Self {
        Self {
            id: target.id.clone(),
            platform: DesktopSidecarDistributionPlatformResponse {
                os: target.platform.os.clone(),
                architecture: target.platform.architecture.clone(),
                abi: target.platform.abi.clone(),
            },
            default_file: target.default_file.clone(),
            files: target
                .files
                .iter()
                .map(DesktopSidecarDistributionFileResponse::from)
                .collect(),
        }
    }
}

impl From<&DistributionArtifact> for DesktopSidecarDistributionFileResponse {
    fn from(artifact: &DistributionArtifact) -> Self {
        Self {
            id: artifact.id.clone(),
            kind: artifact.kind.clone(),
            download_filename: artifact.download_filename.clone(),
            media_type: artifact.media_type.clone(),
            size: artifact.size,
        }
    }
}

#[utoipa::path(
    get,
    path = "/me/desktop-sidecar/organization-configuration",
    responses(
        (status = OK, body = DesktopSidecarOrganizationConfiguration),
        (status = UNAUTHORIZED, description = "When no valid JWT token is provided")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn organization_configuration(
    State(app_state): State<AppState>,
    Extension(me_user): Extension<MeProfile>,
    Extension(policy): Extension<PolicyEngine>,
) -> Result<Json<DesktopSidecarOrganizationConfiguration>, StatusCode> {
    policy
        .rebuild_data_if_needed_req(&app_state.db, &app_state.config)
        .await?;
    authorize!(
        policy,
        &me_user.to_subject(),
        &Resource::DesktopSidecarConfigurationSingleton,
        Action::Read
    )
    .map_err(|error| {
        tracing::warn!(%error, "Desktop sidecar configuration authorization failed");
        StatusCode::UNAUTHORIZED
    })?;

    Ok(Json(
        app_state
            .config
            .desktop_sidecar
            .organization_configuration
            .clone(),
    ))
}

#[utoipa::path(
    get,
    path = "/desktop-sidecar/distribution",
    responses(
        (status = OK, body = DesktopSidecarDistributionResponse),
        (status = NOT_FOUND, description = "Desktop sidecar distribution is disabled or unavailable")
    )
)]
pub async fn distribution(
    State(app_state): State<AppState>,
) -> Result<Json<DesktopSidecarDistributionResponse>, StatusCode> {
    app_state
        .distribution
        .desktop_sidecar
        .as_deref()
        .map(DesktopSidecarDistributionResponse::from)
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

#[utoipa::path(
    get,
    path = "/desktop-sidecar/distribution/download",
    params(DesktopSidecarDistributionDownloadQuery),
    responses(
        (status = OK, description = "Desktop sidecar distribution artifact", body = Vec<u8>, content_type = "application/octet-stream"),
        (status = NOT_FOUND, description = "Distribution, target, or file is unavailable"),
        (status = INTERNAL_SERVER_ERROR, description = "The validated artifact could not be opened")
    )
)]
pub async fn download_distribution_artifact(
    State(app_state): State<AppState>,
    Query(query): Query<DesktopSidecarDistributionDownloadQuery>,
) -> Result<Response, StatusCode> {
    build_download_response(app_state.distribution.desktop_sidecar.as_deref(), query).await
}

async fn build_download_response(
    distribution: Option<&DesktopSidecarDistribution>,
    query: DesktopSidecarDistributionDownloadQuery,
) -> Result<Response, StatusCode> {
    let distribution = distribution.ok_or(StatusCode::NOT_FOUND)?;
    let artifact = distribution
        .artifact(&query.target, query.file.as_deref())
        .ok_or(StatusCode::NOT_FOUND)?;
    let (body, size) = match artifact.bootstrap_transport() {
        BootstrapTransport::None => {
            let source = artifact.try_clone_source().map_err(|error| {
                tracing::error!(
                    target = %query.target,
                    file = ?query.file,
                    %error,
                    "Failed to clone an open desktop sidecar artifact"
                );
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
            (
                Body::from_stream(ReaderStream::new(tokio::fs::File::from_std(source))),
                artifact.size,
            )
        }
        BootstrapTransport::WindowsExecutable { slot_offset } => {
            let slot = encode_executable_bootstrap_slot(&personalization_bootstrap(distribution)?).map_err(|error| {
                tracing::error!(%error, "Failed to encode desktop sidecar executable bootstrap");
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
            let mut source = artifact.try_clone_source().map_err(|error| {
                tracing::error!(%error, "Failed to clone desktop sidecar executable template");
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
            source.seek(SeekFrom::Start(0)).map_err(|error| {
                tracing::error!(%error, "Failed to seek desktop sidecar executable template");
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
            let mut executable = Vec::new();
            source.read_to_end(&mut executable).map_err(|error| {
                tracing::error!(%error, "Failed to read desktop sidecar executable template");
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
            let slot_offset = usize::try_from(slot_offset).map_err(|error| {
                tracing::error!(%error, "Desktop sidecar executable slot offset could not be encoded");
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
            let slot_end = slot_offset
                .checked_add(EMBEDDED_BOOTSTRAP_SLOT_CAPACITY)
                .ok_or_else(|| {
                    tracing::error!("Desktop sidecar executable slot offset overflows");
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;
            let destination = executable.get_mut(slot_offset..slot_end).ok_or_else(|| {
                tracing::error!("Desktop sidecar executable slot is outside the template");
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
            destination.copy_from_slice(&slot);
            let size = u64::try_from(executable.len()).map_err(|error| {
                tracing::error!(%error, "Desktop sidecar executable size could not be encoded");
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
            (Body::from(executable), size)
        }
        BootstrapTransport::MacosApplication => {
            let bootstrap = personalization_bootstrap(distribution)?;
            let artifact = artifact.clone();
            let personalized = tokio::task::spawn_blocking(move || {
                artifact.personalized_macos_application(&bootstrap)
            })
            .await
            .map_err(|error| {
                tracing::error!(%error, "macOS sidecar personalization task failed");
                StatusCode::INTERNAL_SERVER_ERROR
            })?
            .map_err(|error| {
                tracing::error!(%error, "Failed to personalize macOS sidecar application");
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
            let size =
                u64::try_from(personalized.len()).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            (Body::from(personalized), size)
        }
        BootstrapTransport::WindowsMsi => {
            let personalized = artifact
                .personalized_msi(&personalization_bootstrap(distribution)?)
                .map_err(|error| {
                    tracing::error!(%error, "Failed to personalize desktop sidecar MSI");
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;
            let size = u64::try_from(personalized.len()).map_err(|error| {
                tracing::error!(%error, "Desktop sidecar MSI size could not be encoded");
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
            (Body::from(personalized), size)
        }
    };

    let content_type = HeaderValue::from_str(&artifact.media_type).map_err(|error| {
        tracing::error!(%error, "Validated desktop sidecar media type became invalid");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    let content_length = HeaderValue::from_str(&size.to_string()).map_err(|error| {
        tracing::error!(%error, "Desktop sidecar artifact size could not be encoded");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    let content_disposition = HeaderValue::from_str(&build_content_disposition(
        ContentDispositionKind::Attachment,
        Some(&artifact.download_filename),
    ))
    .map_err(|error| {
        tracing::error!(%error, "Desktop sidecar download filename could not be encoded");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let mut response = Response::new(body);
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("private, no-store"));
    response.headers_mut().insert(CONTENT_TYPE, content_type);
    response
        .headers_mut()
        .insert(CONTENT_LENGTH, content_length);
    response
        .headers_mut()
        .insert(CONTENT_DISPOSITION, content_disposition);
    Ok(response)
}

fn personalization_bootstrap(
    distribution: &DesktopSidecarDistribution,
) -> Result<Vec<u8>, StatusCode> {
    distribution.bootstrap_for_download().map_err(|error| {
        tracing::error!(%error, "Failed to create desktop sidecar bootstrap identity");
        StatusCode::INTERNAL_SERVER_ERROR
    })
}

#[cfg(test)]
mod tests {
    use std::fs;

    use axum::body::to_bytes;
    use serde_json::json;
    use tempfile::tempdir;

    use super::*;

    #[tokio::test]
    async fn distribution_response_and_download_are_built_from_the_manifest() {
        let directory = tempdir().unwrap();
        let target_directory = directory.path().join("targets/windows-x86_64");
        fs::create_dir_all(&target_directory).unwrap();
        let template = windows_executable_template();
        fs::write(
            target_directory.join("erato-desktop-sidecar.exe"),
            &template,
        )
        .unwrap();
        fs::write(
            directory.path().join("manifest.json"),
            serde_json::to_vec_pretty(&json!({
                "targets": [{
                    "id": "windows-x86_64",
                    "platform": {
                        "os": "windows",
                        "architecture": "x86_64",
                        "abi": "msvc"
                    },
                    "default_file": "executable",
                    "files": [{
                        "id": "executable",
                        "kind": "executable",
                        "path": "targets/windows-x86_64/erato-desktop-sidecar.exe",
                        "download_filename": "erato-desktop-sidecar-windows-x86_64.exe",
                        "media_type": "application/vnd.microsoft.portable-executable"
                    }]
                }]
            }))
            .unwrap(),
        )
        .unwrap();

        let distribution = DesktopSidecarDistribution::load_with_allowed_origins(
            directory.path(),
            &["https://app.example.test".to_owned()],
        )
        .unwrap();
        let metadata = DesktopSidecarDistributionResponse::from(&distribution);
        assert_eq!(metadata.targets[0].id, "windows-x86_64");
        assert_eq!(metadata.targets[0].files[0].size, template.len() as u64);

        let response = build_download_response(
            Some(&distribution),
            DesktopSidecarDistributionDownloadQuery {
                target: "windows-x86_64".to_owned(),
                file: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(
            response.headers().get(CONTENT_TYPE).unwrap(),
            "application/vnd.microsoft.portable-executable"
        );
        assert_eq!(
            response
                .headers()
                .get(CONTENT_LENGTH)
                .unwrap()
                .to_str()
                .unwrap(),
            template.len().to_string()
        );
        assert!(
            response
                .headers()
                .get(CONTENT_DISPOSITION)
                .unwrap()
                .to_str()
                .unwrap()
                .contains("erato-desktop-sidecar-windows-x86_64.exe")
        );
        let mut expected = template.clone();
        expected[0x200 + 32..0x200 + 32 + 4096]
            .copy_from_slice(&encode_executable_bootstrap_slot(distribution.bootstrap()).unwrap());
        assert_eq!(
            to_bytes(response.into_body(), template.len())
                .await
                .unwrap()
                .as_ref(),
            expected
        );

        // Download-time issuance must use a fresh identity for each response.
        let key = rcgen::KeyPair::generate().unwrap();
        let mut params = rcgen::CertificateParams::default();
        params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
        params.key_usages = vec![rcgen::KeyUsagePurpose::KeyCertSign];
        let tls = erato_config::config::DesktopSidecarTlsConfig {
            intermediate_certificate_pem: Some(params.self_signed(&key).unwrap().pem()),
            intermediate_private_key_pem: Some(key.serialize_pem().into()),
            ..Default::default()
        };
        let tls_distribution = DesktopSidecarDistribution::load_with_bootstrap(
            directory.path(),
            &["https://app.example.test".into()],
            &tls,
        )
        .unwrap();
        let mut identities = Vec::new();
        for _ in 0..2 {
            let response = build_download_response(
                Some(&tls_distribution),
                DesktopSidecarDistributionDownloadQuery {
                    target: "windows-x86_64".into(),
                    file: None,
                },
            )
            .await
            .unwrap();
            assert_eq!(response.headers()[CACHE_CONTROL], "private, no-store");
            let bytes = to_bytes(response.into_body(), template.len())
                .await
                .unwrap();
            let offset = 0x200 + 32;
            let length =
                u32::from_le_bytes(bytes[offset + 18..offset + 22].try_into().unwrap()) as usize;
            let document: serde_json::Value =
                serde_json::from_slice(&bytes[offset + 26..offset + 26 + length]).unwrap();
            assert_eq!(
                document["organization_configuration"]["allowed_origins"][0],
                "https://app.example.test"
            );
            assert!(
                document["tls"]["certificate_pem"]
                    .as_str()
                    .unwrap()
                    .contains("BEGIN CERTIFICATE")
            );
            let private_key = document["tls"]["private_key_pem"]
                .as_str()
                .unwrap()
                .to_owned();
            assert_ne!(private_key, key.serialize_pem());
            identities.push(private_key);
            assert_eq!(&bytes[..offset], &template[..offset]);
            assert_eq!(&bytes[offset + 4096..], &template[offset + 4096..]);
        }
        assert_ne!(identities[0], identities[1]);
        assert_eq!(
            fs::read(target_directory.join("erato-desktop-sidecar.exe")).unwrap(),
            template
        );

        let missing = build_download_response(
            Some(&distribution),
            DesktopSidecarDistributionDownloadQuery {
                target: "unknown".to_owned(),
                file: None,
            },
        )
        .await;
        assert!(matches!(missing, Err(StatusCode::NOT_FOUND)));
    }

    #[tokio::test]
    async fn macos_downloads_embed_fixed_or_fresh_tls_for_both_architectures() {
        use erato_config::config::DesktopSidecarTlsConfig;
        use std::io::{Cursor, Write};
        use zip::{ZipArchive, ZipWriter, write::SimpleFileOptions};

        const EXECUTABLE: &str = "erato-desktop-sidecar.app/Contents/MacOS/erato-desktop-sidecar";
        const PLIST: &str = "erato-desktop-sidecar.app/Contents/Info.plist";
        const BOOTSTRAP: &str = "erato-desktop-sidecar.app/Contents/Resources/bootstrap.json";
        let key = rcgen::KeyPair::generate().unwrap();
        let mut params = rcgen::CertificateParams::default();
        params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
        params.key_usages = vec![rcgen::KeyUsagePurpose::KeyCertSign];
        let ca = params.self_signed(&key).unwrap();
        let dynamic = DesktopSidecarTlsConfig {
            intermediate_certificate_pem: Some(ca.pem()),
            intermediate_private_key_pem: Some(key.serialize_pem().into()),
            ..Default::default()
        };
        let leaf = rcgen::generate_simple_self_signed(vec!["127.0.0.1".into()]).unwrap();
        let fixed = DesktopSidecarTlsConfig {
            certificate_pem: Some(leaf.cert.pem()),
            private_key_pem: Some(leaf.signing_key.serialize_pem().into()),
            ..Default::default()
        };
        for (architecture, cpu) in [("x86_64", 0x0100_0007_u32), ("aarch64", 0x0100_000c_u32)] {
            let directory = tempdir().unwrap();
            let mut executable = vec![0xcf, 0xfa, 0xed, 0xfe];
            executable.extend_from_slice(&cpu.to_le_bytes());
            executable.extend_from_slice(b"unmodified executable bytes");
            let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
            zip.start_file(PLIST, SimpleFileOptions::default().unix_permissions(0o644))
                .unwrap();
            zip.write_all(b"unmodified Info.plist").unwrap();
            zip.start_file(
                EXECUTABLE,
                SimpleFileOptions::default().unix_permissions(0o755),
            )
            .unwrap();
            zip.write_all(&executable).unwrap();
            let template = zip.finish().unwrap().into_inner();
            let source_path = directory.path().join("sidecar.app.zip");
            fs::write(&source_path, &template).unwrap();
            let target = format!("macos-{architecture}");
            fs::write(directory.path().join("manifest.json"), serde_json::to_vec(&json!({
                "targets": [{"id": target, "platform": {"os": "macos", "architecture": architecture, "abi": "darwin"},
                    "default_file": "application", "files": [{"id": "application", "kind": "application_archive",
                        "path": "sidecar.app.zip", "download_filename": "sidecar.app.zip", "media_type": "application/zip"}]}]
            })).unwrap()).unwrap();
            for config in [
                DesktopSidecarTlsConfig::default(),
                fixed.clone(),
                dynamic.clone(),
            ] {
                let distribution = DesktopSidecarDistribution::load_with_bootstrap(
                    directory.path(),
                    &["https://app.example.test".into()],
                    &config,
                )
                .unwrap();
                assert_eq!(
                    distribution
                        .artifact(&target, None)
                        .unwrap()
                        .bootstrap_transport(),
                    BootstrapTransport::MacosApplication
                );
                let download = || {
                    build_download_response(
                        Some(&distribution),
                        DesktopSidecarDistributionDownloadQuery {
                            target: target.clone(),
                            file: None,
                        },
                    )
                };
                let (first, second) = tokio::join!(download(), download());
                let mut bootstraps = Vec::new();
                for response in [first.unwrap(), second.unwrap()] {
                    assert_eq!(response.headers()[CONTENT_TYPE], "application/zip");
                    assert_eq!(response.headers()[CACHE_CONTROL], "private, no-store");
                    let length: usize = response.headers()[CONTENT_LENGTH]
                        .to_str()
                        .unwrap()
                        .parse()
                        .unwrap();
                    let body = to_bytes(response.into_body(), 1_000_000).await.unwrap();
                    assert_eq!(body.len(), length);
                    let mut archive = ZipArchive::new(Cursor::new(body)).unwrap();
                    assert_eq!(archive.len(), 3);
                    let mut actual = Vec::new();
                    let mut binary = archive.by_name(EXECUTABLE).unwrap();
                    assert_eq!(binary.unix_mode().unwrap() & 0o777, 0o755);
                    binary.read_to_end(&mut actual).unwrap();
                    assert_eq!(actual, executable);
                    drop(binary);
                    let mut plist = String::new();
                    archive
                        .by_name(PLIST)
                        .unwrap()
                        .read_to_string(&mut plist)
                        .unwrap();
                    assert_eq!(plist, "unmodified Info.plist");
                    let mut entry = archive.by_name(BOOTSTRAP).unwrap();
                    assert_eq!(entry.unix_mode().unwrap() & 0o777, 0o600);
                    let mut bytes = Vec::new();
                    entry.read_to_end(&mut bytes).unwrap();
                    let document: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
                    assert_eq!(
                        document["organization_configuration"]["allowed_origins"][0],
                        "https://app.example.test"
                    );
                    assert_ne!(document["tls"]["private_key_pem"], key.serialize_pem());
                    bootstraps.push(document);
                }
                if config.intermediate_certificate_pem.is_some() {
                    assert_ne!(
                        bootstraps[0]["tls"]["private_key_pem"],
                        bootstraps[1]["tls"]["private_key_pem"]
                    );
                    assert!(
                        bootstraps[0]["tls"]["certificate_pem"]
                            .as_str()
                            .unwrap()
                            .contains(ca.pem().trim())
                    );
                } else {
                    assert_eq!(bootstraps[0], bootstraps[1]);
                    if let Some(key) = &config.private_key_pem {
                        assert_eq!(bootstraps[0]["tls"]["private_key_pem"], key.expose_secret());
                        assert_eq!(bootstraps[0]["tls"]["certificate_pem"], leaf.cert.pem());
                    } else {
                        assert!(bootstraps[0].get("tls").is_none());
                    }
                }
                assert_eq!(fs::read(&source_path).unwrap(), template);
            }
            fs::write(source_path, b"invalid ZIP").unwrap();
            assert!(DesktopSidecarDistribution::load(directory.path()).is_err());
        }
    }

    fn windows_executable_template() -> Vec<u8> {
        const SLOT_CAPACITY: usize = 4096;
        const HEADER_BYTES: usize = 26;
        let section_offset = 0x200;
        let section_size = SLOT_CAPACITY + 64;
        let mut binary = vec![0; section_offset + section_size];
        binary[..2].copy_from_slice(b"MZ");
        binary[0x3c..0x40].copy_from_slice(&(0x80_u32).to_le_bytes());
        binary[0x80..0x84].copy_from_slice(b"PE\0\0");
        binary[0x86..0x88].copy_from_slice(&1_u16.to_le_bytes());
        binary[0x94..0x96].copy_from_slice(&0x20_u16.to_le_bytes());
        let header = 0x80 + 24 + 0x20;
        binary[header..header + 6].copy_from_slice(b".erato");
        binary[header + 16..header + 20].copy_from_slice(&(section_size as u32).to_le_bytes());
        binary[header + 20..header + 24].copy_from_slice(&(section_offset as u32).to_le_bytes());
        let slot_offset = section_offset + 32;
        binary[slot_offset..slot_offset + 16].copy_from_slice(b"ERATO_BOOTSTRAP!");
        binary[slot_offset + 16..slot_offset + 18].copy_from_slice(&1_u16.to_le_bytes());
        binary[slot_offset + 22..slot_offset + 26]
            .copy_from_slice(&((SLOT_CAPACITY - HEADER_BYTES) as u32).to_le_bytes());
        binary
    }
}
