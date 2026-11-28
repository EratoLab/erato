import { render, renderHook, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { schemaChecks } from "@/lib/shell/catalogue/schemaChecks";
import schema from "@/lib/shell/contract/systemMenus.v1.schema.json";
import {
  emitHostShellEvent,
  installHostShell,
  removeHostShell,
} from "@/test/hostShellStub";

import { useSystemMenu } from "./useSystemMenu";

import type { NativeMenu, SystemMenuOptions } from "./useSystemMenu";
import type { MenuEntry, MenuIcon } from "@/lib/shell/menus/menuEntry";

// An icon drawing that throws, while a test asks for it.
const drawing = vi.hoisted(() => ({ fails: false }));
vi.mock("./drawMenuIcon", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./drawMenuIcon")>();
  return {
    ...actual,
    drawMenuIcon: (icon: MenuIcon) => {
      if (drawing.fails) throw new Error("cannot draw");
      return actual.drawMenuIcon(icon);
    },
  };
});

const entries: MenuEntry[] = [
  { id: "pin", label: "Pin" },
  {
    id: "archive",
    label: "Archive",
    confirm: {
      title: "Archive this chat?",
      message: "Still generating.",
      confirmLabel: "Confirm",
      cancelLabel: "Cancel",
    },
  },
];

const shellAnswering = (answers: Record<string, unknown>) =>
  installHostShell(
    { systemMenus: 1 },
    vi.fn((method: string) =>
      method in answers
        ? answers[method] instanceof Error
          ? Promise.reject(answers[method])
          : Promise.resolve(answers[method])
        : Promise.resolve({ updated: true }),
    ),
  );

const trigger = () => {
  const button = document.createElement("button");
  document.body.append(button);
  return button;
};

const checks = schemaChecks(schema);

const options = (more: Partial<SystemMenuOptions> = {}): SystemMenuOptions => ({
  id: "row",
  mode: "show",
  entries,
  onChoose: vi.fn(),
  ...more,
});

