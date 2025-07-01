//! Inlined version of the frontend-environment crate (to simplify dependency version alignment)
pub use self::axum::serve_files_with_script;
use crate::config::AppConfig;
use lol_html::html_content::ContentType;
use lol_html::{element, HtmlRewriter, Settings};
use ordered_multimap::ListOrderedMultimap;
use serde::Deserialize;
use serde_json::Value;
use std::fmt::Write;
use std::fs;
use std::io;
use std::path::Path;

const FRONTEND_ENV_KEY_API_ROOT_URL: &str = "API_ROOT_URL";

#[derive(Debug, Clone, Default)]
/// Map of values that will be provided as environment-variable-like global variables to the frontend.
///
/// Values can be injected from AppConfig.frontend.additional_environment, and can be strings or maps (string key, string value).
/// The values are only ordered, so that we have control over whether our keys or the user-provided keys have priority.
/// The values provided by users are not guaranteed to be in the order provided in the config file.
pub struct FrontedEnvironment {
    pub additional_environment: ListOrderedMultimap<String, Value>,
}

pub fn build_frontend_environment(config: &AppConfig) -> FrontedEnvironment {
    let mut env = FrontedEnvironment::default();

    let api_root_url = "/api/".to_string();

    env.additional_environment.insert(
        FRONTEND_ENV_KEY_API_ROOT_URL.to_string(),
        Value::String(api_root_url.clone()),
    );

    // Inject pairs from frontend.additional_environment
    for (key, value) in &config.additional_frontend_environment() {
        env.additional_environment
            .insert(key.clone(), value.clone());
    }

    env
}

#[derive(Debug, Clone)]
pub struct FrontendBundlePath(pub String);

#[derive(Debug, Deserialize)]
struct ServerConfig {
    rewrites: Vec<RewriteRule>,
}

#[derive(Debug, Deserialize)]
struct RewriteRule {
    source: String,
    destination: String,
}

fn load_server_config(bundle_path: String) -> Option<ServerConfig> {
    let config_path = Path::new(&bundle_path).join("serve.json");
    if !config_path.exists() {
        return None;
    }

    match fs::read_to_string(config_path) {
        Ok(contents) => serde_json::from_str(&contents).ok(),
        Err(_) => None,
    }
}

fn matches_rewrite_rule(path: &str, rule: &RewriteRule) -> bool {
    let pattern_parts: Vec<&str> = rule.source.split('/').collect();
    let path_parts: Vec<&str> = path.split('/').collect();

    if pattern_parts.len() != path_parts.len() {
        return false;
    }

    for (pattern, path_part) in pattern_parts.iter().zip(path_parts.iter()) {
        if pattern.starts_with(':') {
            continue; // This is a parameter, it matches anything
        }
        if pattern != path_part {
            return false;
        }
    }
    true
}

/// Rewrites HTML to inject a `<script>` tag (which contains global JS variables that act like environment variables)
/// into the `<head>` tag.
pub fn inject_environment_script_tag(
    input: &[u8],
    output: &mut Vec<u8>,
    frontend_env: &FrontedEnvironment,
) -> io::Result<()> {
    let mut script_tag = String::new();
    script_tag.write_str("<script>\n").unwrap();
    // Writes a line with the content `window.KEY = "VALUE";` for every entry
    for (key, value) in &frontend_env.additional_environment {
        script_tag.write_str("window.").unwrap();
        script_tag.write_str(key).unwrap();
        script_tag.write_str(" = ").unwrap();
        script_tag
            .write_str(&serde_json::to_string(&value)?)
            .unwrap();
        script_tag.write_str(";\n").unwrap();
    }
    script_tag.write_str("</script>").unwrap();

    let mut rewriter = HtmlRewriter::new(
        Settings {
            element_content_handlers: vec![element!("head", |el| {
                el.append(&script_tag, ContentType::Html);
                Ok(())
            })],
            ..Settings::default()
        },
        |c: &[u8]| output.extend_from_slice(c),
    );

    rewriter.write(input).unwrap();
    rewriter.end().unwrap();
    Ok(())
}

