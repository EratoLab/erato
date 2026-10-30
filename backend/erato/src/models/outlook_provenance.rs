//! Persisted source references follow desktop-sidecar-protocol's version 1 contract.
//! These are untrusted navigation hints, never mailbox access grants or launch commands.
//! Rust validation keeps the backend build self-contained. Tests check parity with the
//! canonical protocol schemas and reuse their fixtures; update both when the contract changes.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub const MAX_OUTLOOK_PROVENANCE_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct OutlookFileProvenance {
    /// Contract version. Only version 1 is supported.
    #[schema(minimum = 1, maximum = 1)]
    pub version: u8,
    /// All distinct origins, including multiple containing emails for identical bytes.
    #[schema(min_items = 1)]
    pub origins: Vec<OutlookFileOrigin>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
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
pub struct OutlookExternalId {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
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
        reject_null_optional_fields(&value)?;
        let parsed: Self = serde_json::from_value(value.clone())
            .map_err(|_| "Invalid Outlook provenance structure")?;
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

    /// A provenance already decoded as JSON, under the same rules as [`Self::parse`].
    pub fn from_value(value: &serde_json::Value) -> Result<Self, &'static str> {
        Self::parse(&serde_json::to_vec(value).map_err(|_| "Invalid Outlook provenance JSON")?)
    }

    /// The uploaded document's own message, from the first origin that names one.
    pub fn document(&self) -> Option<&OutlookMessageReference> {
        self.origins
            .iter()
            .find_map(|origin| origin.document.as_ref())
    }

    /// The EWS ID of the document's own message, as uploads record it beside
    /// the provenance.
    pub fn document_ews_id(&self) -> Option<&str> {
        self.document()?
            .external_ids
            .iter()
            .find(|id| id.key == "ews_id")
            .map(|id| id.value.as_str())
    }

    /// What a model may cite: the external identifiers of the document's own
    /// message as `source`, and of every distinct containing message as
    /// `containingMessages`. Catalog UUIDs and mailbox identity stay out, and
    /// a reference known only by a catalog UUID is not cited.
    pub fn citation(&self) -> serde_json::Map<String, serde_json::Value> {
        let identifiers = |reference: &OutlookMessageReference| {
            (!reference.external_ids.is_empty())
                .then(|| serde_json::json!({ "external_ids": reference.external_ids }))
        };
        let mut citation = serde_json::Map::new();
        if let Some(source) = self.document().and_then(identifiers) {
            citation.insert("source".into(), source);
        }
        let mut parents = Vec::new();
        for parent in self
            .origins
            .iter()
            .filter_map(|origin| origin.top_level_parent.as_ref())
            .filter_map(identifiers)
        {
            if !parents.contains(&parent) {
                parents.push(parent);
            }
        }
        if !parents.is_empty() {
            citation.insert(
                "containingMessages".into(),
                serde_json::Value::Array(parents),
            );
        }
        citation
    }
}

fn reject_null_optional_fields(value: &serde_json::Value) -> Result<(), &'static str> {
    fn is_null_at(value: &serde_json::Value, key: &str) -> bool {
        value.get(key).is_some_and(serde_json::Value::is_null)
    }

    if let Some(origins) = value.get("origins").and_then(serde_json::Value::as_array) {
        for origin in origins {
            if is_null_at(origin, "document") || is_null_at(origin, "topLevelParent") {
                return Err("Optional provenance references must be omitted, not null");
            }
            for reference in [origin.get("document"), origin.get("topLevelParent")]
                .into_iter()
                .flatten()
            {
                if is_null_at(reference, "documentId") || is_null_at(reference, "mailbox") {
                    return Err("Optional message reference fields must be omitted, not null");
                }
                if let Some(mailbox) = reference.get("mailbox")
                    && ["mailboxId", "emailAddress", "profileName"]
                        .iter()
                        .any(|key| is_null_at(mailbox, key))
                {
                    return Err("Optional mailbox fields must be omitted, not null");
                }
            }
        }
    }
    Ok(())
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
    fn future_fields_are_ignored_but_explicit_null_is_still_rejected() {
        let value = json!({
            "version": 1,
            "futureEnvelopeField": true,
            "origins": [{
                "futureOriginField": "ignored",
                "document": {
                    "external_ids": [{"key": "ews_id", "value": "Case/Sensitive+Id==", "futureIdField": 2}],
                    "futureReferenceField": true
                }
            }]
        });
        let parsed = OutlookFileProvenance::parse(&serde_json::to_vec(&value).unwrap()).unwrap();
        assert_eq!(parsed.origins.len(), 1);
        assert!(OutlookFileProvenance::parse(
            br#"{"version":1,"origins":[{"document":{"documentId":null,"external_ids":[{"key":"ews_id","value":"Case/Sensitive+Id=="}]}}]}"#
        )
        .is_err());
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

    #[test]
    fn citations_name_identifiers_of_every_origin_and_nothing_local() {
        let reference = |ids: Value, mailbox: bool| {
            let mut reference =
                json!({"documentId": "0f5a8a48-1b2c-4d3e-9f10-a1b2c3d4e5f6", "external_ids": ids});
            if mailbox {
                reference["mailbox"] = json!({"mailboxId": "0123456789abcdef0123456789abcdef", "emailAddress": "owner@example.test"});
            }
            reference
        };
        let own = json!([{"key": "email_message_id", "value": "<inner@example.test>"}, {"key": "ews_id", "value": "AQMk/Inner=="}]);
        let first = json!([{"key": "email_message_id", "value": "<first@example.test>"}]);
        let second = json!([{"key": "email_message_id", "value": "<second@example.test>"}]);
        // Identical bytes in two emails: both containing messages are cited, once each.
        let provenance = OutlookFileProvenance::from_value(&json!({"version": 1, "origins": [
            {"topLevelParent": reference(first.clone(), true)},
            {"document": reference(own.clone(), true), "topLevelParent": reference(second.clone(), false)},
            {"topLevelParent": reference(first.clone(), false)},
        ]}))
        .unwrap();
        assert_eq!(provenance.document_ews_id(), Some("AQMk/Inner=="));
        assert_eq!(
            Value::Object(provenance.citation()),
            json!({
                "source": {"external_ids": own},
                "containingMessages": [{"external_ids": first}, {"external_ids": second}]
            })
        );
        // A message known only by its catalog UUID is stored but not cited.
        let local_only = OutlookFileProvenance::from_value(&json!({"version": 1, "origins": [
            {"document": {"documentId": "0f5a8a48-1b2c-4d3e-9f10-a1b2c3d4e5f6", "external_ids": []}}
        ]}))
        .unwrap();
        assert!(local_only.document_ews_id().is_none());
        assert!(local_only.citation().is_empty());
        assert!(OutlookFileProvenance::from_value(&json!({"version": 2, "origins": []})).is_err());
    }
}
