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
