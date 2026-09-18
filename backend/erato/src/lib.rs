use utoipa::OpenApi;
use utoipa::openapi::{Info, OpenApiBuilder};

use server::router::MainRouterApiDoc;

use crate::server::router::MAIN_ROUTER_DOC;

pub mod actors;
pub use erato_config::config;
pub use erato_config::config_facet_attrs;
pub use erato_config::config_reference;
pub mod db;
pub mod deployment_identity;
pub mod distribution;
pub mod frontend_environment;
pub mod latency;
pub mod metrics;
pub mod metrics_constants;
pub mod models;
pub mod normalize_profile;
pub mod policy;
#[cfg(feature = "profiling")]
pub mod profiling;
pub mod query_metrics;
pub mod server;
/// The request principal, re-exported for the integration test crate.
///
/// `server::api` stays `pub(crate)`: only this one type needs to cross the
/// crate boundary, because a test that drives server-initiated work — a task
/// result delivering itself into a chat — has to supply the identity such work
/// runs under, and there is no request to take it from.
#[doc(hidden)]
pub use crate::server::api::v1beta::me_profile_middleware::{MeProfile, UserProfile};
pub mod services;
pub use erato_config::startup_log;
pub mod state;
pub mod telemetry;
pub mod translation_po;

#[cfg(all(feature = "profiling", not(target_os = "linux")))]
compile_error!("The `profiling` feature is only supported on Linux.");

#[cfg(all(feature = "profiling", feature = "profiling-dial9"))]
compile_error!("The `profiling` and `profiling-dial9` features are mutually exclusive.");

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
