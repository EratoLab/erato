import { act, renderHook } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";

import { useOpenMcpServersSettings } from "../useOpenMcpServersSettings";

import type { ReactNode } from "react";

describe("useOpenMcpServersSettings", () => {
  it.each([false, true])(
    "offers navigation only when the MCP tab is visible (%s)",
    (enabled) => {
      const { result } = renderHook(
        () => ({
          open: useOpenMcpServersSettings(),
          location: useLocation(),
        }),
        {
          wrapper: ({ children }: { children: ReactNode }) => (
            <StaticFeatureConfigProvider
              config={{ userPreferences: { mcpServersTabEnabled: enabled } }}
            >
              <MemoryRouter initialEntries={["/?keep=value"]}>
                {children}
              </MemoryRouter>
            </StaticFeatureConfigProvider>
          ),
        },
      );
      if (enabled) {
        act(() => result.current.open?.());
        expect(result.current.location.search).toBe(
          "?keep=value&preferencesDialog=open&preferencesTab=serversTools",
        );
      } else {
        expect(result.current.open).toBeNull();
        expect(result.current.location.search).toBe("?keep=value");
      }
    },
  );

  it("does not offer navigation without host routing", () => {
    const { result } = renderHook(useOpenMcpServersSettings, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <StaticFeatureConfigProvider
          config={{ userPreferences: { mcpServersTabEnabled: true } }}
        >
          {children}
        </StaticFeatureConfigProvider>
      ),
    });
    expect(result.current).toBeNull();
  });
});
