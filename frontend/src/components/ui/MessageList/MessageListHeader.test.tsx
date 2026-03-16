import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MessageListHeader } from "./MessageListHeader";

describe("MessageListHeader", () => {
  it("uses the theme token for the chat header shell", () => {
    render(
      <MessageListHeader
        showLoadMoreButton={false}
        handleLoadMore={vi.fn()}
        isPending={false}
        showBeginningIndicator={false}
        paginationStats={{ displayed: 0, total: 0 }}
      />,
    );

    expect(screen.getByTestId("chat-header-shell")).toHaveStyle({
      backgroundColor: "var(--theme-shell-chat-header)",
    });
  });
});
