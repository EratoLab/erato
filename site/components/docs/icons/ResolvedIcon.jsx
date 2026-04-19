import * as Icons from "iconoir-react";
import { Tools } from "iconoir-react";
import * as SimpleIcons from "simple-icons";

const builtInIcons = {
  "builtin-chatgpt": {
    title: "ChatGPT",
    path: "M9.206 8.765v-2.26c0-.19.07-.333.238-.428l4.542-2.616c.62-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.548l-4.71-2.76a.797.797 0 0 0-.856 0zm10.608 8.8v-5.4c0-.332-.143-.57-.428-.736l-5.97-3.473 1.95-1.118a.433.433 0 0 1 .476 0l4.542 2.617c1.308.76 2.188 2.378 2.188 3.948 0 1.808-1.07 3.473-2.759 4.163zM7.803 12.81l-1.95-1.142c-.167-.095-.238-.238-.238-.428V6.006c0-2.545 1.95-4.472 4.59-4.472 1 0 1.926.333 2.711.928L8.232 5.174c-.285.166-.428.404-.428.737v6.898zM12 15.235l-2.794-1.57v-3.33L12 8.765l2.795 1.57v3.33zm1.796 7.23a4.451 4.451 0 0 1-2.712-.927l4.686-2.711c.286-.167.428-.405.428-.738V11.19l1.975 1.142a.454.454 0 0 1 .238.428v5.233c0 2.545-1.975 4.472-4.615 4.472zm-5.636-5.303-4.543-2.617c-1.31-.761-2.19-2.378-2.19-3.948a4.482 4.482 0 0 1 2.784-4.163v5.423c0 .333.143.571.428.738l5.946 3.449-1.95 1.118a.433.433 0 0 1-.475 0zm-.262 3.9c2.687 0-4.662-2.021-4.662-4.52 0-.19.024-.38.048-.57l4.686 2.712c.284.167.57.167.855 0l5.97-3.45v2.26c0 .19-.07.334-.238.429l-4.543 2.616c-.618.356-1.355.523-2.116.523zm5.9 2.83a5.947 5.947 0 0 0 5.826-4.756c2.664-.69 4.376-3.188 4.376-5.733 0-1.665-.713-3.282-1.998-4.448.12-.5.19-.999.19-1.498 0-3.4-2.759-5.947-5.946-5.947a5.64 5.64 0 0 0-1.879.31A5.962 5.962 0 0 0 10.205.107a5.947 5.947 0 0 0-5.827 4.757C1.714 5.554 0 8.052 0 10.597c0 1.665.714 3.282 1.998 4.448-.12.5-.19.999-.19 1.498 0 3.4 2.76 5.945 5.946 5.945.643 0 1.26-.095 1.88-.308a5.96 5.96 0 0 0 4.161 1.712z",
  },
};

function normalizeIconToken(value) {
  return value.trim().replace(/^iconoir[-_:/]/i, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function normalizeSimpleIconToken(value) {
  return value
    .trim()
    .replace(/^simpleicons[-_:/]/i, "")
    .replace(/^si(?=[A-Z])/, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function toPascalCase(value) {
  return value
    .trim()
    .replace(/^iconoir[-_:/]/i, "")
    .split(/[-_:/ ]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

const iconExports = Icons;
const simpleIconExports = SimpleIcons;

const iconKeyByNormalizedName = Object.keys(iconExports).reduce((acc, exportKey) => {
  if (exportKey === "IconoirProvider" || exportKey === "IconoirContext") {
    return acc;
  }

  acc[normalizeIconToken(exportKey)] = exportKey;
  return acc;
}, {});

const simpleIconKeyByNormalizedName = Object.keys(simpleIconExports).reduce(
  (acc, exportKey) => {
    if (!exportKey.startsWith("si")) {
      return acc;
    }

    acc[normalizeSimpleIconToken(exportKey)] = exportKey;
    return acc;
  },
  {},
);

function resolveIconComponent(iconId) {
  const directMatch = iconExports[toPascalCase(iconId)];
  if (typeof directMatch !== "undefined") {
    return directMatch;
  }

  const normalizedMatchKey = iconKeyByNormalizedName[normalizeIconToken(iconId)];
  if (!normalizedMatchKey) {
    return null;
  }

  const normalizedMatch = iconExports[normalizedMatchKey];
  if (typeof normalizedMatch !== "undefined") {
    return normalizedMatch;
  }

  return null;
}

function resolveSimpleIcon(iconId) {
  const normalizedMatchKey = simpleIconKeyByNormalizedName[normalizeSimpleIconToken(iconId)];
  if (!normalizedMatchKey) {
    return null;
  }

  const normalizedMatch = simpleIconExports[normalizedMatchKey];
  if (
    typeof normalizedMatch === "object" &&
    normalizedMatch !== null &&
    "path" in normalizedMatch
  ) {
    return normalizedMatch;
  }

  return null;
}

function SimpleIconComponent({
  icon,
  className,
  color,
  width = 24,
  height = 24,
  ...props
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={color ?? "currentColor"}
      width={width}
      height={height}
      className={className}
      aria-hidden="true"
      {...props}
    >
      <title>{icon.title}</title>
      <path d={icon.path} />
    </svg>
  );
}

function DefaultFallbackIcon({ className, ...props }) {
  return <Tools className={className} {...props} />;
}

export function ResolvedIcon({
  iconId,
  fallbackIcon: FallbackIcon = DefaultFallbackIcon,
  className,
  ...props
}) {
  if (!iconId) {
    return null;
  }

  const builtInIcon = builtInIcons[iconId];
  if (builtInIcon) {
    return <SimpleIconComponent icon={builtInIcon} className={className} {...props} />;
  }

  const simpleIcon = resolveSimpleIcon(iconId);
  if (simpleIcon) {
    return <SimpleIconComponent icon={simpleIcon} className={className} {...props} />;
  }

  const IconComponent = resolveIconComponent(iconId) ?? FallbackIcon;
  return <IconComponent className={className} {...props} />;
}

