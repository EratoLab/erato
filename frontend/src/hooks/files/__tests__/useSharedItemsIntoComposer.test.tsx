import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFileUploadStore } from "../useFileUploadStore";
import { useSharedItemsIntoComposer } from "../useSharedItemsIntoComposer";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

type Listener = (payload: unknown) => void;

function base64(text: string) {
  return window.btoa(text);
}

function installShell({
  capabilities = { share: 1 },
  pending = [] as unknown[],
  reject,
}: {
  capabilities?: Record<string, number>;
  pending?: unknown[];
  reject?: unknown;
} = {}) {
  const listeners = new Map<string, Set<Listener>>();
  let waiting = [...pending];
  const shell = {
    contract: 1,
    platform: "mobile",
    shellVersion: "0.0.0",
    capabilities,
    request: vi.fn((method: string) => {
      if (method !== "share.takePending") {
        return Promise.reject({ code: "unknownMethod", message: method });
      }
      if (reject !== undefined) return Promise.reject(reject);
      const batches = waiting;
      waiting = [];
      return Promise.resolve({ batches });
    }),
    on: vi.fn((event: string, listener: Listener) => {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
      return () => set.delete(listener);
    }),
  };
  (window as { ERATO_SHELL?: unknown }).ERATO_SHELL = shell;
  return {
    shell,
    share(...batches: unknown[]) {
      waiting.push(...batches);
      for (const listener of listeners.get("share.available") ?? []) {
        listener({ count: batches.length });
      }
    },
    listenerCount: () => listeners.get("share.available")?.size ?? 0,
  };
}

function readText(file: File) {
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsText(file);
  });
}

function batch(id: string, items: unknown[]) {
  return { id, createdAt: "2026-11-24T15:35:01Z", items };
}

function uploadedItem(file: File): FileUploadItem {
  return {
    id: `id-${file.name}`,
    filename: file.name,
    download_url: `https://files.test/${file.name}`,
  } as FileUploadItem;
}

function setup(
  overrides: Partial<Parameters<typeof useSharedItemsIntoComposer>[0]> = {},
) {
  const uploadFiles = vi.fn((files: File[]) =>
    Promise.resolve(files.map(uploadedItem)),
  );
  const addUploadedFiles = vi.fn();
  const appendToDraft = vi.fn();
  const props = {
    ready: true,
    uploadFiles,
    addUploadedFiles,
    appendToDraft,
    maxSizeBytes: 20 * 1024 * 1024,
    maxSizeFormatted: "20 MB",
    ...overrides,
  };
  const hook = renderHook(
    (current: typeof props) => useSharedItemsIntoComposer(current),
    { initialProps: props },
  );
  return { ...hook, props, uploadFiles, addUploadedFiles, appendToDraft };
}

