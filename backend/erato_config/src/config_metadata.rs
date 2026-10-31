//! Lifecycle metadata comes exclusively from facet attributes on config types
//! and fields. Each property inherits independently; child fields override parents.
use eyre::{Result, bail, eyre};
use facet::{Field, Shape};
use serde::{Deserialize, Serialize};

use crate::config_facet_attrs::Attr;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Stability {
    Stable,
    Alpha,
    Beta,
    Unstable,
    Deprecated,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Lifecycle {
    pub stability: Option<Stability>,
    pub introduced_in: Option<String>,
}

impl Lifecycle {
    pub fn for_root(shape: &Shape) -> Result<Self> {
        Self::default().for_attributes(shape.attributes, "")
    }

    pub fn for_field(&self, field: &Field, path: &[String]) -> Result<Self> {
        self.for_attributes(field.attributes, &path.join("."))
    }

    fn for_attributes(&self, attributes: &[facet::Attr], key: &str) -> Result<Self> {
        let mut result = self.clone();
        let mut stability = None;
        let mut introduced_in = None;
        let mut deprecated = false;
        for attr in attributes {
            match attr.get_as::<Attr>() {
                Some(Attr::Stability(value)) => {
                    let level = serde_json::from_value(serde_json::json!(value.level))
                        .map_err(|err| eyre!("Config key '{key}': {err}"))?;
                    select(&mut stability, level, value.under, key, "stability")?;
                }
                Some(Attr::IntroducedIn(value)) => {
                    validate_version(key, value.version)?;
                    select(
                        &mut introduced_in,
                        value.version.to_owned(),
                        value.under,
                        key,
                        "introduced_in",
                    )?;
                }
                Some(Attr::Deprecated(_)) => deprecated = true,
                _ => {}
            }
        }
        if let Some((_, value)) = stability {
            result.stability = Some(value);
        }
        if let Some((_, value)) = introduced_in {
            result.introduced_in = Some(value);
        }
        if deprecated {
            result.stability = Some(Stability::Deprecated);
        }
        Ok(result)
    }
}

// Within one field, a scoped declaration overrides an unscoped declaration,
// independently of attribute order. The most specific matching scope wins.
fn select<T: PartialEq>(
    selected: &mut Option<(usize, T)>,
    value: T,
    under: Option<&str>,
    key: &str,
    property: &str,
) -> Result<()> {
    let specificity = match under {
        Some("") => bail!("Config key '{key}' has an empty {property} scope"),
        Some(prefix) if matches_path(prefix, key) => prefix.split('.').count(),
        Some(_) => return Ok(()),
        None => 0,
    };
    if let Some((existing, previous)) = selected {
        if *existing == specificity && *previous != value {
            bail!("Conflicting {property} attributes for config key '{key}'");
        }
        if *existing >= specificity {
            return Ok(());
        }
    }
    *selected = Some((specificity, value));
    Ok(())
}

fn matches_path(prefix: &str, key: &str) -> bool {
    key == prefix
        || key
            .strip_prefix(prefix)
            .is_some_and(|rest| rest.starts_with('.'))
}

pub(crate) fn validate_version(key: &str, version: &str) -> Result<()> {
    if version != "unreleased" && semver::Version::parse(version).is_err() {
        bail!(
            "Config key '{key}' has invalid introduced_in '{version}'; expected a semantic version or 'unreleased'"
        );
    }
    Ok(())
}