pub mod axum {
    use super::*;
    use ::axum::body::{Body, Bytes};

    use ::axum::http::{HeaderValue, Request};
    use ::axum::response::Response;
    use ::axum::{http, BoxError, Extension};
    use http_body_util::combinators::UnsyncBoxBody;
    use http_body_util::BodyExt;
    use std::convert::Infallible;
    use std::path::PathBuf;
    use tower_http::services::{ServeDir, ServeFile};

    /// Static file handler that injects a script tag with environment variables into HTML files.
    pub async fn serve_files_with_script(
        Extension(frontend_environment): Extension<FrontedEnvironment>,
        Extension(frontend_bundle_path): Extension<FrontendBundlePath>,
        req: Request<Body>,
    ) -> Result<Response<UnsyncBoxBody<Bytes, BoxError>>, Infallible> {
        let bundle_dir_path = PathBuf::from(frontend_bundle_path.0.clone())
            .canonicalize()
            .expect("Unable to normalize frontend bundle path");
        let fallback_path = PathBuf::from(frontend_bundle_path.0.clone())
            .join("404.html")
            .canonicalize()
            .expect("Unable to normalize frontend bundle path");

        // Check if we have any rewrite rules that match
        let path = req.uri().path().to_string();
        let rewritten_path =
            if let Some(server_config) = load_server_config(frontend_bundle_path.0.clone()) {
                let matching_rule = server_config
                    .rewrites
                    .iter()
                    .find(|rule| matches_rewrite_rule(&path, rule));
                matching_rule.map(|rule| rule.destination.clone())
            } else {
                None
            };

        // Create the static files service with the rewritten path if applicable
        let res = if let Some(rewritten_path) = rewritten_path {
            let rewritten_file_path = PathBuf::from(frontend_bundle_path.0.clone())
                .join(rewritten_path.trim_start_matches('/'))
                .canonicalize()
                .unwrap();
            ServeFile::new(rewritten_file_path.clone())
                .try_call(req)
                .await
                .unwrap()
        } else {
            ServeDir::new(bundle_dir_path)
                .not_found_service(ServeFile::new(fallback_path))
                .try_call(req)
                .await
                .unwrap()
        };

        // let res = static_files_service.try_call(req).await.unwrap();

        let headers = res.headers().clone();
        if headers.get(http::header::CONTENT_TYPE) == Some(&HeaderValue::from_static("text/html")) {
            let mut res = res.map(move |body| {
                let body_bytes = body.map_err(Into::into).boxed_unsync();
                // Inject variables into HTML files
                body_bytes
                    .map_frame(move |frame| {
                        frame.map_data({
                            let value = frontend_environment.clone();
                            move |bytes| {
                                let mut output = Vec::with_capacity(bytes.len() * 2);
                                inject_environment_script_tag(bytes.as_ref(), &mut output, &value)
                                    .unwrap();
                                output.into()
                            }
                        })
                    })
                    .boxed_unsync()
            });
            // Remove content-length, as we are extending the body, and with the smaller original content-length,
            // some clients stop reading before the end of the response.
            res.headers_mut().remove(http::header::CONTENT_LENGTH);
            // Prevent caching, or otherwise Cache might prevent proper auth.
            res.headers_mut().insert(
                http::header::CACHE_CONTROL,
                HeaderValue::from_static("no-cache, no-store, must-revalidate, private"),
            );
            res.headers_mut()
                .insert(http::header::PRAGMA, HeaderValue::from_static("no-cache"));
            res.headers_mut()
                .insert(http::header::EXPIRES, HeaderValue::from_static("0"));

            Ok(res)
        } else {
            Ok(res.map(|body| body.map_err(Into::into).boxed_unsync()))
        }
    }
}
