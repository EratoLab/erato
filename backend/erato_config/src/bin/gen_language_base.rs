//! Writes the built-in language data the web app ships, so that it works
//! without an injected environment. `--check` fails when the file is stale.
use std::fs;
use std::process;

use erato_config::approval_speech_words::language_base_json;

const OUTPUT_PATH: &str = "../frontend/src/lib/generated/languageBase.json";

fn main() {
    let check_mode = std::env::args().any(|arg| arg == "--check");
    let generated = language_base_json();
    if check_mode {
        match fs::read_to_string(OUTPUT_PATH) {
            Ok(existing) if existing == generated => {
                println!("{OUTPUT_PATH} is up to date.");
            }
            Ok(_) => {
                eprintln!("{OUTPUT_PATH} is stale. Run `just generate_language_base` in backend/.");
                process::exit(1);
            }
            Err(error) => {
                eprintln!("Could not read {OUTPUT_PATH}: {error}");
                process::exit(1);
            }
        }
    } else if let Err(error) = fs::write(OUTPUT_PATH, generated) {
        eprintln!("Could not write {OUTPUT_PATH}: {error}");
        process::exit(1);
    } else {
        println!("Language base generated at {OUTPUT_PATH}");
    }
}