describe("useSharedItemsIntoComposer", () => {
  beforeEach(() => {
    useFileUploadStore.getState().setError(null);
  });

  afterEach(() => {
    delete (window as { ERATO_SHELL?: unknown }).ERATO_SHELL;
  });

  it("puts every kind of item waiting at start into the composer", async () => {
    const { shell } = installShell({
      pending: [
        batch("a", [{ kind: "url", url: "https://example.com/" }]),
        batch("b", [
          { kind: "text", text: "Please summarise this" },
          {
            kind: "file",
            fileName: "photo.jpeg",
            contentType: "image/jpeg",
            size: 5,
            data: base64("jpeg!"),
          },
        ]),
        batch("c", [
          {
            kind: "file",
            fileName: "notes.txt",
            contentType: "text/plain",
            size: 5,
            data: base64("hello"),
          },
        ]),
      ],
    });

    const { uploadFiles, addUploadedFiles, appendToDraft } = setup();

    await waitFor(() => expect(addUploadedFiles).toHaveBeenCalledTimes(1));
    expect(shell.request).toHaveBeenCalledTimes(1);
    expect(appendToDraft).toHaveBeenCalledWith(
      "https://example.com/\n\nPlease summarise this",
    );
    expect(uploadFiles).toHaveBeenCalledTimes(1);
    const files = uploadFiles.mock.calls[0][0];
    expect(files.map((file) => [file.name, file.type])).toEqual([
      ["photo.jpeg", "image/jpeg"],
      ["notes.txt", "text/plain"],
    ]);
    expect(await readText(files[1])).toBe("hello");
    expect(addUploadedFiles).toHaveBeenCalledWith([
      expect.objectContaining({ filename: "photo.jpeg" }),
      expect.objectContaining({ filename: "notes.txt" }),
    ]);
    expect(useFileUploadStore.getState().error).toBeNull();
  });

  it("takes items again when the shell says more are waiting", async () => {
    const { shell, share } = installShell();
    const { appendToDraft } = setup();
    await waitFor(() => expect(shell.request).toHaveBeenCalledTimes(1));
    expect(appendToDraft).not.toHaveBeenCalled();

    act(() => {
      share(batch("a", [{ kind: "text", text: "Shared later" }]));
    });

    await waitFor(() =>
      expect(appendToDraft).toHaveBeenCalledWith("Shared later"),
    );
    expect(shell.request).toHaveBeenCalledTimes(2);
  });

  it("leaves items with the shell until the composer can take them", async () => {
    const { shell } = installShell({
      pending: [batch("a", [{ kind: "text", text: "Waiting" }])],
    });
    const { rerender, props, appendToDraft } = setup({ ready: false });

    await act(async () => {});
    expect(shell.request).not.toHaveBeenCalled();

    rerender({ ...props, ready: true });

    await waitFor(() => expect(appendToDraft).toHaveBeenCalledWith("Waiting"));
  });

  it("names a file that arrived without its content", async () => {
    installShell({
      pending: [
        batch("a", [
          {
            kind: "file",
            fileName: "video.mov",
            contentType: "video/quicktime",
            size: 12 * 1024 * 1024,
          },
        ]),
      ],
    });
    const { uploadFiles } = setup();

    await waitFor(() =>
      expect(useFileUploadStore.getState().error?.message).toBe(
        "video.mov was too large to bring over from the other app. Add it with the + button instead.",
      ),
    );
    expect(uploadFiles).not.toHaveBeenCalled();
  });

  it("names a file over the upload limit and still attaches the others", async () => {
    installShell({
      pending: [
        batch("a", [
          {
            kind: "file",
            fileName: "big.pdf",
            size: 30 * 1024 * 1024,
          },
          {
            kind: "file",
            fileName: "small.txt",
            contentType: "text/plain",
            size: 2,
            data: base64("hi"),
          },
        ]),
      ],
    });
    const { uploadFiles, addUploadedFiles } = setup();

    await waitFor(() =>
      expect(useFileUploadStore.getState().error?.message).toBe(
        "File is too large: big.pdf. Maximum size: 20 MB.",
      ),
    );
    expect(uploadFiles.mock.calls[0][0].map((file) => file.name)).toEqual([
      "small.txt",
    ]);
    expect(addUploadedFiles).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the shell refuses the request", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { shell } = installShell({
      reject: { code: "unavailable", message: "storage" },
    });
    const { uploadFiles, appendToDraft } = setup();

    await waitFor(() => expect(shell.request).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(uploadFiles).not.toHaveBeenCalled();
    expect(appendToDraft).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does nothing without the share capability", async () => {
    const { shell, listenerCount } = installShell({ capabilities: {} });
    setup();

    await act(async () => {});
    expect(shell.request).not.toHaveBeenCalled();
    expect(listenerCount()).toBe(0);
  });

  it("does nothing in a browser without a shell", async () => {
    const { uploadFiles, appendToDraft } = setup();

    await act(async () => {});
    expect(uploadFiles).not.toHaveBeenCalled();
    expect(appendToDraft).not.toHaveBeenCalled();
  });

  it("stops listening when the composer goes away", async () => {
    const { listenerCount } = installShell();
    const { unmount } = setup();
    expect(listenerCount()).toBe(1);

    unmount();

    expect(listenerCount()).toBe(0);
  });
});
