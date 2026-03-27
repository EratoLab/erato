//! Binary to generate the config reference.
use std::fs;
use std::process;

use erato::config_reference::generate_config_reference;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let check_mode = args.iter().any(|arg| arg == "--check");

    let generated_doc =
        serde_json::to_string_pretty(&generate_config_reference()).expect("config reference JSON");
    let output_path = "./generated/config_reference.json";

    if check_mode {
        match fs::read_to_string(output_path) {
            Ok(existing_doc) => {
                if generated_doc == existing_doc {
                    println!("Config reference is up to date.");
                    process::exit(0);
                } else {
                    println!("Config reference is out of date. Run without --check to update.");
                    process::exit(1);
                }
            }
            Err(_) => {
                println!("Error: Could not read existing config reference file.");
                println!("File may not exist. Run without --check to generate it.");
                process::exit(1);
            }
        }
    } else {
        fs::write(output_path, generated_doc).expect("write config reference output");
        println!("Config reference generated successfully at {}", output_path);
    }
}
