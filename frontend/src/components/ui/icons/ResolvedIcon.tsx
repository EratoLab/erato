import * as Icons from "iconoir-react";
import { Tools } from "iconoir-react";
import { useState, useEffect, useRef } from "react";

import type { IconProps } from ".";
import type { FC } from "react";

export interface ResolvedIconProps extends IconProps {
  iconId?: string;
  fallbackIcon?: FC<IconProps>;
}

// SVG cache to avoid re-fetching the same SVG files
const svgCache = new Map<string, string>();

function normalizeIconToken(value: string): string {
  return value
    .trim()
    .replace(/^iconoir[-_/:]/i, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function toPascalCase(value: string): string {
  return value
    .trim()
    .replace(/^iconoir[-_/:]/i, "")
    .split(/[-_/: ]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

const iconExports = Icons as Record<string, unknown>;
const iconKeyByNormalizedName: Record<string, string> = Object.keys(
  iconExports,
).reduce<Record<string, string>>((acc, exportKey) => {
  if (exportKey === "IconoirProvider" || exportKey === "IconoirContext") {
    return acc;
  }

  acc[normalizeIconToken(exportKey)] = exportKey;
  return acc;
}, {});

function resolveIconComponent(
  iconId: string | undefined,
): FC<IconProps> | null {
  if (!iconId) {
    return null;
  }

  const directMatch = iconExports[toPascalCase(iconId)];
  if (typeof directMatch !== "undefined") {
    return directMatch as FC<IconProps>;
  }

  const normalizedMatchKey =
    iconKeyByNormalizedName[normalizeIconToken(iconId)];
  if (!normalizedMatchKey) {
    return null;
  }

  const normalizedMatch = iconExports[normalizedMatchKey];
  if (typeof normalizedMatch !== "undefined") {
    return normalizedMatch as FC<IconProps>;
  }

  return null;
}

const DefaultFallbackIcon: FC<IconProps> = ({ className, ...props }) => (
  <Tools className={className} {...props} />
);

/**
 * Component to render a custom SVG icon from a URL
 */
const CustomSvgIcon: FC<
  IconProps & { svgPath: string; fallbackIcon: FC<IconProps> }
> = ({ svgPath, fallbackIcon: FallbackIcon, className, ...props }) => {
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    // Check cache first
    if (svgCache.has(svgPath)) {
      setSvgContent(svgCache.get(svgPath) ?? null);
      return;
    }

    // Fetch the SVG
    const fetchSvg = async () => {
      try {
        const response = await fetch(svgPath);
        if (!response.ok) {
          throw new Error(`Failed to fetch SVG: ${response.statusText}`);
        }
        const svgText = await response.text();

        // Cache the SVG content
        svgCache.set(svgPath, svgText);
        setSvgContent(svgText);
      } catch (err) {
        console.error(`Error loading custom icon from ${svgPath}:`, err);
        setError(true);
      }
    };

    void fetchSvg();
  }, [svgPath]);

  // Inject SVG into DOM when content is available
  useEffect(() => {
    if (!svgContent || !containerRef.current) {
      return;
    }

    // Parse SVG content safely
    const parser = new DOMParser();
    // eslint-disable-next-line lingui/no-unlocalized-strings
    const doc = parser.parseFromString(svgContent, "image/svg+xml");
    const svgElement = doc.querySelector("svg");

    if (!svgElement) {
      setError(true);
      return;
    }

    // Apply className and dimensions
    if (className) {
      svgElement.setAttribute("class", className);
    }
    svgElement.setAttribute("width", String(props.width ?? 24));
    svgElement.setAttribute("height", String(props.height ?? 24));

    // Clear container and append the SVG element
    containerRef.current.innerHTML = "";
    containerRef.current.appendChild(svgElement);
  }, [svgContent, className, props.width, props.height]);

  // Show fallback if error or still loading
  if (error || !svgContent) {
    return <FallbackIcon className={className} {...props} />;
  }

  return (
    <span
      ref={containerRef}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: props.width,
        height: props.height,
      }}
    />
  );
};

export const ResolvedIcon = ({
  iconId,
  fallbackIcon: FallbackIcon = DefaultFallbackIcon,
  className,
  ...props
}: ResolvedIconProps) => {
  // Check if iconId is a custom SVG path (starts with /)
  if (iconId?.startsWith("/")) {
    return (
      <CustomSvgIcon
        svgPath={iconId}
        fallbackIcon={FallbackIcon}
        className={className}
        {...props}
      />
    );
  }

  // Otherwise, resolve from iconoir-react
  const IconComponent = resolveIconComponent(iconId) ?? FallbackIcon;
  return <IconComponent className={className} {...props} />;
};
