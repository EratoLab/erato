/* eslint-disable lingui/no-unlocalized-strings -- Settings URL parameters and values */

type SettingsLocation = {
  pathname: string;
  search: string;
  hash: string;
};

/** Build a link to Disclaimers on a page that hosts the Settings dialog. */
export function disclaimersSettingsHref({
  pathname,
  search,
  hash,
}: SettingsLocation): string {
  const params = new URLSearchParams(search);
  params.set("preferencesDialog", "open");
  params.set("preferencesTab", "disclaimers");
  params.delete("mcpServerId");
  return `${pathname}?${params.toString()}${hash}`;
}

export function isDisclaimersSettingsLink(params: URLSearchParams): boolean {
  return (
    params.get("preferencesDialog") === "open" &&
    params.get("preferencesTab") === "disclaimers"
  );
}

/** Remove the Settings handoff while keeping other state in the URL. */
export function settingsClosedLocation({
  pathname,
  search,
  hash,
}: SettingsLocation): SettingsLocation {
  const params = new URLSearchParams(search);
  params.delete("preferencesDialog");
  params.delete("preferencesTab");
  params.delete("mcpServerId");
  return { pathname, search: params.size ? `?${params.toString()}` : "", hash };
}
