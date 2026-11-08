# Desktop sidecar artifact distribution contract

This document is the authoritative contract for discovering and serving Erato
desktop-sidecar artifacts from the backend filesystem. The terms MUST, MUST NOT,
REQUIRED, SHOULD, SHOULD NOT, and MAY are interpreted as described by BCP 14.

This contract covers the artifact root, target and file discovery, backend
validation, and deployment replacement. It also defines the bootstrap-policy convention
used when the backend personalizes a Windows or macOS artifact. Signing artifacts and
establishing their integrity are responsibilities of the build and deployment
pipeline, not fields in the distribution manifest.

## 1. One unversioned artifact set

The configured artifact directory represents exactly one deployed artifact
set. The production default is `/app/desktop-sidecar-artifacts`; the backend
MUST allow that root to be configured.

The root has no releases, channels, or release-version hierarchy. Package or
product versions MUST NOT be encoded in directory names, source basenames, or
download filenames. Deployments replace the complete artifact set instead of
adding a version directory or mutating individual files in place.

Exactly one manifest exists at `<artifact-root>/manifest.json`. There are no
per-target manifests. The root manifest describes every target and every file
that the backend may distribute from the deployed set.

The current layout is:

```text
/app/desktop-sidecar-artifacts/
├── manifest.json
└── targets/
    ├── windows-x86_64/
    │   ├── erato-desktop-sidecar.exe
    │   └── erato-desktop-sidecar.msi
    ├── macos-x86_64/
    │   └── erato-desktop-sidecar.app.zip
    ├── macos-aarch64/
    │   └── erato-desktop-sidecar.app.zip
    ├── linux-x86_64-gnu/
    │   ├── erato-desktop-sidecar
    │   └── erato-desktop-sidecar.tar.gz
    └── linux-aarch64-gnu/
        ├── erato-desktop-sidecar
        └── erato-desktop-sidecar.tar.gz
```

Source basenames remain stable across deployments. Every declared artifact is
a regular file. In particular, a macOS application bundle is stored as an
archive rather than a directory tree. macOS and Linux archives MAY be used to
preserve executable permission bits that would otherwise be lost during
distribution.

New targets, such as Linux musl or macOS universal2, MAY be added as new
directories below `targets/` and new root-manifest entries without changing the
root layout.

## 2. Canonical target vocabulary

The current target IDs and platform values are:

| Target ID           | OS        | Architecture | ABI      |
| ------------------- | --------- | ------------ | -------- |
| `windows-x86_64`    | `windows` | `x86_64`     | `msvc`   |
| `macos-x86_64`      | `macos`   | `x86_64`     | `darwin` |
| `macos-aarch64`     | `macos`   | `aarch64`    | `darwin` |
| `linux-x86_64-gnu`  | `linux`   | `x86_64`     | `gnu`    |
| `linux-aarch64-gnu` | `linux`   | `aarch64`    | `gnu`    |

An API boundary MAY accept aliases such as `amd64` or `arm64`, but it MUST
normalize them before target selection. Directory names, manifest target IDs,
and manifest platform values MUST use the canonical vocabulary above.

## 3. Root manifest

`manifest.json` is a JSON object with one `targets` array. The following
manifest completely describes the five-target filesystem example in Section 1:

