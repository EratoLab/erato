use utoipa::OpenApi;
use utoipa::openapi::{Info, OpenApiBuilder};

use server::router::MainRouterApiDoc;

use crate::server::router::MAIN_ROUTER_DOC;

pub mod actors;
pub mod config;
pub mod db;
pub mod frontend_environment;
pub mod models;
pub mod normalize_profile;
pub mod policy;
pub mod server;
pub mod services;
pub mod state;

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
