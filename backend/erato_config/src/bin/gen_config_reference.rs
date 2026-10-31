//! Binary to generate the config reference.
use std::fs;
use std::process;

use erato_config::config_reference::{generate_config_reference, validate_config_reference};
use eyre::{Result, WrapErr, bail};

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
    let generated_doc = format!("{}\n", serde_json::to_string_pretty(&generated_reference)?);
    let output_path = "./generated/config_reference.json";

    if check_mode {
        let existing_doc = fs::read_to_string(output_path)
            .wrap_err("Could not read config reference. Run without --check to generate it.")?;
        check_reference(&existing_doc, &generated_doc)?;
        println!(
            "Config reference is up to date; every key has valid introduced_in and stability metadata."
        );
    } else {
        fs::write(output_path, generated_doc).wrap_err("Could not write config reference")?;
        println!("Config reference generated successfully at {}", output_path);
    }
    Ok(())
}

fn check_reference(existing_doc: &str, generated_doc: &str) -> Result<()> {
    let existing_reference = serde_json::from_str(existing_doc)
        .wrap_err("Invalid JSON in checked-in config reference")?;
    validate_config_reference(&existing_reference)
        .wrap_err("Invalid metadata in checked-in config reference")?;
    if existing_doc != generated_doc {
        bail!("Config reference is out of date. Run without --check to update.");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::check_reference;
    use serde_json::json;

    #[test]
    fn matching_reference_still_requires_both_metadata_properties_on_every_key() {
        for property in ["introduced_in", "stability"] {
            for hidden in [false, true] {
                let mut reference = json!({
                    "valid": {"introduced_in": "0.6.0", "stability": "stable"},
                    "incomplete": {"introduced_in": "unreleased", "stability": "unstable", "hide_in_docs": hidden}
                });
                reference["incomplete"]
                    .as_object_mut()
                    .unwrap()
                    .remove(property);
                let document = serde_json::to_string_pretty(&reference).unwrap();
                let error = format!("{:#}", check_reference(&document, &document).unwrap_err());
                assert!(error.contains("incomplete"), "{error}");
                assert!(error.contains(property), "{error}");
            }
        }
    }

    #[test]
    fn valid_reference_must_also_be_up_to_date() {
        let document = r#"{"example":{"introduced_in":"unreleased","stability":"alpha"}}"#;
        check_reference(document, document).unwrap();
        let error = check_reference(document, &format!("{document}\n")).unwrap_err();
        assert!(error.to_string().contains("out of date"));
    }
}
