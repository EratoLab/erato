import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import {
  AppleMac,
  ArrowLeft,
  Computer,
  Download,
  Linux,
  Package,
  Windows,
} from "iconoir-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  detectDesktopSidecarClientPlatform,
  selectBestDesktopSidecarTarget,
} from "@/lib/desktopSidecarPlatform";
import { useDistribution } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type * as Schemas from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type React from "react";

type DistributionTarget = Schemas.DesktopSidecarDistributionTargetResponse;
type DistributionFile = Schemas.DesktopSidecarDistributionFileResponse;

function platformLabel(os: string): string {
  switch (os) {
    case "windows":
      return t({
        id: "desktopSidecar.setup.platform.windows",
        message: "Windows",
      });
    case "macos":
      return t({ id: "desktopSidecar.setup.platform.macos", message: "macOS" });
    case "linux":
      return t({ id: "desktopSidecar.setup.platform.linux", message: "Linux" });
    default:
      return os;
  }
}

function platformIcon(os: string) {
  const props = { width: 24, height: 24, "aria-hidden": true };
  switch (os) {
    case "windows":
      return <Windows {...props} />;
    case "macos":
      return <AppleMac {...props} />;
    case "linux":
      return <Linux {...props} />;
    default:
      return <Computer {...props} />;
  }
}

function architectureLabel(architecture: string): string {
  switch (architecture) {
    case "x86_64":
      return t({
        id: "desktopSidecar.setup.architecture.x86_64",
        message: "Intel / AMD 64-bit",
      });
    case "aarch64":
      return t({
        id: "desktopSidecar.setup.architecture.aarch64",
        message: "ARM 64-bit",
      });
    default:
      return architecture;
  }
}

function artifactKindLabel(kind: string): string {
  switch (kind) {
    case "installer":
      return t({
        id: "desktopSidecar.setup.artifact.installer",
        message: "Installer",
      });
    case "application_archive":
      return t({
        id: "desktopSidecar.setup.artifact.applicationArchive",
        message: "Application archive",
      });
    case "archive":
      return t({
        id: "desktopSidecar.setup.artifact.archive",
        message: "Archive",
      });
    case "executable":
      return t({
        id: "desktopSidecar.setup.artifact.executable",
        message: "Standalone executable",
      });
    default:
      return kind;
  }
}

function formatFileSize(size: number): string {
  if (size < 1024) {
    return t({
      id: "desktopSidecar.setup.fileSize.bytes",
      message: "{size} B",
      values: { size },
    });
  }
  if (size < 1024 * 1024) {
    return t({
      id: "desktopSidecar.setup.fileSize.kilobytes",
      message: "{size} KB",
      values: { size: (size / 1024).toFixed(1) },
    });
  }
  return t({
    id: "desktopSidecar.setup.fileSize.megabytes",
    message: "{size} MB",
    values: { size: (size / (1024 * 1024)).toFixed(1) },
  });
}

function downloadUrl(targetId: string, fileId: string): string {
  const query = new URLSearchParams({ target: targetId, file: fileId });
  // API route, not user-facing copy.
  // eslint-disable-next-line lingui/no-unlocalized-strings
  return `/api/v1beta/desktop-sidecar/distribution/download?${query.toString()}`;
}