```json
{
  "targets": [
    {
      "id": "windows-x86_64",
      "platform": {
        "os": "windows",
        "architecture": "x86_64",
        "abi": "msvc"
      },
      "default_file": "executable",
      "files": [
        {
          "id": "executable",
          "kind": "executable",
          "path": "targets/windows-x86_64/erato-desktop-sidecar.exe",
          "download_filename": "erato-desktop-sidecar-windows-x86_64.exe",
          "media_type": "application/vnd.microsoft.portable-executable"
        },
        {
          "id": "installer",
          "kind": "installer",
          "path": "targets/windows-x86_64/erato-desktop-sidecar.msi",
          "download_filename": "erato-desktop-sidecar-windows-x86_64.msi",
          "media_type": "application/x-msi"
        }
      ]
    },
    {
      "id": "macos-x86_64",
      "platform": {
        "os": "macos",
        "architecture": "x86_64",
        "abi": "darwin"
      },
      "default_file": "application",
      "files": [
        {
          "id": "application",
          "kind": "application_archive",
          "path": "targets/macos-x86_64/erato-desktop-sidecar.app.zip",
          "download_filename": "erato-desktop-sidecar-macos-x86_64.app.zip",
          "media_type": "application/zip"
        }
      ]
    },
    {
      "id": "macos-aarch64",
      "platform": {
        "os": "macos",
        "architecture": "aarch64",
        "abi": "darwin"
      },
      "default_file": "application",
      "files": [
        {
          "id": "application",
          "kind": "application_archive",
          "path": "targets/macos-aarch64/erato-desktop-sidecar.app.zip",
          "download_filename": "erato-desktop-sidecar-macos-aarch64.app.zip",
          "media_type": "application/zip"
        }
      ]
    },
    {
      "id": "linux-x86_64-gnu",
      "platform": {
        "os": "linux",
        "architecture": "x86_64",
        "abi": "gnu"
      },
      "default_file": "archive",
      "files": [
        {
          "id": "executable",
          "kind": "executable",
          "path": "targets/linux-x86_64-gnu/erato-desktop-sidecar",
          "download_filename": "erato-desktop-sidecar-linux-x86_64",
          "media_type": "application/octet-stream"
        },
        {
          "id": "archive",
          "kind": "archive",
          "path": "targets/linux-x86_64-gnu/erato-desktop-sidecar.tar.gz",
          "download_filename": "erato-desktop-sidecar-linux-x86_64.tar.gz",
          "media_type": "application/gzip"
        }
      ]
    },
    {
      "id": "linux-aarch64-gnu",
      "platform": {
        "os": "linux",
        "architecture": "aarch64",
        "abi": "gnu"
      },
      "default_file": "archive",
      "files": [
        {
          "id": "executable",
          "kind": "executable",
          "path": "targets/linux-aarch64-gnu/erato-desktop-sidecar",
          "download_filename": "erato-desktop-sidecar-linux-aarch64",
          "media_type": "application/octet-stream"
        },
        {
          "id": "archive",
          "kind": "archive",
          "path": "targets/linux-aarch64-gnu/erato-desktop-sidecar.tar.gz",
          "download_filename": "erato-desktop-sidecar-linux-aarch64.tar.gz",
          "media_type": "application/gzip"
        }
      ]
    }
  ]
}
```

### Target fields

- `id` is the unique canonical target identifier.
- `platform.os` is the operating system identifier.
- `platform.architecture` is the CPU architecture.
- `platform.abi` is the relevant ABI or runtime family.
- `default_file` is the file ID selected when a request does not specify one.
- `files` lists every file available for this target.

### File fields

- `id` is unique within its target.
- `kind` is the semantic file kind. Initial values are `executable`,
  `installer`, `application_archive`, and `archive`.
- `path` is a path relative to the configured artifact root.
- `download_filename` is the filename presented to the client, for example in
  `Content-Disposition`.
- `media_type` is the HTTP response media type.

The backend obtains source artifact sizes from filesystem metadata. For
unmodified downloads that size is also the response `Content-Length`.
Personalized downloads MUST use the actual personalized output length instead;
distribution metadata continues to report the source template size.

### Desktop UI entry

