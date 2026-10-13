// "use client"; // Removed

import { t } from "@lingui/core/macro";

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
  alt = t`Logo`,
}: LogoProps) {
  const { logoPath } = useTheme();

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
      onError={() => {}}
    />
  );
}
