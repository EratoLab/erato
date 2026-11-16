// eslint-disable-next-line lingui/no-unlocalized-strings -- HTTP header name
export const X_ERATO_PLATFORM_HEADER = "X-Erato-Platform";

// Surface identifier of this frontend, sent as `X-Erato-Platform` where the
// backend records where a chat was created. The add-in sets its host once;
// the web app keeps the default.
let clientPlatform = "web";

export function setClientPlatform(platform: string): void {
  clientPlatform = platform;
}

export function getClientPlatform(): string {
  return clientPlatform;
}

/** Headers for a request that may create a chat. */
export function clientPlatformHeaders(): Record<string, string> {
  return { [X_ERATO_PLATFORM_HEADER]: clientPlatform };
}

// eslint-disable-next-line lingui/no-unlocalized-strings -- HTTP header name
export const X_ERATO_OFFICE_HOST_HEADER = "X-Erato-Office-Host";

// What an Office add-in pane runs on (host, platform, Office build and host
// specific read support), counted per deployment by the backend's metrics.
let officeHostInfo: Record<string, string> = {};

/** Merges `info` into the add-in's host description; empty values are dropped. */
export function setOfficeHostInfo(info: Record<string, string | undefined>) {
  const next = { ...officeHostInfo };
  for (const [key, value] of Object.entries(info)) {
    if (value) next[key] = value;
    else delete next[key];
  }
  officeHostInfo = next;
}

/** `X-Erato-Office-Host`, e.g. "host=PowerPoint; platform=PC; version=16.0.1"; none outside a pane. */
export function officeHostHeaders(): Record<string, string> {
  const value = Object.entries(officeHostInfo)
    .map(([key, part]) => `${key}=${part.replace(/[;=\s]/g, "")}`)
    .join("; ");
  return value ? { [X_ERATO_OFFICE_HOST_HEADER]: value } : {};
}

export function resetOfficeHostInfoForTests() {
  officeHostInfo = {};
}