The manifest MAY carry one top-level `ui` object beside `targets`, naming the
desktop UI package archive the artifact set ships ([Section 8](#8-desktop-ui-package)):

```json
{
  "targets": [],
  "ui": {
    "path": "ui/erato-desktop-ui-0.1.0.tgz",
    "version": "0.1.0"
  }
}
```

- `path` is relative to the artifact root and MUST be `ui/<file>.tgz`.
- `version` MUST equal the `version` of the archive's `package/manifest.json`.

A manifest without `ui` describes an artifact set without a desktop UI
package; the backend then serves no package and clients send no `ui_package`.
As for every other field, consumers ignore unknown manifest fields.

## 4. Backend interpretation and validation

The backend MUST load and validate the complete artifact set before making it
available:

1. Read the single root `manifest.json` at startup or during an explicit
   reload.
2. Reject duplicate target IDs and duplicate file IDs within a target.
3. Require each target's `default_file` to reference a file declared by that
   target.
4. Accept only relative file paths that remain beneath the configured artifact
   root.
5. Reject absolute paths, `.` or `..` traversal components, symlinks in any
   path component, and any declared artifact that is not a regular file.
6. Require every declared file to exist and be readable.
7. Ignore files present on disk but absent from the manifest.
8. Select targets and files only by manifest ID. Request values are identifiers
   and MUST NOT be interpreted as filesystem paths.
9. Obtain file size from filesystem metadata rather than the manifest.
10. Keep HTTP/API routing independent from the physical directory layout.

Failure of any validation requirement rejects the artifact set; the backend
MUST NOT expose a partially valid manifest. Path containment MUST be checked
after resolving paths relative to the configured root, without following
symlinks outside or within that root.

An API may expose selection independently from the filesystem, for example:

```text
GET /api/v1beta/desktop-sidecar/download?target=windows-x86_64&file=executable
```

When `file` is omitted, the backend selects the target's `default_file`. API
route names and query parameters are illustrative and are not fixed by this
filesystem contract.

## 5. Deployment contract

Because there is no versioning layer in the directory structure, the complete
artifact root is one deployment unit:

- Individual binaries MUST NOT be replaced in place while a backend may be
  serving them.
- Deployment tooling MUST assemble and validate a complete directory before it
  is mounted or atomically swapped into place.
- Backend processes MUST be restarted or explicitly reloaded after replacement
  so manifest metadata and open file handles refer to the same artifact set.
- The artifact root MUST be mounted read-only in production.
- Every backend replica MUST observe the same artifact snapshot.
- Personalized output MUST be constructed in memory or streamed and MUST NOT be
  written into the artifact root.
- Generated platform binaries MUST NOT be committed to the main repository.

The build and deployment pipeline remains responsible for signing artifacts,
verifying artifact integrity, and consistently replacing the complete set.
Omitting signing, checksum, and size fields from `manifest.json` does not remove
those pipeline responsibilities.

The default backend configuration is equivalent to:

```toml
[desktop_sidecar.distribution]
directory = "/app/desktop-sidecar-artifacts"
```

The configuration may select another root without changing manifest paths,
target IDs, download filenames, or API routing.

## 6. Organization bootstrap personalization

A backend MAY personalize a Windows or macOS download with a single immutable
organization bootstrap document. The document configures policy needed before
the sidecar accepts browser requests. It can also contain the TLS server identity
used by the loopback HTTPS listener. It is not user preferences or enrollment
state. A TLS-personalized artifact contains a private key and MUST be handled
as secret material; the issuing CA private key MUST never be injected.

The bootstrap document is UTF-8 JSON with this versioned, extensible shape:

```json
{
  "version": 1,
  "organization_configuration": {
    "allowed_origins": ["https://app.example.test"]
  },
  "port": 23124,
  "directory_suffix": "-staging",
  "display_name": "Erato Staging",
  "tls": {
    "certificate_pem": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n",
    "private_key_pem": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
  }
}
```

`version` is required and currently MUST be `1`. Both the root object and
`organization_configuration` are extensible: consumers MUST ignore fields they
do not understand. `organization_configuration.allowed_origins` is required
and is an array of normalized, non-loopback origins. Each entry MUST be an
exact lowercase `http` or `https` `scheme://host[:non-default-port]` origin,
with no userinfo, path, query, fragment, wildcard, or trailing slash. An empty array is valid and
refuses every production browser request.

The bootstrap policy takes precedence over every user-writable configuration
file. In particular, `sidecar.configure.v1` and files in a user's platform
configuration directory MUST NOT add or replace production allowed origins.
Development origins remain an explicit local development-mode option.

The optional root installation fields are:

| Field              | Contract                                                                                    | Default               |
| ------------------ | ------------------------------------------------------------------------------------------- | --------------------- |
| `port`             | Integer from 1 to 65535                                                                     | 23123                 |
| `directory_suffix` | At most 64 ASCII letters, digits, hyphens or underscores; appended literally                | Empty                 |
| `display_name`     | Nonempty string, at most 128 UTF-8 bytes, no control characters                             | Erato Desktop Sidecar |
| `icon`             | Standard base64 PNG (no data URL prefix), 1–256 pixels per dimension, at most 1 MiB encoded | Bundled tray icon     |
| `mode`             | `strict` or `standard`; strict mode as [DELEGATION.md](./DELEGATION.md) defines it          | `standard`            |

Binaries built before package 0.1.44 ignore `mode`, as bootstrap version 1
ignores unknown fields, and would run in standard mode. A strict deployment
MUST distribute only binaries from package 0.1.44 or later; the distribution
manifest does not record a binary's package version, so nothing enforces this.

Present invalid fields MUST be rejected before registering desktop integration or
opening a listener. User configuration MUST NOT override these fields. Explicit
local development `--port` and `ERATO_DESKTOP_SIDECAR_ADDRESS` overrides remain
supported (CLI takes precedence, then environment, then bootstrap).

Set the corresponding `[desktop_sidecar]` backend keys to personalize downloads.
The same port and TLS configuration generate the web and Office add-in runtime
`DESKTOP_SIDECAR_URL`; an explicit port overrides the legacy additional-environment
URL. The complete Windows executable bootstrap, including icon and TLS, MUST fit
the 524262-byte payload capacity; distribution loading rejects overflow.
MSI and macOS bootstrap files do not have this executable-slot limit.

The suffix scopes the Windows `%APPDATA%/Erato Labs/Erato Desktop Sidecar`, macOS
`~/Library/Application Support/com.eratolabs.erato-desktop-sidecar`, and Linux
`$XDG_CONFIG_HOME/erato-desktop-sidecar` directories. It also scopes Windows Run
values, macOS LaunchAgent filenames and labels, and Linux desktop/autostart files.
The shared Outlook data directories remain owned by Outlook.

The optional root `tls` object contains two required, nonempty strings:
`certificate_pem` is a PEM certificate chain, leaf first; `private_key_pem` is
its matching unencrypted PEM private key (PKCS#8, PKCS#1, or SEC1 as supported by
the TLS implementation). The example above abbreviates the PEM bodies. The leaf
MUST be valid for TLS server authentication and include the `127.0.0.1` IP subject
alternative name. The issuing CA must already be trusted by the browser/OS;
shipping certificates in bootstrap data does not install trust.

When `tls` is absent, the sidecar MAY use explicit development certificate/key
files or serve HTTP. When present, it MUST serve HTTPS automatically, including
autorun and restart, and MUST reject malformed PEM, incomplete identities, and
certificate/key mismatches before opening its listener. A present invalid
identity MUST NOT fall back to HTTP or another bootstrap source. Development
certificate/key flags conflict with a bootstrap identity and MUST be rejected.
User configuration and `sidecar.configure.v1` MUST NOT override or expose the
bootstrap TLS identity. Bootstrap contents and private keys MUST NOT appear in
logs, debug output, RPC responses, or public distribution metadata.

A backend can provide a fixed certificate/key pair or issue a fresh leaf/key
pair during each download's bootstrap injection. In the latter mode it MUST
validate the intermediate CA certificate and matching signing key, generate a
fresh leaf key, restrict the leaf to server authentication, and cap its validity
at the issuer's expiration. The injected certificate chain includes the
intermediate(s), while the CA private key remains exclusively on the backend.
The reference backend issues P-256 leaves for `127.0.0.1`, `::1`, and `localhost`,
with a default 365-day lifetime and up to five minutes of clock-skew allowance,
bounded by the chain's validity. This provisions keys per download, not per
device: copies of the same artifact share the injected identity. Renewal requires
new bootstrap data; no enrollment or automatic renewal is defined here.

A `bootstrap.json` beside the executable takes precedence over the embedded
Windows slot. The backend automatically injects it into Windows MSI and macOS
application downloads; the macOS file lives inside the downloaded `.app` bundle.
Linux installers can supply this file separately.

### 6.1 Windows executable personalization

The Windows executable template contains exactly one file-backed, non-executable
`.erato` section with a 512 KiB (524288-byte) slot. Its bytes are:

| Offset | Length | Value                                                |
| ------ | ------ | ---------------------------------------------------- |
| 0      | 16     | ASCII magic `ERATO_BOOTSTRAP!`                       |
| 16     | 2      | Little-endian format version (`1`)                   |
| 18     | 4      | Little-endian JSON payload length                    |
| 22     | 4      | Little-endian payload capacity (`524262`)            |
| 26     | 524262 | UTF-8 bootstrap JSON followed by ASCII space padding |

A personalizer MUST parse the PE section table, find exactly one `.erato`
section, then find the magic exactly once inside that section. It MUST validate
the template header, replace the complete 524288-byte slot, and reject an
oversized document, including the JSON-escaped PEM strings. The complete JSON
must fit within 524262 UTF-8 bytes; larger documents require an MSI/external
bootstrap file. It MUST NOT truncate PEM, replace a JSON substring, or append an
EOF trailer. The sidecar validates the
header, version, length, JSON, origin policy, and TLS identity before opening its
browser listener. A template slot with a zero length is an unpersonalized
artifact and has an empty, fail-closed allowlist.

### 6.2 Windows MSI personalization

The x86_64 Windows MSI contains a normal `bootstrap.json` file beside
`erato-desktop-sidecar.exe`. WiX places that file in its own embedded
`bootstrap.cab` stream (with the `OrganizationBootstrapFile` identifier),
separate from the executable cabinet. A personalizer replaces only that CAB
stream and updates the corresponding `File.FileSize` value; it MUST NOT
recompress or byte-patch the executable cabinet. The MSI template is built
with the same document supplied to the WiX `BootstrapConfiguration`
preprocessor variable. On startup, the sidecar reads this installed file before
its embedded slot, so the MSI and standalone forms implement the same policy
with no post-install user action.

A personalizer MAY build one artifact per organization policy revision and
target. Artifacts emitted together for a single personalization MUST use the
same bootstrap document. Separately requested downloads MAY receive different
TLS leaf identities while retaining the same organization policy. It MUST read
each output back and verify the exact bootstrap bytes before signing or
publishing it. Personalized output
MUST remain in memory or temporary deployment storage and MUST NOT be written
into the immutable artifact root.

### 6.3 macOS application personalization

For both `macos-x86_64` and `macos-aarch64`, the backend personalizes the
`application_archive` (`.app.zip`) during each download. It adds or replaces
exactly one entry:

```text
erato-desktop-sidecar.app/Contents/Resources/bootstrap.json
```

This entry contains the same bootstrap document used by the Windows transports,
including the immutable allowed origins and optional TLS certificate/key. Fixed
TLS values are copied; intermediate-CA mode issues a fresh identity per download.
The executable-slot capacity does not limit the ZIP bootstrap entry.

The user extracts and installs the application normally. The bootstrap stays
inside the `.app` at `Contents/Resources/bootstrap.json`, where the startup
loader reads it automatically. Resources take precedence over the legacy adjacent
bootstrap location; malformed resources fail startup without falling back. The
JSON MUST live in Resources because macOS signing treats Contents/MacOS entries
as executable code. No separate file placement or TLS flags are needed.
Trusting the issuing CA remains a deployment prerequisite.

The reference backend accepts the canonical unsealed bundle template containing
`Contents/Info.plist` and `Contents/MacOS/erato-desktop-sidecar`, with an optional
existing bootstrap entry. It rejects other layouts, symlinks, non-executable
binaries, and malformed archives at distribution load time. Application resource
signatures (`_CodeSignature`) are not accepted in these templates: bundle signing
and notarization, when used, must operate on the personalized application.

Personalization MUST preserve the executable and Info.plist contents and file
permissions. The reference implementation copies their compressed ZIP data,
replaces any old bootstrap entry, and gives the new bootstrap file mode `0600`.
It verifies the injected bytes before serving the result and never modifies the
source artifact. Concurrent downloads use immutable template bytes. Responses
use `application/zip`, the personalized content length, and
`Cache-Control: private, no-store`. Distribution metadata continues to describe
the source template's size, as for MSI personalization.

## 7. Responsibility boundaries

This contract answers which target artifacts exist, which file is selected,
where its immutable source file resides, and how the backend deploys and serves
that set. Apart from the bootstrap convention above, it intentionally does not
define:

- artifact signing or signing metadata, which belongs to platform build and
  deployment tooling; or
- artifact hashes, checksums, declared sizes, or deployment-integrity policy,
  which belong to the build and deployment pipeline.

These concerns MAY affect how bytes are produced or verified, but they MUST NOT
add signing/integrity fields to this manifest or write derived files into the artifact root.

## 8. Desktop UI package

The sidecar hosts the Erato desktop UI in its own webview windows, served as a
local mirror of the backend's public paths with no network access. The
generic build of that app lives in the sidecar repository (`desktop-ui/`) and
ships as the artifact set's `ui` entry (Section 3); the sidecar repository's
`crates/erato-desktop-sidecar-ui/README.md` is the authoritative layout
contract. In short, the archive is a gzip tar rooted at `package/` with
`package/package.json` (`name`, `version`) and `package/manifest.json`:
`{"format": 1, "hostApi": 1, "name", "version", "commit", "library":
{"commit"}, "windows": [{"name", "entry"}], "files": [{"path", "sha256",
"bytes", "contentType"}], "totalBytes"}`. Each window entry is an `.html` file
at the package root carrying the `<!--erato:head-->` and `<!--erato:kits-->`
markers in that order; the app's assets live under
`public/platform-desktop-ui/assets/`, its catalogs at
`public/platform-desktop-ui/locales/<locale>/messages.json` and its import-map
manifest at `public/platform-desktop-ui/import-map.manifest.json`. Paths are
relative to `package/`; `files` lists every file except the two package files
with its SHA-256, size and content type, and `totalBytes` is their sum.

### Backend validation

Together with the targets, the backend loads the `ui` archive: the path MUST
be `ui/<file>.tgz` below the artifact root and a regular file, the archive
MUST unpack to the layout above with `format` 1 and `hostApi` 1, every listed
file MUST match its digest and size, nothing unlisted ships, and the manifest
`version` MUST equal the root manifest's `ui.version`. A failing archive
rejects the artifact set like any other validation failure.

### The deployment package

From the generic archive and the parts it already holds, the backend assembles
one **desktop UI package** per deployment, at startup and on every runtime
configuration reload. The package keeps the archive's files verbatim and adds,
under the paths the browser fetches them from:

- the common catalogs of every locale the web bundle ships, compiled as the
  browser receives them, at `public/common/locales/<locale>/messages.json`;
- the runtime translation overrides at `public/common/overrides/index.json`
  and `public/common/overrides/<locale>.json`;
- the active theme at `public/common/custom-theme/<name>/**` (regular files
  only, catalogs compiled; nothing remote);
- every discovered component kit at `public/component-kits/<name>/**` with
  its catalogs;
- the composition at `public/platform-desktop-ui/composition.json`: the JSON of
  the manifest's `composition`, listed in `files` so that `digest` covers it. A
  deployment that changes only a composition value, a logo path for instance,
  gets a new digest and reaches installed sidecars. Sidecars read the manifest's
  `composition`, not this file.

`manifest.json` keeps the archive's fields and adds:

- `composition.env`: `FRONTEND_PLATFORM` (`platform-desktop-ui`),
  `FRONTEND_PUBLIC_BASE_PATH` (`/public/platform-desktop-ui`),
  `COMMON_PUBLIC_BASE_PATH` (`/public/common`), `THEME_CUSTOMER_NAME` and the
  theme, logo and favicon path values the browser injection sets;
- `composition.importMap`: `{"imports": {...}}`, the app's import-map manifest
  with every entry mounted under `/public/platform-desktop-ui/`, as the browser
  import map is built;
- `composition.kits`: `[{name, script, stylesheet, locales}]`, the kits every
  window loads, the consent window included;
- `composition.windows`: the archive's `windows`;
- `parts`: `{app: {version, commit, library}, theme: {name} | null,
catalogs: {locales: [...]}, overrides: {present}, kits: [{name}]}`;
- `digest`: the lowercase hex SHA-256 of the canonical JSON of `files`
  (compact, keys sorted), the identity clients and sidecars compare.

The package budget is 16 MiB (16777216 bytes) of `totalBytes`, the sidecar's
acceptance budget (`MAX_TOTAL_BYTES` in `crates/erato-desktop-sidecar-ui`);
raising it requires raising the sidecar's acceptance budget first. The generic
archive keeps to the sidecar's 8 MiB seed budget, so a deployment always has
at least 8 MiB for its catalogs, theme and component kits. The package's
compressed archive is at most 9,437,184 bytes, what a client can relay (72
chunks of 131,072 bytes, [SPEC.md](./SPEC.md#desktop-ui-package)) and the most
the sidecar downloads. A package over budget, an archive over that cap, or a
package that fails assembly is logged at assembly time and not served; the
endpoints then answer 404.

### Endpoints

Both package endpoints are outside the user session: they require
`Authorization: Bearer <package token>` and reject other requests with 401.

```text
GET /api/v1beta/desktop-sidecar/ui-package/manifest.json
GET /api/v1beta/desktop-sidecar/ui-package
```

The first answers the package manifest as `application/json`. The second
answers the archive as `application/gzip` with `ETag: "<digest>"` and
`Cache-Control: no-store`; a request whose `If-None-Match` names the current
digest receives 304. Both answer 404 while the deployment ships no `ui`
artifact or its package failed assembly.

The token comes from the session-authenticated endpoint

```text
GET /api/v1beta/me/desktop-sidecar/ui-package-token
```

which returns `{url, token, digest, host_api, expires_at}`: the archive's
root-relative URL, the token, the current package digest, the host API the
package targets and the token's RFC 3339 expiry. The token is an HMAC-SHA256
over the purpose `desktop-ui-package` and its expiry, keyed from the
deployment's `server.encryption_key`; it is valid for 24 hours,
deployment-level, and authorizes nothing but the two package requests. Without
`server.encryption_key` the endpoint answers 503 and clients send no
`ui_package`. The client resolves `url` against the origin it is served from
and passes the four values on as `ui_package` of `sidecar.configure.v1`
([SPEC.md](./SPEC.md#desktop-ui-package)).

A deployment that fronts the backend with an authenticating proxy MUST route
the two package paths past it, because such proxies strip the `Authorization`
header; the Helm chart's `desktopSidecar.uiPackage.directRoute` does this.

### Client relay

The endpoints are unchanged by the relay (package 0.1.47). A client whose
sidecar reports a relay-eligible failure fetches
`GET /api/v1beta/desktop-sidecar/ui-package` from its own origin with the same
token, compares the `ETag` with the offered digest, and relays the bytes to
the sidecar ([SPEC.md](./SPEC.md#desktop-ui-package)). The
authenticating-proxy rule above applies to the browser's request too.
