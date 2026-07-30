use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use eyre::{Report, WrapErr};
use moka::future::Cache;

use crate::config::{FileTypeDetectionConfig, FileTypeDetectionMode};
use crate::metrics::report_file_type_detection;
use crate::state::FileCacheKey;

const DETECTION_CACHE_MAX_ENTRIES: u64 = 10_000;
const DETECTION_CACHE_TIME_TO_IDLE: Duration = Duration::from_hours(12);

#[derive(Clone, Debug, PartialEq)]
pub struct DetectedFileType {
    pub mime_type: String,
    pub label: String,
    pub score: f32,
}

impl DetectedFileType {
    pub fn is_image(&self) -> bool {
        self.mime_type.starts_with("image/")
    }
}

#[async_trait]
pub trait FileTypeDetector: Send + Sync {
    async fn detect(
        &self,
        cache_key: &FileCacheKey,
        file_bytes: Arc<Vec<u8>>,
    ) -> Result<DetectedFileType, Report>;
}

pub fn create_file_type_detector(
    config: &FileTypeDetectionConfig,
) -> Result<Option<Arc<dyn FileTypeDetector>>, Report> {
    match config.mode {
        FileTypeDetectionMode::Naive => {
            tracing::info!("Using naive file type detection");
            Ok(None)
        }
        FileTypeDetectionMode::Magika => {
            let started_at = Instant::now();
            let detector = MagikaFileTypeDetector::new()?;
            tracing::info!(
                elapsed_ms = started_at.elapsed().as_millis(),
                "Initialized Magika file type detector"
            );
            Ok(Some(Arc::new(detector)))
        }
    }
}

struct MagikaFileTypeDetector {
    session: Arc<Mutex<magika::Session>>,
    cache: Cache<FileCacheKey, DetectedFileType>,
}

impl MagikaFileTypeDetector {
    fn new() -> Result<Self, Report> {
        let session = magika::Session::builder()
            .with_inter_threads(1)
            .with_intra_threads(1)
            .with_parallel_execution(false)
            .build()
            .wrap_err("Failed to initialize Magika session")?;

        let cache = Cache::builder()
            .max_capacity(DETECTION_CACHE_MAX_ENTRIES)
            .time_to_idle(DETECTION_CACHE_TIME_TO_IDLE)
            .build();

        Ok(Self {
            session: Arc::new(Mutex::new(session)),
            cache,
        })
    }

    fn identify(
        session: &Mutex<magika::Session>,
        file_bytes: &[u8],
    ) -> Result<DetectedFileType, Report> {
        let mut session = session
            .lock()
            .map_err(|_| eyre::eyre!("Magika session lock was poisoned"))?;
        let file_type = session
            .identify_content_sync(file_bytes)
            .wrap_err("Magika failed to identify file contents")?;
        let info = file_type.info();

        Ok(DetectedFileType {
            mime_type: info.mime_type.to_string(),
            label: info.label.to_string(),
            score: file_type.score(),
        })
    }
}

#[async_trait]
impl FileTypeDetector for MagikaFileTypeDetector {
    async fn detect(
        &self,
        cache_key: &FileCacheKey,
        file_bytes: Arc<Vec<u8>>,
    ) -> Result<DetectedFileType, Report> {
        let session = Arc::clone(&self.session);
        let result = self
            .cache
            .try_get_with_by_ref(cache_key, async move {
                let started_at = Instant::now();
                let result = tokio::task::spawn_blocking(move || {
                    Self::identify(session.as_ref(), file_bytes.as_slice())
                })
                .await
                .wrap_err("Magika file type detection task panicked")?;
                let elapsed = started_at.elapsed();

                match &result {
                    Ok(file_type) => {
                        report_file_type_detection("magika", "success", elapsed);
                        tracing::debug!(
                            mode = "magika",
                            outcome = "success",
                            elapsed_ms = elapsed.as_millis(),
                            label = %file_type.label,
                            mime_type = %file_type.mime_type,
                            score = file_type.score,
                            "Detected file type"
                        );
                    }
                    Err(error) => {
                        report_file_type_detection("magika", "error", elapsed);
                        tracing::warn!(
                            mode = "magika",
                            outcome = "error",
                            elapsed_ms = elapsed.as_millis(),
                            error = %error,
                            "File type detection failed"
                        );
                    }
                }

                result
            })
            .await
            .map_err(|error| {
                Arc::try_unwrap(error).unwrap_or_else(|error| eyre::eyre!("{error}"))
            })?;

        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::{DetectedFileType, MagikaFileTypeDetector};

    #[test]
    fn only_image_mime_types_are_routed_as_images() {
        let image = DetectedFileType {
            mime_type: "image/png".to_string(),
            label: "png".to_string(),
            score: 1.0,
        };
        let pdf = DetectedFileType {
            mime_type: "application/pdf".to_string(),
            label: "pdf".to_string(),
            score: 1.0,
        };

        assert!(image.is_image());
        assert!(!pdf.is_image());
    }

    #[test]
    fn magika_identifies_shell_content() {
        let detector =
            MagikaFileTypeDetector::new().expect("Magika session should initialize successfully");
        let detected =
            MagikaFileTypeDetector::identify(detector.session.as_ref(), b"#!/bin/sh\necho hello\n")
                .expect("Magika should identify shell content");

        assert_eq!(detected.label, "shell");
        assert_eq!(detected.mime_type, "text/x-shellscript");
    }
}
