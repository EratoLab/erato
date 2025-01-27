use std::fs;

use utoipa::OpenApi;

use backend::ApiDoc;

fn main() {
    let doc = ApiDoc::openapi().to_pretty_json().unwrap();
    fs::write("./generated/openapi.json", doc).unwrap();
}
