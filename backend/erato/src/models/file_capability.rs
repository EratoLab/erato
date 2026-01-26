use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Represents what operations can be performed on files with specific types
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct FileCapability {
    /// Stable identifier (e.g., 'word', 'pdf', 'image', 'other')
    pub id: String,

    /// File extensions this capability applies to (e.g., ["docx", "doc"])
    /// Special value "*" indicates all extensions
    pub extensions: Vec<String>,

    /// MIME types this capability applies to (e.g., ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"])
    /// May contain wildcards like "image/*" or "*/*"
    pub mime_types: Vec<String>,

    /// Operations that can be performed on matching files
    pub operations: Vec<FileOperation>,
}

/// Operations that can be performed on files
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum FileOperation {
    /// Extract text content from the file (via Kreuzberg or OCR)
    ExtractText,

    /// Analyze image using model's image understanding capabilities
    AnalyzeImage,
}

impl FileCapability {
    /// Creates a new FileCapability
    pub fn new(
        id: impl Into<String>,
        extensions: Vec<String>,
        mime_types: Vec<String>,
        operations: Vec<FileOperation>,
    ) -> Self {
        Self {
            id: id.into(),
            extensions,
            mime_types,
            operations,
        }
    }

    /// Checks if this capability matches the given file extension
    pub fn matches_extension(&self, extension: &str) -> bool {
        let ext_lower = extension.to_lowercase();

        // Check for wildcard
        if self.extensions.iter().any(|e| e == "*") {
            return true;
        }

        // Check for exact match (case-insensitive)
        self.extensions
            .iter()
            .any(|e| e.to_lowercase() == ext_lower)
    }

    /// Checks if this capability matches the given MIME type
    pub fn matches_mime_type(&self, mime_type: &str) -> bool {
        let mime_lower = mime_type.to_lowercase();

        for pattern in &self.mime_types {
            let pattern_lower = pattern.to_lowercase();

            // Exact match
            if pattern_lower == mime_lower {
                return true;
            }

            // Wildcard matches
            if pattern_lower == "*/*" {
                return true;
            }

            // Prefix wildcard (e.g., "image/*")
            if pattern_lower.ends_with("/*") {
                let prefix = pattern_lower.trim_end_matches("/*");
                if mime_lower.starts_with(prefix) {
                    return true;
                }
            }
        }

        false
    }
}

