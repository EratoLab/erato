import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useCloudSearch } from "./useCloudSearch";

import type { ReactNode } from "react";

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {children}
    </QueryClientProvider>
  );
}
afterEach(() => vi.restoreAllMocks());

function response(name: string) {
  return new Response(
    JSON.stringify({
      drives: [],
      files: [
        {
          id: name,
          name,
          is_folder: false,
          drive_id: "drive",
          drive_name: "Documents",
          parent_path: "/Reports",
        },
      ],
      partial: false,
      truncated: false,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("cloud search requests", () => {
  it("does not search while closed or for a blank query", () => {
    const fetch = vi.spyOn(window, "fetch");
    const { rerender } = renderHook(
      (props) => useCloudSearch({ provider: "sharepoint", ...props }),
      { wrapper, initialProps: { query: "Budget", enabled: false } },
    );
    rerender({ query: "  ", enabled: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("cancels obsolete requests and never replaces a new query with old results", async () => {
    let finishOld!: (response: Response) => void;
    let oldSignal: AbortSignal | null | undefined;
    vi.spyOn(window, "fetch").mockImplementation((input, options) => {
      if (String(input).includes("Budget")) {
        oldSignal = options?.signal;
        return new Promise((resolve) => {
          finishOld = resolve;
        });
      }
      return Promise.resolve(response("Ledger.pdf"));
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result, rerender, unmount } = renderHook(
      (props) =>
        useCloudSearch({ provider: "sharepoint", enabled: true, ...props }),
      {
        initialProps: { query: "Budget" },
        wrapper: ({ children }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      },
    );
    await waitFor(() => expect(finishOld).toBeDefined());
    rerender({ query: "Ledger" });
    await waitFor(() =>
      expect(result.current.files[0]?.name).toBe("Ledger.pdf"),
    );
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => {
      finishOld(response("Budget.pdf"));
    });
    expect(result.current.files[0]?.name).toBe("Ledger.pdf");
    unmount();
    client.clear();
  });
});