describe("useSystemMenu", () => {
  afterEach(() => {
    const request = (window.ERATO_SHELL as { request?: unknown } | undefined)
      ?.request;
    const calls =
      request && vi.isMockFunction(request) ? [...request.mock.calls] : [];
    removeHostShell();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    drawing.fails = false;
    // What the page sent the app fits the contract.
    for (const [method, params] of calls) {
      expect(checks.errors({ method, params }), String(method)).toEqual([]);
    }
  });

  it("leaves the web menu where the app has no system menus or nothing is described", () => {
    expect(
      renderHook(() => useSystemMenu(options())).result.current,
    ).toBeUndefined();
    shellAnswering({});
    expect(
      renderHook(() => useSystemMenu(options({ entries: null }))).result
        .current,
    ).toBeUndefined();
  });

  it("shows the menu for a tap and does what the pick asks", async () => {
    const request = shellAnswering({
      "systemMenus.show": { shown: true, chosen: "pin" },
    });
    const onChoose = vi.fn();
    const web = vi.fn();
    const { result } = renderHook(() =>
      useSystemMenu(options({ title: "A chat", onChoose })),
    );

    expect(result.current?.open(trigger(), web)).toBe(true);
    await waitFor(() => expect(onChoose).toHaveBeenCalledWith("pin"));
    expect(request).toHaveBeenCalledWith("systemMenus.show", {
      id: "row",
      anchor: { x: 0, y: 0, width: 0, height: 0 },
      title: "A chat",
      items: [
        { id: "pin", label: "Pin" },
        { id: "archive", label: "Archive" },
      ],
    });
    expect(web).not.toHaveBeenCalled();
  });

  it("asks first where the entry says so, and only then acts", async () => {
    const request = shellAnswering({
      "systemMenus.show": { shown: true, chosen: "archive" },
      "systemMenus.confirm": { chosen: "confirm" },
    });
    const onChoose = vi.fn();
    const { result } = renderHook(() => useSystemMenu(options({ onChoose })));

    result.current?.open(trigger(), vi.fn());
    await waitFor(() => expect(onChoose).toHaveBeenCalledWith("archive"));
    expect(request).toHaveBeenCalledWith(
      "systemMenus.confirm",
      expect.objectContaining({
        title: "Archive this chat?",
        message: "Still generating.",
        cancelLabel: "Cancel",
        actions: [{ id: "confirm", label: "Confirm" }],
      }),
    );
  });

  it("does nothing when the question is cancelled or cannot be asked", async () => {
    for (const confirm of [{ chosen: null }, new Error("unavailable")]) {
      const request = shellAnswering({
        "systemMenus.show": { shown: true, chosen: "archive" },
        "systemMenus.confirm": confirm,
      });
      const onChoose = vi.fn();
      const { result, unmount } = renderHook(() =>
        useSystemMenu(options({ onChoose })),
      );
      result.current?.open(trigger(), vi.fn());
      await waitFor(() =>
        expect(request).toHaveBeenCalledWith(
          "systemMenus.confirm",
          expect.anything(),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onChoose).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("opens the web menu when the app does not draw this one", async () => {
    for (const show of [
      { shown: false, unsupported: ["items[0].badge"] },
      new Error("unavailable"),
    ]) {
      shellAnswering({ "systemMenus.show": show });
      const web = vi.fn();
      const { result, unmount } = renderHook(() => useSystemMenu(options()));
      result.current?.open(trigger(), web);
      await waitFor(() => expect(web).toHaveBeenCalledTimes(1));
      unmount();
    }
  });

  it("hands on a flip while the shown menu is open", async () => {
    let close: (answer: unknown) => void = () => {};
    installHostShell(
      { systemMenus: 1 },
      vi.fn((method: string) =>
        method === "systemMenus.show"
          ? new Promise((resolve) => (close = resolve))
          : Promise.resolve({ updated: true }),
      ),
    );
    const onToggle = vi.fn();
    const { result } = renderHook(() =>
      useSystemMenu(
        options({
          id: "filter",
          entries: [
            { id: "notify", label: "Notify", state: "off", keepOpen: true },
          ],
          onToggle,
        }),
      ),
    );
    result.current?.open(trigger(), vi.fn());
    await new Promise((resolve) => setTimeout(resolve, 450));

    emitHostShellEvent("systemMenus.toggled", {
      id: "filter",
      itemId: "notify",
      on: true,
    });
    expect(onToggle).toHaveBeenCalledWith("notify", true);
    close({ shown: true, chosen: null });
    await new Promise((resolve) => setTimeout(resolve, 0));
    emitHostShellEvent("systemMenus.toggled", {
      id: "filter",
      itemId: "notify",
      on: false,
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("attaches to its trigger, keeps the app's menu current, and detaches", async () => {
    const request = shellAnswering({
      "systemMenus.attach": { attached: true },
    });
    const button = trigger();
    const { result, rerender, unmount } = renderHook(
      (props: SystemMenuOptions) => useSystemMenu(props),
      { initialProps: options({ id: "account", mode: "attach" }) },
    );

    result.current?.attachTo(button);
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "systemMenus.attach",
        expect.objectContaining({ id: "account" }),
      ),
    );
    rerender(options({ id: "account", mode: "attach", entries: [entries[0]] }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("systemMenus.update", {
        id: "account",
        items: [{ id: "pin", label: "Pin" }],
      }),
    );
    unmount();
    expect(request).toHaveBeenCalledWith("systemMenus.detach", {
      id: "account",
    });
  });

  // As AnchoredPopover does: its effect runs before its parent's.
  function Trigger({ nativeMenu }: { nativeMenu: NativeMenu | undefined }) {
    const ref = useRef<HTMLButtonElement>(null);
    useEffect(() => {
      if (!nativeMenu) return;
      nativeMenu.attachTo(ref.current);
      return () => nativeMenu.attachTo(null);
    }, [nativeMenu]);
    return <button ref={ref}>Model</button>;
  }
  function AttachedMenu({ entries: shown }: { entries: MenuEntry[] | null }) {
    const nativeMenu = useSystemMenu(
      options({ id: "model", mode: "attach", entries: shown }),
    );
    return <Trigger nativeMenu={nativeMenu} />;
  }

  it("attaches once its entries arrive after the button", async () => {
    const request = shellAnswering({
      "systemMenus.attach": { attached: true },
    });
    const { rerender } = render(<AttachedMenu entries={null} />);
    rerender(<AttachedMenu entries={entries} />);
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "systemMenus.attach",
        expect.objectContaining({ id: "model" }),
      ),
    );
  });

  it("takes back an attachment the app made after the button went", async () => {
    let answer: (value: unknown) => void = () => {};
    const request = installHostShell(
      { systemMenus: 1 },
      vi.fn((method: string) =>
        method === "systemMenus.attach"
          ? new Promise((resolve) => (answer = resolve))
          : Promise.resolve(null),
      ),
    );
    const { unmount } = render(<AttachedMenu entries={entries} />);
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "systemMenus.attach",
        expect.anything(),
      ),
    );
    unmount();
    answer({ attached: true });
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("systemMenus.detach", {
        id: "model",
      }),
    );
  });

  it("does not attach a button in an inert part of the page", async () => {
    const request = shellAnswering({
      "systemMenus.attach": { attached: true },
    });
    render(
      <div inert>
        <AttachedMenu entries={entries} />
      </div>,
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(request).not.toHaveBeenCalledWith(
      "systemMenus.attach",
      expect.anything(),
    );
  });

  it("sends a shown menu's entries once, and again only when they change", async () => {
    const request = installHostShell(
      { systemMenus: 1 },
      vi.fn((method: string) =>
        method === "systemMenus.show"
          ? new Promise(() => {})
          : Promise.resolve({ updated: true }),
      ),
    );
    const { result, rerender } = renderHook(
      (props: SystemMenuOptions) => useSystemMenu(props),
      { initialProps: options() },
    );
    result.current?.open(trigger(), vi.fn());
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "systemMenus.show",
        expect.anything(),
      ),
    );
    rerender(options());
    rerender(options());
    expect(request).not.toHaveBeenCalledWith(
      "systemMenus.update",
      expect.anything(),
    );
    rerender(options({ entries: [entries[0]] }));
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith("systemMenus.update", {
      id: "row",
      items: [{ id: "pin", label: "Pin" }],
    });
  });

  it("opens the web menu on a later tap when the app's menu never came", async () => {
    let answer: (value: unknown) => void = () => {};
    const request = installHostShell(
      { systemMenus: 1 },
      vi.fn(() => new Promise((resolve) => (answer = resolve))),
    );
    const onChoose = vi.fn();
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    const { result } = renderHook(() => useSystemMenu(options({ onChoose })));
    const button = trigger();
    const web = vi.fn();
    expect(result.current?.open(button, web)).toBe(true);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    now.mockReturnValue(4000);
    expect(result.current?.open(button, vi.fn())).toBe(false);
    answer({ shown: true, chosen: "pin" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onChoose).not.toHaveBeenCalled();
    expect(web).not.toHaveBeenCalled();
  });

  it("opens the web menu when asking the app fails", async () => {
    installHostShell(
      { systemMenus: 1 },
      vi.fn(() => {
        throw new Error("bridge gone");
      }),
    );
    const web = vi.fn();
    const { result } = renderHook(() => useSystemMenu(options()));
    result.current?.open(trigger(), web);
    await waitFor(() => expect(web).toHaveBeenCalledTimes(1));
  });

  it("opens the web menu when the menu cannot be readied for the app", async () => {
    const request = shellAnswering({});
    const web = vi.fn();
    const { result } = renderHook(() =>
      useSystemMenu(
        options({
          entries: [{ id: "pin", label: "Pin", icon: { name: "pin" } }],
        }),
      ),
    );
    drawing.fails = true;
    result.current?.open(trigger(), web);
    await waitFor(() => expect(web).toHaveBeenCalledTimes(1));
    expect(request).not.toHaveBeenCalledWith(
      "systemMenus.show",
      expect.anything(),
    );
  });

  it("ignores a second tap and a pick of an entry that is gone", async () => {
    let close: (value: unknown) => void = () => {};
    const request = installHostShell(
      { systemMenus: 1 },
      vi.fn(() => new Promise((resolve) => (close = resolve))),
    );
    const onChoose = vi.fn();
    const { result } = renderHook(() => useSystemMenu(options({ onChoose })));
    const button = trigger();
    result.current?.open(button, vi.fn());
    expect(result.current?.open(button, vi.fn())).toBe(true);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    close({ shown: true, chosen: "deleted" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onChoose).not.toHaveBeenCalled();
  });
});