/// Builds the list of available file capabilities based on the file processor and model capabilities
pub fn get_file_capabilities(supports_image_understanding: bool) -> Vec<FileCapability> {
    // Build the image capability based on model support
    let image_capability = if supports_image_understanding {
        FileCapability::new(
            "image",
            vec![
                "jpg".to_string(),
                "jpeg".to_string(),
                "png".to_string(),
                "gif".to_string(),
                "webp".to_string(),
                "bmp".to_string(),
                "tiff".to_string(),
                "tif".to_string(),
            ],
            vec!["image/*".to_string()],
            vec![FileOperation::AnalyzeImage],
        )
    } else {
        // Without image understanding, images get no operations
        FileCapability::new(
            "image",
            vec![
                "jpg".to_string(),
                "jpeg".to_string(),
                "png".to_string(),
                "gif".to_string(),
                "webp".to_string(),
                "bmp".to_string(),
                "tiff".to_string(),
                "tif".to_string(),
            ],
            vec!["image/*".to_string()],
            vec![],
        )
    };

    vec![
        // Word documents - supported by Kreuzberg
        FileCapability::new(
            "word",
            vec!["doc".to_string(), "docx".to_string()],
            vec![
                "application/msword".to_string(),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    .to_string(),
            ],
            vec![FileOperation::ExtractText],
        ),
        // PDF documents - supported by Kreuzberg
        FileCapability::new(
            "pdf",
            vec!["pdf".to_string()],
            vec!["application/pdf".to_string()],
            vec![FileOperation::ExtractText],
        ),
        // Excel spreadsheets - supported by Kreuzberg
        FileCapability::new(
            "excel",
            vec!["xls".to_string(), "xlsx".to_string()],
            vec![
                "application/vnd.ms-excel".to_string(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".to_string(),
            ],
            vec![FileOperation::ExtractText],
        ),
        // PowerPoint presentations - supported by Kreuzberg
        FileCapability::new(
            "powerpoint",
            vec!["ppt".to_string(), "pptx".to_string()],
            vec![
                "application/vnd.ms-powerpoint".to_string(),
                "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                    .to_string(),
            ],
            vec![FileOperation::ExtractText],
        ),
        // Plain text files - supported by Kreuzberg
        FileCapability::new(
            "text",
            vec![
                "txt".to_string(),
                "md".to_string(),
                "markdown".to_string(),
                "json".to_string(),
                "xml".to_string(),
                "csv".to_string(),
                "html".to_string(),
                "htm".to_string(),
            ],
            vec![
                "text/plain".to_string(),
                "text/markdown".to_string(),
                "application/json".to_string(),
                "application/xml".to_string(),
                "text/xml".to_string(),
                "text/csv".to_string(),
                "text/html".to_string(),
            ],
            vec![FileOperation::ExtractText],
        ),
        // Images - depends on model capability
        image_capability,
        // Fallback for unsupported files - always last with lowest priority
        FileCapability::new(
            "other",
            vec!["*".to_string()],
            vec!["*/*".to_string()],
            vec![],
        ),
    ]
}

/// Finds the first matching file capability for a given filename
/// Returns the first capability that matches, with earlier capabilities having higher priority
/// If no extension is found or no capability matches, returns the "other" fallback capability
pub fn find_file_capability_by_filename(
    capabilities: &[FileCapability],
    filename: &str,
) -> FileCapability {
    // Extract file extension
    let mut parts = filename.rsplit('.');
    let extension = match parts.next().filter(|ext| !ext.is_empty()) {
        Some(ext) => ext,
        None => {
            // No extension found, return the fallback
            return FileCapability::new(
                "other",
                vec!["*".to_string()],
                vec!["*/*".to_string()],
                vec![],
            );
        }
    };

    // Find first matching capability
    capabilities
        .iter()
        .find(|cap| cap.matches_extension(extension))
        .cloned()
        .unwrap_or_else(|| {
            FileCapability::new(
                "other",
                vec!["*".to_string()],
                vec!["*/*".to_string()],
                vec![],
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_capability_matches_extension() {
        let cap = FileCapability::new(
            "word",
            vec!["doc".to_string(), "docx".to_string()],
            vec![],
            vec![FileOperation::ExtractText],
        );

        assert!(cap.matches_extension("docx"));
        assert!(cap.matches_extension("DOCX"));
        assert!(cap.matches_extension("doc"));
        assert!(!cap.matches_extension("pdf"));
    }

    #[test]
    fn test_file_capability_matches_mime_type() {
        let cap = FileCapability::new(
            "image",
            vec![],
            vec!["image/*".to_string()],
            vec![FileOperation::AnalyzeImage],
        );

        assert!(cap.matches_mime_type("image/jpeg"));
        assert!(cap.matches_mime_type("image/png"));
        assert!(!cap.matches_mime_type("application/pdf"));
    }

    #[test]
    fn test_file_capability_wildcard() {
        let cap = FileCapability::new(
            "other",
            vec!["*".to_string()],
            vec!["*/*".to_string()],
            vec![],
        );

        assert!(cap.matches_extension("anything"));
        assert!(cap.matches_mime_type("application/pdf"));
    }

    #[test]
    fn test_get_file_capabilities_with_image_support() {
        let caps = get_file_capabilities(true);

        // Should have word, pdf, excel, powerpoint, text, image, and other
        assert!(caps.len() >= 7);

        // Image capability should have AnalyzeImage operation
        let image_cap = caps.iter().find(|c| c.id == "image").unwrap();
        assert!(image_cap.operations.contains(&FileOperation::AnalyzeImage));
    }

    #[test]
    fn test_get_file_capabilities_without_image_support() {
        let caps = get_file_capabilities(false);

        // Image capability should have no operations
        let image_cap = caps.iter().find(|c| c.id == "image").unwrap();
        assert!(image_cap.operations.is_empty());
    }

    #[test]
    fn test_find_file_capability_by_filename() {
        let caps = get_file_capabilities(true);

        // Test Word document
        let cap = find_file_capability_by_filename(&caps, "document.docx");
        assert_eq!(cap.id, "word");

        // Test PDF
        let cap = find_file_capability_by_filename(&caps, "file.pdf");
        assert_eq!(cap.id, "pdf");

        // Test image
        let cap = find_file_capability_by_filename(&caps, "photo.jpg");
        assert_eq!(cap.id, "image");

        // Test unsupported file
        let cap = find_file_capability_by_filename(&caps, "archive.zip");
        assert_eq!(cap.id, "other");
        assert!(cap.operations.is_empty());
    }

    #[test]
    fn test_find_file_capability_priority() {
        let caps = get_file_capabilities(true);

        // Ensure that specific capabilities match before the wildcard
        let cap = find_file_capability_by_filename(&caps, "test.pdf");
        assert_eq!(cap.id, "pdf");
        assert_ne!(cap.id, "other");
    }
}
