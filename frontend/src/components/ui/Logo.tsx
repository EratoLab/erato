"use client";

import Image from "next/image";
import { useState, useEffect } from "react";

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
    // Use the environment variable directly for the customer name
    const customerName = process.env.NEXT_PUBLIC_CUSTOMER_NAME;
    const isDark = themeMode === "dark";

    // Primary logo path based on customer name
    if (customerName) {
      // For custom themes, use the customer-specific path
      setLogoPath(`/customer-themes/${customerName}/logo.svg`);

      // Set a fallback in case the primary logo fails to load
      if (isDark) {
        // Try light version as fallback for dark mode
        setFallbackPath(`/customer-themes/${customerName}/logo.svg`);
      } else {
        // Fallback to a generic logo only if absolutely necessary
        setFallbackPath("/vercel.svg");
      }
    } else {
      // Default paths if no custom theme
      setLogoPath(isDark ? "/vercel.svg" : "/vercel.svg");
      setFallbackPath("/vercel.svg");
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
