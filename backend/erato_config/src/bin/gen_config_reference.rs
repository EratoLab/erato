//! Binary to generate the config reference.
use std::fs;
use std::process;

use erato_config::config_reference::generate_config_reference;
use erato_config_schema::{check_config_reference, config_reference_document};
use eyre::{Result, WrapErr};

fn main() {
    if let Err(error) = run() {
        eprintln!("{error:#}");
        process::exit(1);
    }
}

fn run() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let check_mode = args.iter().any(|arg| arg == "--check");

    // Generation validates effective metadata from the source attributes before
    // either checking or writing a file, including inherited and hidden keys.
    let generated_reference = generate_config_reference()?;
    let generated_doc = config_reference_document(&generated_reference)?;
    let output_path = "./generated/config_reference.json";

    if check_mode {
        let existing_doc = fs::read_to_string(output_path)
            .wrap_err("Could not read config reference. Run without --check to generate it.")?;
        check_config_reference(&existing_doc, &generated_doc)?;
        println!(
            "Config reference is up to date; every key has valid lifecycle and security metadata."
        );
    } else {
        fs::write(output_path, generated_doc).wrap_err("Could not write config reference")?;
        println!("Config reference generated successfully at {}", output_path);
    }
    Ok(())
}
