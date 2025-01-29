use std::fs;

use backend::ApiDoc;

fn main() {
    let doc = ApiDoc::build_openapi_full().to_pretty_json().unwrap();
    fs::write("./generated/openapi.json", doc).unwrap();
}
