import { useTheme } from "@/components/providers/ThemeProvider";

/**
 * Default icon mappings for different categories
 * Used as fallback when theme doesn't provide custom icons
 * These are internal icon identifiers, not user-facing strings
 */
/* eslint-disable lingui/no-unlocalized-strings */
const DEFAULT_ICONS = {
  status: {
    info: "InfoCircle",
    warning: "WarningCircle",
    error: "Xmark",
    success: "CheckCircle",
  },
  actions: {
    copy: "Copy",
    edit: "EditPencil",
    delete: "Trash",
    share: "ShareAndroid",
    plus: "Plus",
    close: "Xmark",
    check: "Check",
    refresh: "Refresh",
  },
} as const;
/* eslint-enable lingui/no-unlocalized-strings */

/**
 * Get the default icon ID for a category and key
 */
function getDefaultIcon(
  category: "fileTypes" | "status" | "actions",
  key: string,
): string | undefined {
  if (category === "status" || category === "actions") {
    return DEFAULT_ICONS[category][
      key as keyof (typeof DEFAULT_ICONS)[typeof category]
    ];
  }
  return undefined;
}

/**
 * Hook to get a themed icon ID
 * @param category - The icon category (fileTypes, status, actions)
 * @param key - The icon key within that category
 * @returns The icon ID (either from theme or default)
 *
 * @example
 * ```tsx
 * const iconId = useThemedIcon('status', 'error');
 * return <ResolvedIcon iconId={iconId} />;
 * ```
 */
export function useThemedIcon(
  category: "fileTypes" | "status" | "actions",
  key: string,
): string | undefined {
  const { iconMappings } = useTheme();

  // Try to get from theme first
  const themedIcon = iconMappings?.[category]?.[key];
  if (themedIcon) {
    return themedIcon;
  }

  // Fall back to default icon
  return getDefaultIcon(category, key);
}
