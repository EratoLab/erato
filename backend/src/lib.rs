use utoipa::OpenApi;

use server::router::MainRouterApiDoc;

mod db;
mod server;

#[derive(OpenApi)]
#[openapi(
     nest(
         (path = "/", api = MainRouterApiDoc),
     )
 )]
pub struct ApiDoc;
