/* eslint-disable @typescript-eslint/no-unnecessary-condition */
"use client";

import { useEffect, useState } from "react";
import Markdown from "react-markdown";

import { env } from "@/app/env";
import { useTheme } from "@/components/providers/ThemeProvider";
import { Logo } from "@/components/ui/Logo";
import { loadThemeFromPath } from "@/utils/themeUtils";

export interface WelcomeScreenProps {
  className?: string;
}

export function WelcomeScreen({ className = "" }: WelcomeScreenProps) {
  const { isCustomTheme } = useTheme();
  const [branding, setBranding] = useState<{
    enabled: boolean;
    logoSize: "small" | "medium" | "large";
    title: string;
    subtitle: string;
    description: string;
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
      className={`flex flex-col items-center justify-center p-12 text-center ${className}`}
    >
      <div className="mb-8">
        <Logo
          width={logoSize.width}
          height={logoSize.height}
          alt={branding.title}
        />
      </div>

      <h1 className="mb-4 text-2xl font-bold text-theme-fg-primary">
        {branding.title}
      </h1>

      <h2 className="mb-6 text-xl text-theme-fg-secondary">
        {branding.subtitle}
      </h2>

      <div className="max-w-2xl text-lg text-theme-fg-muted">
        <Markdown
          components={{
            li: ({ ...props }) => <li className="list-disc" {...props} />,
            p: ({ ...props }) => <p className="mt-4" {...props} />,
          }}
        >
          {branding.description}
        </Markdown>
      </div>
    </div>
  );
}
