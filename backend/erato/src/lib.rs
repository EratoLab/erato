use utoipa::OpenApi;
use utoipa::openapi::{Info, OpenApiBuilder};

use server::router::MainRouterApiDoc;

use crate::server::router::MAIN_ROUTER_DOC;

pub mod actors;
pub mod config;
pub mod config_facet_attrs;
pub mod config_reference;
pub mod db;
pub mod frontend_environment;
pub mod metrics;
pub mod metrics_constants;
pub mod models;
pub mod normalize_profile;
pub mod policy;
#[cfg(feature = "profiling")]
pub mod profiling;
pub mod query_metrics;
pub mod server;
pub mod services;
pub mod state;
pub mod system_prompt_renderer;
pub mod telemetry;

#[cfg(all(feature = "profiling", not(target_os = "linux")))]
compile_error!("The `profiling` feature is only supported on Linux.");

#[derive(OpenApi)]
#[openapi(
     nest(
         (path = "/", api = MainRouterApiDoc),
     )
 )]
pub struct ApiDoc;

impl ApiDoc {
    pub fn build_openapi_full() -> utoipa::openapi::OpenApi {
        let builder: OpenApiBuilder = Self::openapi().into();
        builder
            .info(Info::builder().description(Some(MAIN_ROUTER_DOC)))
            .build()
    }
}
