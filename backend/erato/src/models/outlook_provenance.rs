//! Persisted source references follow desktop-sidecar-protocol's version 1 contract.
//! These are untrusted navigation hints, never mailbox access grants or launch commands.
//! Rust validation keeps the backend build self-contained. Tests check parity with the
//! canonical protocol schemas and reuse their fixtures; update both when the contract changes.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub const MAX_OUTLOOK_PROVENANCE_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct OutlookFileProvenance {
    /// Contract version. Only version 1 is supported.
    #[schema(minimum = 1, maximum = 1)]
    pub version: u8,
    /// All distinct origins, including multiple containing emails for identical bytes.
    #[schema(min_items = 1)]
    pub origins: Vec<OutlookFileOrigin>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OutlookFileOrigin {
    /// The uploaded email's own identity; a thread export identifies only its anchor.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub document: Option<OutlookMessageReference>,
    /// The outermost containing mailbox message, separate from the document's identity.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub top_level_parent: Option<OutlookMessageReference>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct OutlookMessageReference {
    /// Local catalog UUID, scoped to its originating sidecar installation.
    #[serde(rename = "documentId", skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub document_id: Option<String>,
    pub external_ids: Vec<OutlookExternalId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub mailbox: Option<OutlookMailboxReference>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct OutlookExternalId {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OutlookMailboxReference {
    /// Local mailbox ID, never a Graph mailbox identifier.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub mailbox_id: Option<String>,
    /// SMTP address of the owning mailbox, including shared mailboxes.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub email_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub profile_name: Option<String>,
}

impl OutlookFileProvenance {
    pub fn parse(bytes: &[u8]) -> Result<Self, &'static str> {
        if bytes.len() > MAX_OUTLOOK_PROVENANCE_BYTES {
            return Err("Outlook provenance exceeds 64 KiB");
        }
        let value: serde_json::Value =
            serde_json::from_slice(bytes).map_err(|_| "Invalid Outlook provenance JSON")?;
        let parsed: Self = serde_json::from_value(value.clone())
            .map_err(|_| "Invalid Outlook provenance structure")?;
        // Serde treats null optional fields as absent; the protocol disallows null.
        // Comparing also ensures nothing in the supplied identity was silently dropped.
        if serde_json::to_value(&parsed).map_err(|_| "Invalid Outlook provenance")? != value {
            return Err("Outlook provenance must omit unknown optional fields, not use null");
        }
        if parsed.version != 1 || parsed.origins.is_empty() {
            return Err("Unsupported or empty Outlook provenance");
        }
        for origin in &parsed.origins {
            if origin.document.is_none() && origin.top_level_parent.is_none() {
                return Err("An Outlook origin requires a message reference");
            }
            for reference in [&origin.document, &origin.top_level_parent]
                .into_iter()
                .flatten()
            {
                reference.validate()?;
            }
        }
        Ok(parsed)
    }
}

impl OutlookMessageReference {
    fn validate(&self) -> Result<(), &'static str> {
        if self.document_id.is_none() && self.external_ids.is_empty() {
            return Err("An Outlook reference requires an identity");
        }
        if let Some(id) = &self.document_id
            && !is_uuid(id)
        {
            return Err("Invalid Outlook catalog UUID");
        }
        for id in &self.external_ids {
            if id.key.is_empty() || id.value.is_empty() {
                return Err("Empty Outlook identifier");
            }
            if matches!(id.key.as_str(), "outlook_entry_id" | "outlook_store_id")
                && (id.value.len() % 2 != 0 || !id.value.bytes().all(|b| b.is_ascii_hexdigit()))
            {
                return Err("Native Outlook IDs must contain complete hexadecimal bytes");
            }
        }
        if let Some(mailbox) = &self.mailbox {
            if mailbox.mailbox_id.is_none() && mailbox.email_address.is_none() {
                return Err("A profile name alone cannot identify a mailbox");
            }
            if let Some(id) = &mailbox.mailbox_id {
                let lower_hex = id
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
                if !(id.len() == 32 && lower_hex || is_uuid(id) && *id == id.to_lowercase()) {
                    return Err("Invalid local Outlook mailbox ID");
                }
            }
            for text in [&mailbox.email_address, &mailbox.profile_name]
                .into_iter()
                .flatten()
            {
                if text.trim().is_empty() || text.chars().count() > 1024 {
                    return Err("Invalid Outlook mailbox context");
                }
            }
        }
        Ok(())
    }
}

