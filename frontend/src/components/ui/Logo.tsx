"use client";

import Image from "next/image";
import { useState, useEffect } from "react";

import { env } from "@/app/env";
import { useTheme } from "@/components/providers/ThemeProvider";

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
  alt = "Logo",
}: LogoProps) {
  const { themeMode } = useTheme();
  const [logoPath, setLogoPath] = useState<string>("");
  const [fallbackPath, setFallbackPath] = useState<string>("");

  useEffect(() => {
    const customerName = env().themeCustomerName;
    const isDark = themeMode === "dark";

    // Determine the base theme path - default to "custom-theme"
    // If NEXT_PUBLIC_CUSTOMER_NAME is set, use "custom-theme/[name]"
    let themePath = "/custom-theme";

    // If we have a customer name and we're in development mode (for maintainer)
    if (customerName) {
      themePath = `/custom-theme/${customerName}`;
    }

    // Allow complete override of the path via env var if needed
    const overrideThemePath = env().themePath;
    if (overrideThemePath) {
      themePath = overrideThemePath;
    }

    // Set the logo path based on the theme path
    const primaryLogoPath = `${themePath}/logo.svg`;
    setLogoPath(primaryLogoPath);

    // Set fallback path
    if (isDark) {
      setFallbackPath(primaryLogoPath); // Fallback to light theme logo
    } else {
      setFallbackPath("/vercel.svg"); // Generic fallback
    }
  }, [themeMode]);

  if (!logoPath) {
    return null; // Don't render until we've determined the path
  }

  return (
    <Image
      src={logoPath}
      alt={alt}
      width={width}
      height={height}
      className={className}
      onError={() => {
        // If the primary logo fails to load, switch to the fallback
        if (logoPath !== fallbackPath) {
          setLogoPath(fallbackPath);
        }
      }}
    />
  );
}
