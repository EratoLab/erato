# Desktop sidecar artifact distribution contract

This document is the authoritative contract for discovering and serving Erato
desktop-sidecar artifacts from the backend filesystem. The terms MUST, MUST NOT,
REQUIRED, SHOULD, SHOULD NOT, and MAY are interpreted as described by BCP 14.

This contract covers the artifact root, target and file discovery, backend
validation, and deployment replacement. It does not define how an application
personalizes a download. Signing artifacts and establishing their integrity are
responsibilities of the build and deployment pipeline, not fields in the
distribution manifest.

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

The backend obtains the current file size from filesystem metadata when serving it and uses that value for response
metadata such as `Content-Length`.

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

## 6. Responsibility boundaries

This contract answers which target artifacts exist, which file is selected,
where its immutable source file resides, and how the backend deploys and serves
that set. It intentionally does not define:

- personalization content or behavior, which is an application-level
  convention;
- artifact signing or signing metadata, which belongs to platform build and
  deployment tooling; or
- artifact hashes, checksums, declared sizes, or deployment-integrity policy,
  which belong to the build and deployment pipeline.

These concerns MAY affect how bytes are produced or verified, but they MUST NOT
add fields to this manifest or write derived files into the artifact root.