fn is_uuid(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(i, b)| match i {
            8 | 13 | 18 | 23 => b == b'-',
            _ => b.is_ascii_hexdigit(),
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn protocol_validator() -> jsonschema::Validator {
        let schemas = [
            include_str!(
                "../../../../desktop-sidecar-protocol/schemas/outlook/file-provenance.schema.json"
            ),
            include_str!(
                "../../../../desktop-sidecar-protocol/schemas/outlook/message-reference.schema.json"
            ),
            include_str!(
                "../../../../desktop-sidecar-protocol/schemas/outlook/mailbox-reference.schema.json"
            ),
            include_str!(
                "../../../../desktop-sidecar-protocol/schemas/source/external-ids.schema.json"
            ),
        ]
        .map(|schema| serde_json::from_str::<Value>(schema).unwrap());
        jsonschema::options()
            .should_validate_formats(true)
            .with_resources(schemas.iter().map(|schema| {
                (
                    schema["$id"].as_str().unwrap().to_owned(),
                    jsonschema::Resource::from_contents(schema.clone()).unwrap(),
                )
            }))
            .build(&schemas[0])
            .unwrap()
    }

    #[test]
    fn shared_protocol_fixtures_roundtrip_without_losing_identity() {
        let fixtures: Value = serde_json::from_str(include_str!(
            "../../../../desktop-sidecar-protocol/conformance/fixtures/outlook-file-provenance.json"
        ))
        .unwrap();
        let validator = protocol_validator();
        for fixture in fixtures["valid"].as_array().unwrap() {
            let value = &fixture["value"];
            assert!(validator.is_valid(value), "{}", fixture["name"]);
            let parsed = OutlookFileProvenance::parse(&serde_json::to_vec(value).unwrap()).unwrap();
            assert_eq!(
                serde_json::to_value(parsed).unwrap(),
                *value,
                "{}",
                fixture["name"]
            );
        }
    }

    #[test]
    fn invalid_references_are_rejected_by_both_backend_and_protocol() {
        let document = json!({"external_ids": [{"key": "ews_id", "value": "Case/Sensitive+Id=="}]});
        let mut invalid = vec![
            json!({}),
            json!({"version": 2, "origins": [{"document": document}]}),
            json!({"version": 1, "origins": []}),
            json!({"version": 1, "origins": [{}]}),
            json!({"version": 1, "origins": [{"topLevelParent": null}]}),
            json!({"version": 1, "origins": [{"document": {"external_ids": []}}]}),
            json!({"version": 1, "origins": [{"document": document, "launchUrl": "outlook:untrusted"}]}),
        ];
        for mailbox in [
            json!({}),
            json!({"profileName": "Work"}),
            json!({"emailAddress": " "}),
            json!({"mailboxId": "local-node"}),
            json!(null),
        ] {
            let mut reference = document.clone();
            reference["mailbox"] = mailbox;
            invalid.push(json!({"version": 1, "origins": [{"document": reference}]}));
        }
        for key in ["outlook_entry_id", "outlook_store_id"] {
            for value in ["", "ABC", "EWS/Id==", "00 11", "00\" /select other"] {
                invalid.push(json!({"version": 1, "origins": [{"document": {"external_ids": [{"key": key, "value": value}]}}]}));
            }
        }
        let validator = protocol_validator();
        for value in invalid {
            assert!(!validator.is_valid(&value), "{value}");
            assert!(
                OutlookFileProvenance::parse(&serde_json::to_vec(&value).unwrap()).is_err(),
                "{value}"
            );
        }
    }

    #[test]
    fn bounds_metadata_before_parsing() {
        assert!(OutlookFileProvenance::parse(b"not json").is_err());
        let oversized = vec![b' '; MAX_OUTLOOK_PROVENANCE_BYTES + 1];
        assert!(OutlookFileProvenance::parse(&oversized).is_err());
    }
}
