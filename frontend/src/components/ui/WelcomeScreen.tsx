"use client";

import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import clsx from "clsx";
import { useEffect, useState } from "react";
import Markdown from "react-markdown";

import { env } from "@/app/env";
import { useTheme } from "@/components/providers/ThemeProvider";
import { StarterPromptsSection } from "@/components/ui/Chat/StarterPromptsSection";
import { Logo } from "@/components/ui/Logo";
import { usePageAlignment } from "@/hooks/ui/usePageAlignment";
import { loadThemeFromPath } from "@/utils/themeUtils";

export interface WelcomeScreenProps {
  className?: string;
}

type WelcomeBranding = {
  enabled: boolean;
  logoSize: "small" | "medium" | "large";
};

const logoSizes: Record<
  WelcomeBranding["logoSize"],
  { width: number; height: number }
> = {
  small: { width: 150, height: 50 },
  medium: { width: 240, height: 80 },
  large: { width: 320, height: 100 },
};

function useWelcomeBranding() {
  const { isCustomTheme } = useTheme();
  const [branding, setBranding] = useState<WelcomeBranding | null>(null);

  useEffect(() => {
    if (!isCustomTheme) return;

    const customerName = env().themeCustomerName;
    if (!customerName) return;

    const loadBranding = async () => {
      try {
        // eslint-disable-next-line lingui/no-unlocalized-strings
        const themePath = `${env().commonPublicBasePath}/custom-theme/${customerName}/theme.json`;
        const themeData = await loadThemeFromPath(themePath);
        setBranding(themeData?.branding?.welcomeScreen ?? null);
      } catch (error) {
        console.error("Error loading welcome screen branding:", error);
        setBranding(null);
      }
    };

    void loadBranding();
  }, [isCustomTheme]);

  // theme.json is customer-authored, so an unknown size still needs a fallback.
  const logoSize = branding?.enabled
    ? // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      (logoSizes[branding.logoSize] ?? logoSizes.medium)
    : null;

  return { logoSize };
}

const markdownComponents = {
  li: ({ ...props }) => <li className="list-disc" {...props} />,
  p: ({ ...props }) => <p className="mb-4 first:mt-0" {...props} />,
  h1: ({ children, ...props }) => (
    <h1
      className="mb-3 mt-6 text-xl font-bold text-theme-fg-primary first:mt-0"
      {...props}
    >
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2
      className="mb-3 mt-6 text-lg font-semibold text-theme-fg-primary first:mt-0"
      {...props}
    >
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3
      className="mb-2 mt-4 text-base font-semibold text-theme-fg-secondary first:mt-0"
      {...props}
    >
      {children}
    </h3>
  ),
  hr: ({ ...props }) => (
    <hr className="my-4 border-t border-theme-border" {...props} />
  ),
  a: ({ href, children, ...props }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="theme-transition text-theme-fg-accent underline hover:opacity-40"
      {...props}
    >
      {children}
    </a>
  ),
} satisfies React.ComponentProps<typeof Markdown>["components"];

/** Customer logo and the welcome heading; sits above the composer. */
export function WelcomeScreenUpper({ className = "" }: WelcomeScreenProps) {
  const { containerClasses, textAlignment, flexAlignment, justifyAlignment } =
    usePageAlignment("headers");
  const { logoSize } = useWelcomeBranding();

  return (
    <div
      className={clsx(
        "flex w-full flex-col px-4",
        containerClasses,
        flexAlignment,
        justifyAlignment,
        className,
      )}
      data-testid="welcome-screen-default"
    >
      {logoSize && (
        <div className={clsx("mb-4 flex", justifyAlignment)}>
          <Logo
            width={logoSize.width}
            height={logoSize.height}
            alt={t({
              id: "branding.welcomeScreen.title",
              message: "Welcome to AI Assistant",
            })}
          />
        </div>
      )}

      <h1
        className={clsx(
          "text-2xl font-bold text-theme-fg-primary",
          textAlignment,
        )}
      >
        <Trans id="branding.welcomeScreen.title">Welcome to AI Assistant</Trans>
      </h1>
    </div>
  );
}

/** Subtitle, Markdown description and starter prompts; sits below the composer. */
export function WelcomeScreenLower({ className = "" }: WelcomeScreenProps) {
  const { textAlignment, flexAlignment, justifyAlignment } =
    usePageAlignment("headers");

  return (
    <div
      className={clsx(
        "mx-auto mt-4 flex w-full max-w-[var(--theme-layout-chat-input-max-width)] flex-col px-4 sm:mt-6",
        flexAlignment,
        justifyAlignment,
        className,
      )}
      data-testid="welcome-screen-lower"
    >
      <h2
        className={clsx(
          "mb-2 text-lg font-medium text-theme-fg-secondary",
          textAlignment,
        )}
      >
        <Trans id="branding.welcomeScreen.subtitle">
          Get expert help with your questions
        </Trans>
      </h2>

      <div className={clsx("text-base text-theme-fg-muted", textAlignment)}>
        <Markdown components={markdownComponents}>
          {t({
            id: "branding.welcomeScreen.description",
            message:
              "Ask questions and get helpful responses from our AI assistant.",
          })}
        </Markdown>
      </div>

      <StarterPromptsSection className="mt-4" />
    </div>
  );
}

/** Both parts stacked; the shape a whole-welcome override replaces. */
export function WelcomeScreen({ className = "" }: WelcomeScreenProps) {
  return (
    <div className={clsx("flex w-full flex-col", className)}>
      <WelcomeScreenUpper />
      <WelcomeScreenLower />
    </div>
  );
}
