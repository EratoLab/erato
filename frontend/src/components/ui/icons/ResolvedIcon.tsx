import * as Icons from "iconoir-react";
import { Tools } from "iconoir-react";

import type { IconProps } from ".";
import type { FC } from "react";

export interface ResolvedIconProps extends IconProps {
  iconId?: string;
  fallbackIcon?: FC<IconProps>;
}

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

export const ResolvedIcon = ({
  iconId,
  fallbackIcon: FallbackIcon = DefaultFallbackIcon,
  className,
  ...props
}: ResolvedIconProps) => {
  const IconComponent = resolveIconComponent(iconId) ?? FallbackIcon;
  return <IconComponent className={className} {...props} />;
};
