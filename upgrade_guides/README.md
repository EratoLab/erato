# Upgrade guides

Detailed before/after migration examples for configuration changes introduced
in each Erato release. These guides supplement `CHANGELOG.md`'s "Deprecations
and upgrade notes" section with concrete `erato.toml` snippets; the CHANGELOG
remains the authoritative, concise summary.

Each release gets one file, named `<from>_to_<to>.md`, with a table of
contents at the top covering:

- **Deprecations and breaking configuration changes** — config keys renamed,
  moved, or removed, with their replacement and any grace period.
- **New configuration worth adopting** — optional new config surfaces worth
  deliberately adopting (not required for upgrading, but relevant to
  deployments that want the new feature).

## Releases

- [0.6.2 to 0.7.0](0_6_2_to_0_7_0.md)