export default function DesktopSidecarSetupPage() {
  const { data, error, isLoading } = useDistribution(
    {},
    { retry: false, staleTime: Infinity },
  );
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const clientPlatform = useMemo(
    () =>
      detectDesktopSidecarClientPlatform(
        window.navigator.userAgent,
        window.navigator.platform,
      ),
    [],
  );
  const recommendedTarget = useMemo(
    () => selectBestDesktopSidecarTarget(data?.targets ?? [], clientPlatform),
    [clientPlatform, data?.targets],
  );
  const selectedTarget =
    data?.targets.find((target) => target.id === selectedTargetId) ??
    recommendedTarget ??
    data?.targets[0];
  const availableOperatingSystems = useMemo(
    () =>
      Array.from(
        new Set(data?.targets.map((target) => target.platform.os) ?? []),
      ),
    [data?.targets],
  );

  useEffect(() => {
    document.title = t({
      id: "desktopSidecar.setup.documentTitle",
      message: "Desktop Sidecar Setup",
    });
  }, []);

  function selectOperatingSystem(os: string) {
    const candidates =
      data?.targets.filter((target) => target.platform.os === os) ?? [];
    if (candidates.length === 0) {
      setSelectedTargetId(null);
      return;
    }
    const target =
      candidates.find(
        (candidate) =>
          candidate.platform.architecture === clientPlatform.architecture,
      ) ??
      candidates.find(
        (candidate) => candidate.platform.architecture === "x86_64",
      ) ??
      candidates[0];
    setSelectedTargetId(target.id);
  }

  if (isLoading) {
    return (
      <SetupFrame>
        <div className="flex min-h-64 items-center justify-center text-theme-fg-muted">
          <Trans id="desktopSidecar.setup.loading">
            Loading available downloads...
          </Trans>
        </div>
      </SetupFrame>
    );
  }

  if (error || !data || data.targets.length === 0 || !selectedTarget) {
    return (
      <SetupFrame>
        <div className="rounded-xl border border-theme-border-primary bg-theme-bg-primary p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-theme-fg-primary">
            <Trans id="desktopSidecar.setup.unavailable.title">
              Desktop Sidecar downloads are unavailable
            </Trans>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-theme-fg-muted">
            <Trans id="desktopSidecar.setup.unavailable.copy">
              Distribution has not been enabled or the configured artifacts
              could not be loaded. Contact your Erato administrator.
            </Trans>
          </p>
        </div>
      </SetupFrame>
    );
  }

  const platformTargets = data.targets.filter(
    (target) => target.platform.os === selectedTarget.platform.os,
  );

  return (
    <SetupFrame>
      <header className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-theme-fg-accent">
          <Trans id="desktopSidecar.setup.eyebrow">Erato Desktop Sidecar</Trans>
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-theme-fg-primary sm:text-4xl">
          <Trans id="desktopSidecar.setup.title">
            Download for your computer
          </Trans>
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-theme-fg-muted">
          <Trans id="desktopSidecar.setup.copy">
            Choose your operating system and processor, then download the
            package that fits how you want to install the desktop sidecar.
          </Trans>
        </p>
      </header>

      <section
        aria-labelledby="desktop-sidecar-platform-heading"
        className="rounded-2xl border border-theme-border-primary bg-theme-bg-primary p-5 shadow-sm sm:p-6"
      >
        <h2
          id="desktop-sidecar-platform-heading"
          className="text-lg font-semibold text-theme-fg-primary"
        >
          <Trans id="desktopSidecar.setup.platform.heading">
            1. Operating system
          </Trans>
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {availableOperatingSystems.map((os) => {
            const selected = selectedTarget.platform.os === os;
            return (
              <button
                key={os}
                type="button"
                aria-pressed={selected}
                onClick={() => selectOperatingSystem(os)}
                className={`flex min-h-20 items-center gap-3 rounded-xl border px-4 text-left transition-colors ${
                  selected
                    ? "border-theme-border-focus bg-theme-bg-selected text-theme-fg-primary"
                    : "border-theme-border-primary bg-theme-bg-secondary text-theme-fg-secondary hover:bg-theme-bg-hover"
                }`}
              >
                {platformIcon(os)}
                <span className="font-semibold">{platformLabel(os)}</span>
              </button>
            );
          })}
        </div>

        <h2 className="mt-8 text-lg font-semibold text-theme-fg-primary">
          <Trans id="desktopSidecar.setup.architecture.heading">
            2. Processor
          </Trans>
        </h2>
        <div className="mt-4 flex flex-wrap gap-3">
          {platformTargets.map((target) => {
            const selected = selectedTarget.id === target.id;
            const recommended = recommendedTarget?.id === target.id;
            return (
              <button
                key={target.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setSelectedTargetId(target.id)}
                className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                  selected
                    ? "border-theme-border-focus bg-theme-bg-selected text-theme-fg-primary"
                    : "border-theme-border-primary bg-theme-bg-secondary text-theme-fg-secondary hover:bg-theme-bg-hover"
                }`}
              >
                <span className="block font-semibold">
                  {architectureLabel(target.platform.architecture)}
                </span>
                <span className="mt-1 block text-xs text-theme-fg-muted">
                  {recommended ? (
                    <Trans id="desktopSidecar.setup.recommended">
                      Recommended for this device
                    </Trans>
                  ) : (
                    target.platform.abi
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section
        aria-labelledby="desktop-sidecar-download-heading"
        className="mt-6"
      >
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2
              id="desktop-sidecar-download-heading"
              className="text-lg font-semibold text-theme-fg-primary"
            >
              <Trans id="desktopSidecar.setup.download.heading">
                3. Download
              </Trans>
            </h2>
            <p className="mt-1 text-sm text-theme-fg-muted">
              {platformLabel(selectedTarget.platform.os)} ·{" "}
              {architectureLabel(selectedTarget.platform.architecture)}
            </p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {selectedTarget.files.map((file) => (
            <ArtifactCard key={file.id} file={file} target={selectedTarget} />
          ))}
        </div>
      </section>
    </SetupFrame>
  );
}

function ArtifactCard({
  file,
  target,
}: {
  file: DistributionFile;
  target: DistributionTarget;
}) {
  const isDefault = target.default_file === file.id;

  return (
    <article className="flex flex-col rounded-2xl border border-theme-border-primary bg-theme-bg-primary p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="rounded-xl bg-theme-bg-accent p-2.5 text-theme-fg-accent">
            <Package width={22} height={22} aria-hidden />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-theme-fg-primary">
              {artifactKindLabel(file.kind)}
            </h3>
            <p className="mt-1 truncate text-xs text-theme-fg-muted">
              {file.download_filename}
            </p>
          </div>
        </div>
        {isDefault ? (
          <span className="shrink-0 rounded-full bg-theme-bg-selected px-2.5 py-1 text-xs font-semibold text-theme-fg-accent">
            <Trans id="desktopSidecar.setup.artifact.recommended">
              Recommended
            </Trans>
          </span>
        ) : null}
      </div>
      <div className="mt-5 flex items-center justify-between gap-4 border-t border-theme-border-primary pt-4">
        <span className="text-sm text-theme-fg-muted">
          {formatFileSize(file.size)}
        </span>
        <a
          href={downloadUrl(target.id, file.id)}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-theme-action-primary-bg px-4 text-sm font-semibold text-theme-action-primary-fg transition-colors hover:bg-theme-action-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-theme-border-focus"
        >
          <Download width={18} height={18} aria-hidden />
          <Trans id="desktopSidecar.setup.download.button">Download</Trans>
        </a>
      </div>
    </article>
  );
}

function SetupFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="h-screen w-full overflow-y-auto bg-theme-bg-secondary">
      <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
        <Link
          to="/"
          className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-theme-fg-secondary hover:text-theme-fg-primary"
        >
          <ArrowLeft width={18} height={18} aria-hidden />
          <Trans id="desktopSidecar.setup.backToErato">Back to Erato</Trans>
        </Link>
        {children}
      </div>
    </main>
  );
}
