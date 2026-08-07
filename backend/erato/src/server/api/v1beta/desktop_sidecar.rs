use crate::config::DesktopSidecarOrganizationConfiguration;
use crate::policy::engine::{PolicyEngine, authorize};
use crate::policy::types::{Action, Resource};
use crate::server::api::v1beta::me_profile_middleware::MeProfile;
use crate::services::desktop_sidecar_distribution::{
    BootstrapTransport, DesktopSidecarDistribution, DistributionArtifact, DistributionTarget,
    EMBEDDED_BOOTSTRAP_SLOT_CAPACITY, encode_executable_bootstrap_slot,
};
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
        .desktop_sidecar_distribution
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
    build_download_response(app_state.desktop_sidecar_distribution.as_deref(), query).await
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
            let slot = encode_executable_bootstrap_slot(distribution.bootstrap()).map_err(|error| {
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
        BootstrapTransport::WindowsMsi => {
            let personalized = artifact
                .personalized_msi(distribution.bootstrap())
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
