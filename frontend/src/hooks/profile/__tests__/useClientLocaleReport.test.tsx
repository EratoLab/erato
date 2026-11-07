import { i18n } from "@lingui/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clientLocaleUpdate,
  resetClientLocaleReportForTests,
  useClientLocaleReport,
} from "../useClientLocaleReport";

import type { UserProfile } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

describe("clientLocaleUpdate", () => {
  it("writes only what the profile lacks or has differently", () => {
    expect(
      clientLocaleUpdate({}, { timeZone: "Europe/Berlin", language: "de" }),
    ).toEqual({
      preference_time_zone: "Europe/Berlin",
      preference_language: "de",
    });
    expect(
      clientLocaleUpdate(
        { preference_time_zone: "Europe/Berlin", preference_language: "de-DE" },
        { timeZone: "Europe/Berlin", language: "de" },
      ),
    ).toEqual({ preference_language: "de" });
  });

  it("writes nothing when the profile already agrees", () => {
    expect(
      clientLocaleUpdate(
        { preference_time_zone: "Europe/Berlin", preference_language: "en-GB" },
        { timeZone: "Europe/Berlin", language: "en-gb" },
      ),
    ).toBeNull();
    expect(
      clientLocaleUpdate({}, { timeZone: undefined, language: undefined }),
    ).toBeNull();
  });
});

describe("useClientLocaleReport", () => {
  const profile = { id: "user-1" } as UserProfile;
  let fetchMock: ReturnType<typeof vi.fn>;

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );

  beforeEach(() => {
    resetClientLocaleReportForTests();
    i18n.loadAndActivate({ locale: "de", messages: {} });
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(profile), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports the browser zone and the UI language once per page load", async () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const first = renderHook(() => useClientLocaleReport(profile), {
      wrapper,
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1beta/me/profile/preferences");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({
      preference_time_zone: zone,
      preference_language: "de",
    });

    first.rerender();
    first.unmount();
    renderHook(() => useClientLocaleReport(profile), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("waits for the profile before deciding", async () => {
    const { rerender } = renderHook(
      ({ current }: { current: UserProfile | undefined }) =>
        useClientLocaleReport(current),
      {
        wrapper,
        initialProps: { current: undefined as UserProfile | undefined },
      },
    );
    expect(fetchMock).not.toHaveBeenCalled();

    rerender({
      current: {
        ...profile,
        preference_time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        preference_language: "de",
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
