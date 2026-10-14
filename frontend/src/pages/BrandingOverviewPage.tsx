import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";

import { env } from "@/app/env";
import {
  resolveLogoPath,
  resolveThemeAssetPath,
} from "@/components/providers/ThemeProvider";
import {
  defaultThemeConfig,
  loadResolvedThemeConfig,
} from "@/config/themeConfig";

interface Asset {
  label: string;
  url: string | null;
  dark?: boolean;
}

export function manifestAssetUrl(path: string): string {
  const trimmed = path.trim();
  return /^(https?:\/\/|\/)/i.test(trimmed)
    ? trimmed
    : // eslint-disable-next-line lingui/no-unlocalized-strings -- URL, not display text
      `/public/platform-office-addin/${trimmed}`;
}

function AssetPreview({ label, url, dark }: Asset) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="rounded-lg border border-gray-300 p-4">
      <figcaption className="mb-3 font-medium">{label}</figcaption>
      <div
        className={`flex h-32 items-center justify-center rounded p-4 ${dark ? "bg-gray-900" : "bg-white"}`}
      >
        {url && !failed ? (
          <img
            src={url}
            alt={label}
            className="max-h-full max-w-full object-contain"
            onError={() => setFailed(true)}
          />
        ) : (
          <span className={dark ? "text-white" : "text-gray-900"}>
            {url ? (
              <Trans id="brandingOverview.failed">
                Image could not be loaded
              </Trans>
            ) : (
              <Trans id="brandingOverview.absent">
                No custom image configured
              </Trans>
            )}
          </span>
        )}
      </div>
      {url && (
        <a
          className="mt-3 block break-all text-sm underline"
          href={url}
          target="_blank"
          rel="noreferrer"
        >
          {url}
        </a>
      )}
    </figure>
  );
}

function AssetGrid({ assets }: { assets: Asset[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {assets.map((asset) => (
        <AssetPreview key={`${asset.label}:${asset.url}`} {...asset} />
      ))}
    </div>
  );
}

export default function BrandingOverviewPage() {
  const office = env().frontendPlatform === "platform-office-addin";
  const config = window.BRANDING_OVERVIEW;
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      const loaded = await loadResolvedThemeConfig(defaultThemeConfig);
      const themeConfig = loaded?.themeConfig ?? null;
      const resolvedThemeConfigPath = loaded?.themeConfigPath ?? null;
      const result: Asset[] = [];
      for (const isDark of [false, true]) {
        const mode = isDark
          ? t({ id: "brandingOverview.dark", message: "Dark" })
          : t({ id: "brandingOverview.light", message: "Light" });
        result.push({
          label: `${t({ id: "brandingOverview.logo", message: "Application logo" })} · ${mode}`,
          url: await resolveLogoPath(
            themeConfig,
            resolvedThemeConfigPath,
            isDark,
          ),
          dark: isDark,
        });
        // eslint-disable-next-line lingui/no-unlocalized-strings -- Theme asset keys
        for (const key of ["sidebarLogo", "assistantAvatar"] as const) {
          result.push({
            label: `${
              key === "sidebarLogo"
                ? t({ id: "brandingOverview.sidebar", message: "Sidebar logo" })
                : t({
                    id: "brandingOverview.avatar",
                    message: "Assistant avatar",
                  })
            } · ${mode}`,
            url: await resolveThemeAssetPath(key, {
              themeConfig,
              resolvedThemeConfigPath,
              isDark,
            }),
            dark: isDark,
          });
        }
      }
      // Read the actual head links: the server rewrites these for each platform.
      document
        .querySelectorAll<HTMLLinkElement>(
          'link[rel="icon"], link[rel="apple-touch-icon"]',
        )
        .forEach((link) => {
          result.push({
            label: `${link.rel} ${link.type || link.sizes.value}`,
            url: link.href,
          });
        });
      if (active) setAssets(result);
    }
    void load().catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const manifestAssets = (paths: Record<string, string>): Asset[] =>
    Object.entries(paths).map(([label, path]) => ({
      label,
      url: manifestAssetUrl(path),
      dark: label === "outline",
    }));

  return (
    <main
      data-branding-overview
      className="w-full bg-gray-50 p-6 text-gray-900"
    >
      <div className="mx-auto max-w-6xl space-y-8">
        <h1 className="text-2xl font-bold">
          <Trans id="brandingOverview.title">Branding overview</Trans>
        </h1>
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">
            {office ? (
              <Trans id="brandingOverview.office">
                Office add-in (Outlook, Word and Teams)
              </Trans>
            ) : (
              <Trans id="brandingOverview.web">Web app</Trans>
            )}
          </h2>
          {assets ? (
            <AssetGrid assets={assets} />
          ) : failed ? (
            <p role="alert">
              <Trans id="brandingOverview.loadFailed">
                Could not load branding assets
              </Trans>
            </p>
          ) : (
            <p role="status">
              <Trans id="brandingOverview.loading">
                Loading branding assets…
              </Trans>
            </p>
          )}
        </section>
        {office && config?.officeEnabled && (
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">
              <Trans id="brandingOverview.officeManifest">
                Office manifests (Outlook and Word)
              </Trans>
            </h2>
            <AssetGrid assets={manifestAssets(config.office)} />
          </section>
        )}
        {office && config?.teamsEnabled && (
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">
              <Trans id="brandingOverview.teamsManifest">
                Teams package icons
              </Trans>
            </h2>
            <AssetGrid assets={manifestAssets(config.teams)} />
          </section>
        )}
        {!office &&
          (config?.officeEnabled ? (
            <OfficeBrandingFrame />
          ) : (
            <p>
              <Trans id="brandingOverview.officeDisabled">
                Office add-in is disabled
              </Trans>
            </p>
          ))}
      </div>
    </main>
  );
}

// Keep the Office preview in its own document so its environment and theme
// resolution match the add-in, without changing the web app's global theme.
function OfficeBrandingFrame() {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    let observer: ResizeObserver | undefined;
    const resize = () => {
      const body = element.contentDocument?.body;
      if (!body) return;
      observer?.disconnect();
      observer = new ResizeObserver(() => {
        element.style.height = `${body.scrollHeight}px`;
      });
      observer.observe(body);
    };
    element.addEventListener("load", resize);
    resize();
    return () => {
      element.removeEventListener("load", resize);
      observer?.disconnect();
    };
  }, []);
  return (
    <iframe
      ref={frame}
      title={t({
        id: "brandingOverview.office",
        message: "Office add-in (Outlook, Word and Teams)",
      })}
      src="/office-addin/branding-overview"
      className="min-h-96 w-full rounded-lg border border-gray-300"
    />
  );
}
