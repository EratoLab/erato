//! Inlined version of the frontend-environment crate (to simplify dependency version alignment)
pub use self::axum::serve_files_with_script;
use lol_html::html_content::ContentType;
use lol_html::{element, HtmlRewriter, Settings};
use ordered_multimap::ListOrderedMultimap;
use serde_json::Value;
use std::collections::HashMap;
use std::fmt::Write;
use std::io;

#[derive(Debug, Clone, Default)]
/// Map of values that will be provided as environment-variable-like global variables to the frontend.
pub struct FrontedEnvironment(pub ListOrderedMultimap<String, Value>);

#[derive(Debug, Clone)]
pub struct FrontendBundlePath(pub String);

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
    for (key, value) in &frontend_env.0 {
        script_tag.write_str("window.").unwrap();
        script_tag.write_str(&key).unwrap();
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
    use ::axum::body::{Body, Bytes, HttpBody};
    use ::axum::http::{HeaderValue, Request};
    use ::axum::response::Response;
    use ::axum::{http, BoxError, Extension};
    use ::axum_extra::headers::HeaderName;
    use http_body_util::combinators::UnsyncBoxBody;
    use http_body_util::BodyExt;
    use std::convert::Infallible;
    use std::path::{Path, PathBuf};
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
        let fallback_path = PathBuf::from(frontend_bundle_path.0)
            .join("404.html")
            .canonicalize()
            .expect("Unable to normalize frontend bundle path");
        let mut static_files_service =
            ServeDir::new(bundle_dir_path).not_found_service(ServeFile::new(fallback_path));

        let res = static_files_service.try_call(req).await.unwrap();

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
                                inject_environment_script_tag(&bytes.as_ref(), &mut output, &value)
                                    .unwrap();
                                output.into()
                            }
                        })
                    })
                    .boxed_unsync()
            });
            res.headers_mut()
                .remove(HeaderName::from_static("content-length"));
            Ok(res)
        } else {
            Ok(res.map(|body| body.map_err(Into::into).boxed_unsync()))
        }
    }
}
