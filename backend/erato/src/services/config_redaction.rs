use eyre::{Report, eyre};
use toml_edit::{DocumentMut, InlineTable, Item, Table, Value};

pub const REDACTION_MARKER: &str = "<redacted>";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TomlPathSegment<'a> {
    Key(&'a str),
    AnyKey,
}

pub const SERVER_ENCRYPTION_KEY_PATH: [TomlPathSegment<'static>; 2] = [
    TomlPathSegment::Key("server"),
    TomlPathSegment::Key("encryption_key"),
];

pub const RUNTIME_CONFIGURATION_REDACTION_PATHS: [&[TomlPathSegment<'static>]; 1] =
    [&SERVER_ENCRYPTION_KEY_PATH];

pub fn redact_toml_keys(source: &str, paths: &[&[TomlPathSegment<'_>]]) -> Result<String, Report> {
    let mut document = source
        .parse::<DocumentMut>()
        .map_err(|_| eyre!("Failed to parse configuration source for redaction"))?;

    let mut changed = false;
    for path in paths {
        changed |= redact_table(document.as_table_mut(), path);
    }

    if changed {
        Ok(document.to_string())
    } else {
        Ok(source.to_string())
    }
}

fn redact_table(table: &mut Table, path: &[TomlPathSegment<'_>]) -> bool {
    let Some((segment, remaining)) = path.split_first() else {
        return false;
    };

    match segment {
        TomlPathSegment::Key(key) => table
            .get_mut(key)
            .is_some_and(|item| redact_item(item, remaining)),
        TomlPathSegment::AnyKey => {
            let mut changed = false;
            for (_, item) in table.iter_mut() {
                changed |= redact_item(item, remaining);
            }
            changed
        }
    }
}

fn redact_inline_table(table: &mut InlineTable, path: &[TomlPathSegment<'_>]) -> bool {
    let Some((segment, remaining)) = path.split_first() else {
        return false;
    };

    match segment {
        TomlPathSegment::Key(key) => table
            .get_mut(key)
            .is_some_and(|value| redact_value(value, remaining)),
        TomlPathSegment::AnyKey => {
            let mut changed = false;
            for (_, value) in table.iter_mut() {
                changed |= redact_value(value, remaining);
            }
            changed
        }
    }
}

fn redact_item(item: &mut Item, path: &[TomlPathSegment<'_>]) -> bool {
    if path.is_empty() {
        return match item {
            Item::Value(value) => redact_value(value, path),
            Item::None | Item::Table(_) | Item::ArrayOfTables(_) => false,
        };
    }

    match item {
        Item::Value(value) => redact_value(value, path),
        Item::Table(table) => redact_table(table, path),
        Item::ArrayOfTables(tables) => {
            let mut changed = false;
            for table in tables.iter_mut() {
                changed |= redact_table(table, path);
            }
            changed
        }
        Item::None => false,
    }
}

fn redact_value(value: &mut Value, path: &[TomlPathSegment<'_>]) -> bool {
    if path.is_empty() {
        let decor = value.decor().clone();
        *value = Value::from(REDACTION_MARKER);
        *value.decor_mut() = decor;
        return true;
    }

    match value {
        Value::InlineTable(table) => redact_inline_table(table, path),
        Value::Array(array) => {
            let mut changed = false;
            for value in array.iter_mut() {
                changed |= redact_value(value, path);
            }
            changed
        }
        Value::String(_)
        | Value::Integer(_)
        | Value::Float(_)
        | Value::Boolean(_)
        | Value::Datetime(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        REDACTION_MARKER, RUNTIME_CONFIGURATION_REDACTION_PATHS, TomlPathSegment, redact_toml_keys,
    };

    #[test]
    fn leaves_unmatched_document_byte_for_byte_unchanged() {
        let source = "# leading comment\n[server]\nname  =  'erato' # inline comment\n";

        let redacted = redact_toml_keys(source, &RUNTIME_CONFIGURATION_REDACTION_PATHS).unwrap();

        assert_eq!(redacted, source);
    }

    #[test]
    fn redacts_encryption_key_without_reformatting_neighbors() {
        let source = concat!(
            "# leading comment\n",
            "[server]\n",
            "name  =  'erato' # untouched\n",
            "encryption_key = 'super-secret' # keep this comment\n",
            "port = 3130\n",
        );

        let redacted = redact_toml_keys(source, &RUNTIME_CONFIGURATION_REDACTION_PATHS).unwrap();

        assert_eq!(
            redacted,
            concat!(
                "# leading comment\n",
                "[server]\n",
                "name  =  'erato' # untouched\n",
                "encryption_key = \"<redacted>\" # keep this comment\n",
                "port = 3130\n",
            )
        );
        assert!(!redacted.contains("super-secret"));
        assert!(redacted.contains(REDACTION_MARKER));
    }

    #[test]
    fn supports_quoted_and_dotted_keys() {
        let source = "\"server\".\"encryption_key\" = \"super-secret\"\n";

        let redacted = redact_toml_keys(source, &RUNTIME_CONFIGURATION_REDACTION_PATHS).unwrap();

        assert_eq!(redacted, "\"server\".\"encryption_key\" = \"<redacted>\"\n");
    }

    #[test]
    fn supports_wildcard_table_segments_and_inline_tables() {
        const PROVIDER_SECRET: [TomlPathSegment<'static>; 4] = [
            TomlPathSegment::Key("chat_providers"),
            TomlPathSegment::Key("providers"),
            TomlPathSegment::AnyKey,
            TomlPathSegment::Key("api_key"),
        ];
        const STORAGE_SECRET: [TomlPathSegment<'static>; 3] = [
            TomlPathSegment::Key("file_storage_providers"),
            TomlPathSegment::AnyKey,
            TomlPathSegment::Key("secret_access_key"),
        ];
        let source = concat!(
            "[chat_providers.providers.\"primary\"]\n",
            "api_key = \"secret-one\"\n",
            "model_name = \"model\"\n",
            "[chat_providers.providers.secondary]\n",
            "api_key = \"secret-two\"\n",
            "[file_storage_providers]\n",
            "main = { endpoint = \"http://localhost\", secret_access_key = \"secret-three\" }\n",
        );

        let redacted = redact_toml_keys(source, &[&PROVIDER_SECRET, &STORAGE_SECRET]).unwrap();

        assert_eq!(redacted.matches(REDACTION_MARKER).count(), 3);
        assert!(!redacted.contains("secret-one"));
        assert!(!redacted.contains("secret-two"));
        assert!(!redacted.contains("secret-three"));
        assert!(redacted.contains("model_name = \"model\""));
        assert!(redacted.contains("endpoint = \"http://localhost\""));
    }

    #[test]
    fn parse_error_does_not_include_source_contents() {
        let secret = "do-not-leak-this-secret";
        let error = redact_toml_keys(
            &format!("[server\n encryption_key = \"{secret}\""),
            &RUNTIME_CONFIGURATION_REDACTION_PATHS,
        )
        .unwrap_err();

        assert_eq!(
            error.to_string(),
            "Failed to parse configuration source for redaction"
        );
        assert!(!error.to_string().contains(secret));
    }
}
