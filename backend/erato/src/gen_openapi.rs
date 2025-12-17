//! Binary to generate the OpenAPI spec
use std::fs;
use std::process;

use erato::ApiDoc;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let check_mode = args.iter().any(|arg| arg == "--check");

    let generated_doc = ApiDoc::build_openapi_full().to_pretty_json().unwrap();
    let output_path = "./generated/openapi.json";

    if check_mode {
        // Check if the file exists
        match fs::read_to_string(output_path) {
            Ok(existing_doc) => {
                if generated_doc == existing_doc {
                    println!("OpenAPI documentation is up to date.");
                    process::exit(0);
                } else {
                    println!(
                        "OpenAPI documentation is out of date. Run without --check to update."
                    );
                    process::exit(1);
                }
            }
            Err(_) => {
                println!("Error: Could not read existing OpenAPI documentation file.");
                println!("File may not exist. Run without --check to generate it.");
                process::exit(1);
            }
        }
    } else {
        // Normal mode: write the generated doc to file
        fs::write(output_path, generated_doc).unwrap();
        println!(
            "OpenAPI documentation generated successfully at {}",
            output_path
        );
    }
}
