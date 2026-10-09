/* eslint-disable lingui/no-unlocalized-strings -- Protocol values and model-facing names. */
export type OutlookStoreVariant =
  | "newOutlookForMac"
  | "newOutlookForWindows"
  | "classic";

/**
 * The Outlook a source or mailbox belongs to, from its catalog `sourceKind`
 * or its `outlook.list_mailboxes.v1` `source`.
 */
export function outlookStoreVariant(
  kindOrSource: string | undefined,
): OutlookStoreVariant | null {
  const value = kindOrSource?.trim().toLowerCase().replaceAll(" ", "");
  if (!value) return null;
  if (value === "macoshxaccount") return "newOutlookForMac";
  if (value === "newoutlookforwindows" || value === "windowsnewoutlook")
    return "newOutlookForWindows";
  if (["pst", "ost", "macosprofile", "outlook"].includes(value))
    return "classic";
  return null;
}

const STORE_NAMES: Record<OutlookStoreVariant, string> = {
  newOutlookForMac: "new Outlook for Mac",
  newOutlookForWindows: "new Outlook for Windows",
  classic: "classic Outlook",
};

/** The Outlook a model should name, e.g. "new Outlook for Mac". */
export function storeName(kindOrSource: string | undefined): string | null {
  const variant = outlookStoreVariant(kindOrSource);
  return variant ? STORE_NAMES[variant] : null;
}
