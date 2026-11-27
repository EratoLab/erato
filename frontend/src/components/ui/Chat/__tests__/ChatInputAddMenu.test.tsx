import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { act, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Row } from "../../Controls/Row";
import { ChatInputAddMenu } from "../ChatInputAddMenu";

/**
 * The trigger is rendered through `AnchoredPopover`'s render-prop, which hands
 * it a `ref` plus the aria/keyboard wiring. Since the trigger is a shared
 * `Button` (a forwardRef component) receiving that bag via spread, these tests
 * pin the wiring end-to-end — a dropped ref or swallowed handler would break
 * the popover silently rather than failing to compile.
 */
describe("ChatInputAddMenu", () => {
  const fileSources = [
    { id: "upload", label: "Upload from Computer", onSelect: vi.fn() },
  ];

  it("wires the popover contract onto the trigger", () => {
    render(<ChatInputAddMenu fileSources={fileSources} />);

    const trigger = screen.getByTestId("chat-input-add-menu-trigger");

    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-controls");
    expect(trigger).toHaveAccessibleName("Add files and tools");
  });

  it("opens and closes the menu on click", () => {
    render(<ChatInputAddMenu fileSources={fileSources} />);

    const trigger = screen.getByTestId("chat-input-add-menu-trigger");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Upload from Computer")).toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("carries no count badge when the selected tools show as chips beside it", () => {
    render(<ChatInputAddMenu fileSources={fileSources} />);

    expect(
      screen.queryByTestId("chat-input-add-menu-badge"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add files and tools" }),
    ).toHaveTextContent("");
  });

  it("shows how many tools are on where no chips show them, and says so to screen readers", () => {
    render(
      <ChatInputAddMenu fileSources={fileSources} selectedToolCount={2} />,
    );

    expect(screen.getByTestId("chat-input-add-menu-badge")).toHaveTextContent(
      "2",
    );
    expect(
      screen.getByTestId("chat-input-add-menu-trigger"),
    ).toHaveAccessibleName("Add files and tools, 2 tools switched on");
  });

  it("offers an exclusive section's rows as radios", () => {
    render(
      <ChatInputAddMenu
        extraSections={[
          {
            id: "model",
            header: "Model",
            items: [
              {
                id: "a",
                label: "Model A",
                checked: true,
                exclusive: true,
                onToggle: vi.fn(),
              },
              {
                id: "b",
                label: "Model B",
                checked: false,
                exclusive: true,
                onToggle: vi.fn(),
              },
            ],
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId("chat-input-add-menu-trigger"));

    expect(
      screen.getByRole("menuitemradio", { name: "Model A" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("menuitemradio", { name: "Model B" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("closes after a radio row is picked, unlike a tool toggle", async () => {
    const onPick = vi.fn();
    render(
      <ChatInputAddMenu
        extraSections={[
          {
            id: "model",
            items: [
              {
                id: "b",
                label: "Model B",
                checked: false,
                exclusive: true,
                onToggle: onPick,
              },
            ],
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId("chat-input-add-menu-trigger"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Model B" }));

    expect(onPick).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });

  describe("a section shown as a sub-menu", () => {
    const onPick = vi.fn();
    const menu = (
      <ChatInputAddMenu
        tools={[{ id: "web", label: "Web", checked: false, onToggle: vi.fn() }]}
        extraSections={[
          {
            id: "model",
            header: "Model",
            placement: "belowTools",
            submenu: { summary: "Model A" },
            items: ["Model A", "Model B"].map((name, index) => ({
              id: `m${index}`,
              label: name,
              checked: index === 0,
              exclusive: true,
              onToggle: () => onPick(name),
            })),
          },
        ]}
      />
    );

    it("shows one row with the current choice instead of the whole list", () => {
      render(menu);
      fireEvent.click(screen.getByTestId("chat-input-add-menu-trigger"));

      const row = screen.getByTestId("chat-input-add-menu-page-model");
      expect(row).toHaveAttribute("aria-haspopup", "menu");
      expect(row).toHaveTextContent("Model");
      expect(row).toHaveTextContent("Model A");
      expect(screen.queryByRole("menuitemradio")).not.toBeInTheDocument();
      expect(
        screen.getByRole("menuitemcheckbox", { name: "Web" }),
      ).toBeVisible();
    });

    it("opens the choices as a page with a back row, and picking one closes the menu", async () => {
      render(menu);
      fireEvent.click(screen.getByTestId("chat-input-add-menu-trigger"));
      fireEvent.click(screen.getByTestId("chat-input-add-menu-page-model"));

      expect(screen.getByTestId("chat-input-add-menu-page-back")).toHaveFocus();
      expect(
        screen.queryByRole("menuitemcheckbox", { name: "Web" }),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("menuitemradio", { name: "Model B" }));

      expect(onPick).toHaveBeenCalledWith("Model B");
      await waitFor(() => {
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      });
    });

    it("goes back by the back row or arrow left, focusing the row that opened it", () => {
      render(menu);
      fireEvent.click(screen.getByTestId("chat-input-add-menu-trigger"));
      const row = () => screen.getByTestId("chat-input-add-menu-page-model");

      fireEvent.keyDown(row(), { key: "ArrowRight" });
      fireEvent.click(screen.getByTestId("chat-input-add-menu-page-back"));
      expect(row()).toHaveFocus();

      fireEvent.click(row());
      fireEvent.keyDown(
        screen.getByRole("menuitemradio", { name: "Model A" }),
        {
          key: "ArrowLeft",
        },
      );
      expect(row()).toHaveFocus();
    });

    it("moves focus to the page, not onto a row, when a finger opened it", () => {
      render(menu);
      fireEvent.click(screen.getByTestId("chat-input-add-menu-trigger"));
      fireEvent.click(screen.getByTestId("chat-input-add-menu-page-model"), {
        detail: 1,
      });

      const page = screen.getByRole("group", { name: "Model" });
      expect(page).toHaveFocus();
      expect(
        screen.getByTestId("chat-input-add-menu-page-back"),
      ).toHaveAccessibleName("Back: Model");
    });

    it("starts on the whole menu again after closing on a page", () => {
      render(menu);
      const trigger = screen.getByTestId("chat-input-add-menu-trigger");
      fireEvent.click(trigger);
      fireEvent.click(screen.getByTestId("chat-input-add-menu-page-model"));
      fireEvent.keyDown(document, { key: "Escape" });
      fireEvent.click(trigger);

      expect(
        screen.getByTestId("chat-input-add-menu-page-model"),
      ).toBeVisible();
    });
  });

  // A mention row puts focus in the composer; closing after the select delay
  // must leave it there instead of returning it to the "+" trigger.
  it("leaves focus where a selected row moved it", async () => {
    render(
      <>
        <textarea aria-label="Composer" />
        <ChatInputAddMenu
          extraSections={[
            {
              id: "assistants",
              items: [
                {
                  id: "researcher",
                  label: "Researcher",
                  onSelect: () =>
                    screen.getByRole("textbox", { name: "Composer" }).focus(),
                },
              ],
            },
          ]}
        />
      </>,
    );

    fireEvent.click(screen.getByTestId("chat-input-add-menu-trigger"));
    // The panel takes focus one frame after opening.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Researcher" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Composer" })).toHaveFocus();
  });

  it("disables the trigger when disabled", () => {
    render(<ChatInputAddMenu fileSources={fileSources} disabled />);

    expect(screen.getByTestId("chat-input-add-menu-trigger")).toBeDisabled();
  });

  /**
   * `extraContent` is a seam an out-of-repo host can fill with its own markup,
   * so the injected row here is a raw button carrying the row marker by hand
   * rather than a `Row`. It must take its place in the walk by document order,
   * not by where it sits in the selector.
   *
   * The same walk pins which rows drop out: a natively-disabled row is skipped,
   * an `aria-disabled` one is not. An unavailable tool has to stay reachable to
   * say why it is unavailable.
   */
  it("roves over injected and own rows in document order, skipping only natively-disabled ones", () => {
    render(
      <ChatInputAddMenu
        fileSources={[
          { id: "upload", label: "Upload from Computer", onSelect: vi.fn() },
          {
            id: "cloud",
            label: "Sharepoint",
            onSelect: vi.fn(),
            disabled: true,
          },
        ]}
        extraContent={() => (
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            data-row-item=""
            data-testid="injected-row"
          >
            Email thread
          </button>
        )}
        tools={[
          {
            id: "search",
            label: "Web search",
            checked: false,
            onToggle: vi.fn(),
          },
          {
            id: "code",
            label: "Code interpreter",
            checked: false,
            disabled: true,
            onToggle: vi.fn(),
          },
        ]}
      />,
    );

    // detail 1 is a pointer open, which leaves focus on the panel; a
    // keyboard open would have focused the first row already.
    fireEvent.click(screen.getByTestId("chat-input-add-menu-trigger"), {
      detail: 1,
    });
    const menu = screen.getByRole("menu");

    // The unavailable tool announces itself rather than vanishing from the
    // keyboard walk; the unavailable file source is natively disabled and does.
    expect(screen.getByTestId("chat-input-add-menu-tool-code")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByText("Sharepoint").closest("button")).toBeDisabled();

    const walk: (string | null)[] = [];
    for (let step = 0; step < 4; step += 1) {
      fireEvent.keyDown(menu, { key: "ArrowDown" });
      walk.push(
        (document.activeElement as HTMLElement | null)?.textContent ?? null,
      );
    }

    expect(walk).toEqual([
      "Upload from Computer",
      "Email thread",
      "Web search",
      "Code interpreter",
    ]);
  });

  /**
   * The add-in injects status lines — "Loading email thread…", a persistent
   * thread-load error — as non-interactive `Row`s. They render as plain divs
   * with no role and no tab stop, so `.focus()` on one does nothing: were they
   * in the selector, the walk would recompute the same index on every key and
   * never move again, and the error line would wall off the menu for good.
   */
  it("steps over non-interactive rows instead of stalling on them", () => {
    render(
      <ChatInputAddMenu
        fileSources={[
          { id: "upload", label: "Upload from Computer", onSelect: vi.fn() },
        ]}
        extraContent={() => (
          <>
            <Row variant="menu" as="div" interactive={false} tone="muted">
              Loading email thread...
            </Row>
            <Row variant="menu" role="menuitem" tabIndex={-1}>
              Email thread
            </Row>
          </>
        )}
        tools={[
          {
            id: "search",
            label: "Web search",
            checked: false,
            onToggle: vi.fn(),
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByTestId("chat-input-add-menu-trigger"), {
      detail: 1,
    });
    const menu = screen.getByRole("menu");

    const walk: (string | null)[] = [];
    for (let step = 0; step < 4; step += 1) {
      fireEvent.keyDown(menu, { key: "ArrowDown" });
      walk.push(
        (document.activeElement as HTMLElement | null)?.textContent ?? null,
      );
    }

    expect(walk).toEqual([
      "Upload from Computer",
      "Email thread",
      "Web search",
      "Upload from Computer",
    ]);
  });

  /**
   * The worst shape is a menu whose first panel child is a status line: with
   * uploads unavailable the host passes no file sources at all, so a keyboard
   * open would aim `initialFocusSelector` at something that cannot take focus
   * and the menu would open with focus nowhere.
   */
  it("opens on the first navigable row when a status line comes first", async () => {
    render(
      <ChatInputAddMenu
        fileSources={[]}
        extraContent={() => (
          <>
            <Row variant="menu" as="div" interactive={false} tone="error">
              Couldn&apos;t load this conversation from the server.
            </Row>
            <Row variant="menu" role="menuitem" tabIndex={-1}>
              Email thread
            </Row>
          </>
        )}
      />,
    );

    // detail 0 is a keyboard activation, which focuses the first row on open.
    fireEvent.click(screen.getByTestId("chat-input-add-menu-trigger"), {
      detail: 0,
    });

    await waitFor(() => {
      expect((document.activeElement as HTMLElement | null)?.textContent).toBe(
        "Email thread",
      );
    });
  });

  describe("dividers", () => {
    const tools = [
      { id: "search", label: "Web search", checked: false, onToggle: vi.fn() },
    ];
    const separators = () => screen.queryAllByRole("separator");
    const open = () =>
      fireEvent.click(screen.getByTestId("chat-input-add-menu-trigger"));

    it("draws one divider between sections without host content", () => {
      render(<ChatInputAddMenu fileSources={fileSources} tools={tools} />);
      open();
      expect(separators()).toHaveLength(1);
    });

    it("draws a divider on each side of host content that renders a row", () => {
      render(
        <ChatInputAddMenu
          fileSources={fileSources}
          tools={tools}
          extraContent={() => (
            <Row variant="menu" role="menuitem" tabIndex={-1}>
              Email thread
            </Row>
          )}
        />,
      );
      open();
      expect(separators()).toHaveLength(2);
    });

    it("draws no divider for host content that renders nothing, wherever it sits", () => {
      const Nothing = () => null;
      const { unmount } = render(
        <ChatInputAddMenu
          fileSources={fileSources}
          tools={tools}
          extraContent={() => <Nothing />}
        />,
      );
      open();
      expect(separators()).toHaveLength(1);
      unmount();

      render(
        <ChatInputAddMenu tools={tools} extraContent={() => <Nothing />} />,
      );
      open();
      expect(separators()).toHaveLength(0);
    });

    it("adds the dividers when host content starts rendering a row while open", async () => {
      let show: (value: boolean) => void = () => {};
      const Toggled = () => {
        const [visible, setVisible] = useState(false);
        show = setVisible;
        return visible ? (
          <Row variant="menu" role="menuitem" tabIndex={-1}>
            Email thread
          </Row>
        ) : null;
      };
      render(
        <ChatInputAddMenu
          fileSources={fileSources}
          tools={tools}
          extraContent={() => <Toggled />}
        />,
      );
      open();
      expect(separators()).toHaveLength(1);
      await act(async () => show(true));
      expect(separators()).toHaveLength(2);
      await act(async () => show(false));
      expect(separators()).toHaveLength(1);
    });
  });
});
