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

The initial layout is:

```text
/app/desktop-sidecar-artifacts/
├── manifest.json
└── targets/
    ├── windows-x86_64/
    │   ├── erato-desktop-sidecar.exe
    │   └── erato-desktop-sidecar.msi
    ├── windows-aarch64/
    │   └── erato-desktop-sidecar.exe
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

The initial target IDs and platform values are:

| Target ID           | OS        | Architecture | ABI      |
| ------------------- | --------- | ------------ | -------- |
| `windows-x86_64`    | `windows` | `x86_64`     | `msvc`   |
| `windows-aarch64`   | `windows` | `aarch64`    | `msvc`   |
| `macos-x86_64`      | `macos`   | `x86_64`     | `darwin` |
| `macos-aarch64`     | `macos`   | `aarch64`    | `darwin` |
| `linux-x86_64-gnu`  | `linux`   | `x86_64`     | `gnu`    |
| `linux-aarch64-gnu` | `linux`   | `aarch64`    | `gnu`    |

An API boundary MAY accept aliases such as `amd64` or `arm64`, but it MUST
normalize them before target selection. Directory names, manifest target IDs,
and manifest platform values MUST use the canonical vocabulary above.

## 3. Root manifest

`manifest.json` is a JSON object with one `targets` array. The following
manifest completely describes the six-target filesystem example in Section 1:

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
      "id": "windows-aarch64",
      "platform": {
        "os": "windows",
        "architecture": "aarch64",
        "abi": "msvc"
      },
      "default_file": "executable",
      "files": [
        {
          "id": "executable",
          "kind": "executable",
          "path": "targets/windows-aarch64/erato-desktop-sidecar.exe",
          "download_filename": "erato-desktop-sidecar-windows-aarch64.exe",
          "media_type": "application/vnd.microsoft.portable-executable"
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
exact lowercase `scheme://host[:non-default-port]` origin, with no path,
query, fragment, wildcard, or trailing slash. An empty array is valid and
refuses every production browser request.

The bootstrap policy takes precedence over every user-writable configuration
file. In particular, `sidecar.configure.v1` and files in a user's platform
configuration directory MUST NOT add or replace production allowed origins.
Development origins remain an explicit local development-mode option.

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
`.erato` section with a 4096-byte slot. Its bytes are:

| Offset | Length | Value                                                |
| ------ | ------ | ---------------------------------------------------- |
| 0      | 16     | ASCII magic `ERATO_BOOTSTRAP!`                       |
| 16     | 2      | Little-endian format version (`1`)                   |
| 18     | 4      | Little-endian JSON payload length                    |
| 22     | 4      | Little-endian payload capacity (`4070`)              |
| 26     | 4070   | UTF-8 bootstrap JSON followed by ASCII space padding |

A personalizer MUST parse the PE section table, find exactly one `.erato`
section, then find the magic exactly once inside that section. It MUST validate
the template header, replace the complete 4096-byte slot, and reject an
oversized document, including the JSON-escaped PEM strings. The complete JSON
must fit within 4070 UTF-8 bytes; large RSA keys or long chains may exceed this
limit and require an MSI/external bootstrap file. It MUST NOT truncate PEM,
replace a JSON substring, or append an EOF trailer. The sidecar validates the
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
There is no 4070-byte executable-slot limit for the ZIP bootstrap entry.

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
add fields to this manifest or write derived files into the artifact root.
