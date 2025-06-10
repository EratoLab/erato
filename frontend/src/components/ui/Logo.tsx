// "use client"; // Removed

// import Image from "next/image"; // Removed Next.js Image import
import { t } from "@lingui/core/macro";
import { useState, useEffect } from "react";

import { useTheme } from "@/components/providers/ThemeProvider";
import { defaultThemeConfig } from "@/config/themeConfig";

interface LogoProps {
  className?: string;
  width?: number;
  height?: number;
  alt?: string;
}

export function Logo({
  className,
  width = 120,
  height = 40,
  alt = t`Logo`,
}: LogoProps) {
  const { effectiveTheme, customThemeName } = useTheme();
  const [logoPath, setLogoPath] = useState<string>("");

  useEffect(() => {
    const isDark = effectiveTheme === "dark";

    // Get logo path using the centralized logic
    const currentLogoPath = defaultThemeConfig.getLogoPath(
      customThemeName,
      isDark,
    );
    setLogoPath(currentLogoPath);
  }, [effectiveTheme, customThemeName]);

  if (!logoPath) {
    return null; // Don't render until we've determined the path
  }

  return (
    <img // Changed from Image to img
      src={logoPath}
      alt={alt}
      width={width}
      height={height}
      className={className}
      onError={() => {
        // console.error("Failed to load logo:", logoPath); // Removed
      }}
    />
  );
}
