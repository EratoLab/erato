import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { McpToolRow } from "./McpToolRow";

import type { McpServerTool } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

const tool = (overrides: Partial<McpServerTool> = {}): McpServerTool => ({
  name: "create_attachment",
  title: "Create attachment",
  description: "Uploads a file and attaches it to an issue.",
  description_truncated: false,
  annotations: {
    read_only_hint: false,
    destructive_hint: false,
    idempotent_hint: false,
    open_world_hint: true,
    annotated: true,
  },
  policy: "ask",
  user_decision: "none",
  effective: "ask",
  is_wait_tool: false,
  ...overrides,
});

const HOSTILE_DESCRIPTION =
  "<b>bold</b> [link](https://example.invalid) <script>alert(1)</script> https://example.invalid/plain";

const renderRow = (
  overrides: Partial<McpServerTool> = {},
  control?: ReactNode,
) =>
  render(
    <McpToolRow tool={tool(overrides)} data-testid="row" control={control} />,
  );

const toggle = () => screen.getByRole("button", { expanded: false });

describe("McpToolRow", () => {
  it("starts collapsed with the description absent and the identity in place", () => {
    renderRow();

    const row = screen.getByTestId("row");
    expect(row).toHaveAttribute("data-tool-name", "create_attachment");
    expect(row).toHaveTextContent("Create attachment");
    expect(row).toHaveTextContent("create_attachment");
    expect(
      within(row).getByRole("list", { name: "Create attachment" }),
    ).toBeInTheDocument();
    expect(within(row).getByText("Can modify")).toBeInTheDocument();
    expect(within(row).getByText("Reaches other systems")).toBeInTheDocument();
    expect(within(row).getByText("Asks before running")).toBeInTheDocument();

    const button = screen.getByRole("button", {
      name: "Description of Create attachment",
    });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("mcp-tool-row-description")).toBeNull();
    expect(row).not.toHaveTextContent("Uploads a file");
  });

  it("toggles the description with the mouse and names the panel it controls", () => {
    renderRow();

    fireEvent.click(toggle());

    const button = screen.getByRole("button", { expanded: true });
    const description = screen.getByTestId("mcp-tool-row-description");
    expect(description).toHaveTextContent(
      "Uploads a file and attaches it to an issue.",
    );
    const panelId = button.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId ?? "")).toContainElement(
      description,
    );

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("mcp-tool-row-description")).toBeNull();
  });

  // jsdom has no activation behavior, so Enter and Space cannot be shown to
  // click here. The keyboard contract is the native button's: a focusable
  // <button type="button"> is operated by the user agent with both keys, and
  // no handler of its own is stacked on top (that would fire twice in a
  // browser). The test pins the parts that make the contract hold.
  it("is keyboard-operable as a native focusable button", () => {
    renderRow();

    const button = toggle();
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).not.toHaveAttribute("tabindex");
    expect(button).not.toBeDisabled();
    button.focus();
    expect(button).toHaveFocus();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveFocus();
  });

  it("shows the description as text only, in an isolated writing direction", () => {
    const { container } = renderRow({ description: HOSTILE_DESCRIPTION });

    fireEvent.click(toggle());

    const description = screen.getByTestId("mcp-tool-row-description");
    expect(description).toHaveAttribute("dir", "auto");
    expect(description.className).toContain("unicode-bidi:isolate");
    expect(description.className).toContain("whitespace-pre-wrap");
    expect(description.className).toContain("overflow-wrap:anywhere");
    expect(description.textContent).toBe(HOSTILE_DESCRIPTION);
    expect(container.querySelector("b, a, script")).toBeNull();
  });

  it("says when the description was shortened, and only then", () => {
    const { unmount } = renderRow({ description_truncated: true });
    fireEvent.click(toggle());
    expect(
      screen.getByText("Description shortened by Erato"),
    ).toBeInTheDocument();
    unmount();

    renderRow();
    fireEvent.click(toggle());
    expect(screen.queryByText("Description shortened by Erato")).toBeNull();
  });

  it("offers no disclosure when the server gave no description", () => {
    renderRow({ description: null });

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByTestId("mcp-tool-row-description")).toBeNull();
    expect(screen.getByTestId("row")).toHaveTextContent("Create attachment");
  });

  it("keeps title and name on one line each with the full text as a tooltip", () => {
    renderRow({
      title: "A very long vendor title that does not fit the row at all",
      name: "a_very_long_wire_name_that_does_not_fit_either",
    });

    const title = screen.getByText(
      "A very long vendor title that does not fit the row at all",
    );
    expect(title).toHaveClass("truncate");
    expect(title).toHaveAttribute(
      "title",
      "A very long vendor title that does not fit the row at all",
    );
    const name = screen.getByText(
      "a_very_long_wire_name_that_does_not_fit_either",
    );
    expect(name).toHaveClass("truncate");
    expect(name).toHaveAttribute(
      "title",
      "a_very_long_wire_name_that_does_not_fit_either",
    );
  });

  it("shows the name once when it equals the title", () => {
    renderRow({ title: "create_attachment" });

    expect(screen.getAllByText("create_attachment")).toHaveLength(1);
  });

  it("renders the caller's control after the identity", () => {
    const onChange = vi.fn();
    renderRow(
      {},
      <input type="checkbox" aria-label="In this chat" onChange={onChange} />,
    );

    const row = screen.getByTestId("row");
    const checkbox = within(row).getByRole("checkbox", {
      name: "In this chat",
    });
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledTimes(1);
    // The control trails the identity in DOM order, so a reader meets the
    // tool before its switch.
    const title = screen.getByText("Create attachment");
    expect(
      title.compareDocumentPosition(checkbox) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it("renders as a list item on request", () => {
    render(
      <ul>
        <McpToolRow as="li" tool={tool()} data-testid="row" />
      </ul>,
    );

    expect(screen.getByTestId("row").tagName).toBe("LI");
  });
});
