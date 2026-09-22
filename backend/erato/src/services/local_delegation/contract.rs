//! Validate against the main repository's shared schemas, never a hand-copied contract.
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::LazyLock;

// Generated from desktop-sidecar-protocol, checked by its check:generated command.
// Keep this inside backend/ so container builds need no files outside their context.
static SCHEMAS: LazyLock<BTreeMap<String, jsonschema::Validator>> = LazyLock::new(|| {
    let documents: BTreeMap<String, Value> = serde_json::from_str(include_str!(
        "../../../../generated/local_delegation_schemas.json"
    ))
    .expect("bundled shared schemas");
    documents
        .iter()
        .map(|(name, document)| {
            let resources = documents.values().map(|value| {
                (
                    value["$id"].as_str().unwrap().to_string(),
                    jsonschema::Resource::from_contents(value.clone()).expect("shared resource"),
                )
            });
            (
                name.clone(),
                jsonschema::options()
                    .with_resources(resources)
                    .build(document)
                    .expect("closed shared schema"),
            )
        })
        .collect()
});
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Invalid;
impl std::fmt::Display for Invalid {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Invalid local delegation package")
    }
}
impl std::error::Error for Invalid {}
pub fn validate(kind: &str, value: &Value) -> Result<(), Invalid> {
    SCHEMAS
        .get(kind)
        .filter(|validator| validator.is_valid(value))
        .map(|_| ())
        .ok_or(Invalid)
}
pub fn canonical(value: &Value) -> Result<Vec<u8>, Invalid> {
    fn write(value: &Value, out: &mut Vec<u8>) -> Result<(), Invalid> {
        match value {
            Value::Object(map) => {
                out.push(b'{');
                let sorted: BTreeMap<_, _> = map.iter().collect();
                for (i, (key, value)) in sorted.into_iter().enumerate() {
                    if i > 0 {
                        out.push(b',');
                    }
                    serde_json::to_writer(&mut *out, key).map_err(|_| Invalid)?;
                    out.push(b':');
                    write(value, out)?;
                }
                out.push(b'}');
            }
            Value::Array(values) => {
                out.push(b'[');
                for (i, value) in values.iter().enumerate() {
                    if i > 0 {
                        out.push(b',');
                    }
                    write(value, out)?;
                }
                out.push(b']');
            }
            Value::Number(n) if !n.is_i64() && !n.is_u64() => return Err(Invalid),
            _ => serde_json::to_writer(out, value).map_err(|_| Invalid)?,
        }
        Ok(())
    }
    let mut bytes = Vec::new();
    write(value, &mut bytes)?;
    Ok(bytes)
}
pub fn digest(bytes: &[u8]) -> String {
    format!(
        "sha256:{}",
        Sha256::digest(bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    )
}
pub fn plan_digest(plan: &Value) -> Result<String, Invalid> {
    validate("plan", plan)?;
    Ok(digest(&canonical(plan)?))
}
pub fn manifest_digest(package: &Value) -> Result<String, Invalid> {
    let mut manifest = package.clone();
    manifest
        .as_object_mut()
        .ok_or(Invalid)?
        .remove("manifestDigest");
    for artifact in manifest["artifacts"].as_array_mut().ok_or(Invalid)? {
        artifact
            .as_object_mut()
            .ok_or(Invalid)?
            .remove("contentBase64");
    }
    Ok(digest(&canonical(&manifest)?))
}
/// No content is logged or interpolated into validation errors. Initial execution
/// exports text only; future binary readers must opt in explicitly.
pub fn validate_export(
    package: &Value,
    binding: &Value,
    plan: &Value,
    now: i64,
) -> Result<(), Invalid> {
    validate("approved-export", package)?;
    validate("plan", plan)?;
    if &package["binding"] != binding
        || binding["planDigest"] != plan_digest(plan)?
        || package["expiresAt"] != plan["expiresAt"]
        || package["expiresAt"].as_i64().ok_or(Invalid)? <= now
        || package["approvedAt"].as_i64().ok_or(Invalid)? > now
        || package["manifestDigest"] != manifest_digest(package)?
    {
        return Err(Invalid);
    }
    let artifacts = package["artifacts"].as_array().ok_or(Invalid)?;
    if artifacts.len() as u64 > plan["maxArtifacts"].as_u64().ok_or(Invalid)? {
        return Err(Invalid);
    }
    let mut seen = BTreeSet::new();
    let mut total = 0u64;
    for artifact in artifacts {
        let filename = artifact["filename"].as_str().ok_or(Invalid)?;
        if artifact["mediaType"] != "text/plain"
            || filename.contains(['/', '\\'])
            || filename.chars().any(char::is_control)
            || !seen.insert(artifact["artifactId"].as_str().ok_or(Invalid)?)
        {
            return Err(Invalid);
        }
        let bytes = STANDARD
            .decode(artifact["contentBase64"].as_str().ok_or(Invalid)?)
            .map_err(|_| Invalid)?;
        if artifact["byteLength"] != bytes.len() as u64
            || artifact["sha256"] != digest(&bytes)
            || std::str::from_utf8(&bytes).is_err()
        {
            return Err(Invalid);
        }
        total = total.checked_add(bytes.len() as u64).ok_or(Invalid)?;
    }
    if total > plan["maxBytes"].as_u64().ok_or(Invalid)? {
        return Err(Invalid);
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn fixture() -> (Value, Value, Value) {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../../../desktop-sidecar-protocol/conformance/fixtures/local-delegation.json"
        ))
        .unwrap();
        let plan = fixture["plan"].clone();
        let mut binding = fixture["binding"].clone();
        binding["planDigest"] = json!(plan_digest(&plan).unwrap());
        let text = b"APPROVED fixture";
        let mut package = json!({"binding":binding,"exportId":"e".repeat(43),"snapshotId":"s".repeat(43),"grantId":"g".repeat(43),"approvedAt":100,"expiresAt":plan["expiresAt"],"artifacts":[{"artifactId":"a".repeat(43),"filename":"evidence.txt","mediaType":"text/plain","sha256":digest(text),"byteLength":text.len(),"contentBase64":STANDARD.encode(text)}]});
        package["manifestDigest"] = json!(manifest_digest(&package).unwrap());
        (package, binding, plan)
    }
    #[test]
    fn shared_contract_accepts_exact_package_and_rejects_mutated_content_and_binding() {
        let (package, binding, plan) = fixture();
        assert_eq!(validate_export(&package, &binding, &plan, 101), Ok(()));
        for field in [
            "accountId",
            "deviceId",
            "jobId",
            "attemptId",
            "toolCallId",
            "taskId",
        ] {
            let mut altered = package.clone();
            altered["binding"][field] = json!("wrong".repeat(10));
            altered["manifestDigest"] = json!(manifest_digest(&altered).unwrap());
            assert_eq!(
                validate_export(&altered, &binding, &plan, 101),
                Err(Invalid)
            );
        }
        for change in [
            json!({"contentBase64":STANDARD.encode(b"SECRET_MARKER")}),
            json!({"byteLength":999}),
            json!({"filename":"../escape"}),
            json!({"mediaType":"text/html"}),
        ] {
            let mut altered = package.clone();
            for (key, value) in change.as_object().unwrap() {
                altered["artifacts"][0][key] = value.clone();
            }
            altered["manifestDigest"] = json!(manifest_digest(&altered).unwrap());
            assert_eq!(
                validate_export(&altered, &binding, &plan, 101),
                Err(Invalid)
            );
        }
    }
    #[test]
    fn rejects_duplicates_unknown_fields_expiry_and_budget_overflow() {
        let (package, binding, mut plan) = fixture();
        let mut duplicate = package.clone();
        let artifact = duplicate["artifacts"][0].clone();
        duplicate["artifacts"]
            .as_array_mut()
            .unwrap()
            .push(artifact);
        duplicate["manifestDigest"] = json!(manifest_digest(&duplicate).unwrap());
        assert_eq!(
            validate_export(&duplicate, &binding, &plan, 101),
            Err(Invalid)
        );
        let mut extra = package.clone();
        extra["nativeStatus"] = json!("SECRET_MARKER");
        assert_eq!(validate_export(&extra, &binding, &plan, 101), Err(Invalid));
        assert_eq!(
            validate_export(&package, &binding, &plan, 1800000000),
            Err(Invalid)
        );
        plan["maxBytes"] = json!(1);
        assert_eq!(
            validate_export(&package, &binding, &plan, 101),
            Err(Invalid)
        );
    }
}
