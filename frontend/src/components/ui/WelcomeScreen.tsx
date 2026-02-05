/* eslint-disable @typescript-eslint/no-unnecessary-condition */
"use client";

import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import Markdown from "react-markdown";

import { env } from "@/app/env";
import { useTheme } from "@/components/providers/ThemeProvider";
import { Logo } from "@/components/ui/Logo";
import { usePageAlignment } from "@/hooks/ui/usePageAlignment";
import { loadThemeFromPath } from "@/utils/themeUtils";

export interface WelcomeScreenProps {
  className?: string;
}

export function WelcomeScreen({ className = "" }: WelcomeScreenProps) {
  const { isCustomTheme } = useTheme();
  const { textAlignment, flexAlignment, justifyAlignment } =
    usePageAlignment("headers");
  const [branding, setBranding] = useState<{
    enabled: boolean;
    logoSize: "small" | "medium" | "large";
  } | null>(null);

  // Size mapping for logo dimensions
  const logoSizes = {
    small: { width: 150, height: 50 },
    medium: { width: 240, height: 80 },
    large: { width: 320, height: 100 },
  };

  useEffect(() => {
    // Only load branding if we have a custom theme
    if (!isCustomTheme) return;

    // Get the customer name from environment variable
    const customerName = env().themeCustomerName;
    if (!customerName) return;

    const loadBranding = async () => {
      try {
        // Construct path with the folder name
        // eslint-disable-next-line lingui/no-unlocalized-strings
        const themePath = `/custom-theme/${customerName}/theme.json`;

        // Load the theme data
        const themeData = await loadThemeFromPath(themePath);
        if (!themeData?.branding?.welcomeScreen) {
          setBranding(null);
          return;
        }

        // Set the branding data
        setBranding(themeData.branding.welcomeScreen);
      } catch (error) {
        console.error("Error loading welcome screen branding:", error);
        setBranding(null);
      }
    };

    void loadBranding();
  }, [isCustomTheme]);

  // If no branding or if branding is disabled, don't show
  if (!branding?.enabled) return null;

  // Get logo dimensions based on size
  const logoSize = logoSizes[branding.logoSize] || logoSizes.medium;

  return (
    <div
      className={`flex flex-col ${flexAlignment} ${justifyAlignment} p-12 ${className}`}
    >
      <div className={`mb-8 ${flexAlignment}`}>
        <Logo
          width={logoSize.width}
          height={logoSize.height}
          alt={t({
            id: "branding.welcomeScreen.title",
            message: "Welcome to AI Assistant",
          })}
        />
      </div>

      <h1
        className={`mb-4 text-2xl font-bold text-theme-fg-primary ${textAlignment}`}
      >
        <Trans id="branding.welcomeScreen.title">Welcome to AI Assistant</Trans>
      </h1>

      <h2 className={`mb-6 text-xl text-theme-fg-secondary ${textAlignment}`}>
        <Trans id="branding.welcomeScreen.subtitle">
          Get expert help with your questions
        </Trans>
      </h2>

      <div className={`text-lg text-theme-fg-muted ${textAlignment}`}>
        <Markdown
          components={{
            li: ({ ...props }) => <li className="list-disc" {...props} />,
            p: ({ ...props }) => <p className="mb-4 first:mt-0" {...props} />,
            h1: ({ children, ...props }) => (
              <h1
                className="mb-3 mt-6 text-2xl font-bold text-theme-fg-primary first:mt-0"
                {...props}
              >
                {children}
              </h1>
            ),
            h2: ({ children, ...props }) => (
              <h2
                className="mb-3 mt-6 text-xl font-semibold text-theme-fg-primary first:mt-0"
                {...props}
              >
                {children}
              </h2>
            ),
            h3: ({ children, ...props }) => (
              <h3
                className="mb-2 mt-4 text-lg font-semibold text-theme-fg-secondary first:mt-0"
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
          }}
        >
          {t({
            id: "branding.welcomeScreen.description",
            message:
              "Ask questions and get helpful responses from our AI assistant.",
          })}
        </Markdown>
      </div>
    </div>
  );
}
