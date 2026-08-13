use axum::Json;
use axum::http::StatusCode;
use std::collections::BTreeMap;
use std::ffi::OsStr;
use std::io;
use std::path::Path;

const LICENSE_NOTICES_DIRECTORY: &str = "/app/sbom";

pub(crate) fn discover_license_notices(directory: &Path) -> io::Result<BTreeMap<String, String>> {
    let entries = match std::fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(BTreeMap::new()),
        Err(error) => return Err(error),
    };

    let mut notices = BTreeMap::new();
    for entry in entries {
        let path = entry?.path();
        if !path.is_file() || path.extension() != Some(OsStr::new("txt")) {
            continue;
        }

        let Some(package_name) = path.file_stem().and_then(OsStr::to_str) else {
            continue;
        };
        notices.insert(package_name.to_owned(), std::fs::read_to_string(path)?);
    }

    Ok(notices)
}

#[utoipa::path(
    get,
    path = "api/licenses",
    responses(
        (status = OK, description = "Combined third-party license notices by distribution package", body = Value, content_type = "application/json"),
        (status = INTERNAL_SERVER_ERROR, description = "Failed to read license notices", body = str)
    )
)]
pub(crate) async fn license_notices() -> Result<Json<BTreeMap<String, String>>, (StatusCode, String)>
{
    discover_license_notices(Path::new(LICENSE_NOTICES_DIRECTORY))
        .map(Json)
        .map_err(|error| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to read license notices: {error}"),
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn discovers_txt_files_by_distribution_package_name() {
        let directory = tempdir().unwrap();
        fs::write(directory.path().join("frontend.txt"), "frontend notices").unwrap();
        fs::write(directory.path().join("backend.txt"), "backend notices").unwrap();
        fs::write(directory.path().join("ignored.json"), "{}").unwrap();
        fs::create_dir(directory.path().join("nested.txt")).unwrap();

        let notices = discover_license_notices(directory.path()).unwrap();

        assert_eq!(
            notices,
            BTreeMap::from([
                ("backend".to_owned(), "backend notices".to_owned()),
                ("frontend".to_owned(), "frontend notices".to_owned()),
            ])
        );
    }

    #[test]
    fn missing_directory_is_empty() {
        let directory = tempdir().unwrap();
        let missing_directory = directory.path().join("missing");

        assert_eq!(
            discover_license_notices(&missing_directory).unwrap(),
            BTreeMap::new()
        );
    }
}
