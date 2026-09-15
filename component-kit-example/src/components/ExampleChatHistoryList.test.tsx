import { chatHistoryListConformanceFailures } from "@erato/frontend/conformance";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { ExampleChatHistoryList } from "./ExampleChatHistoryList";

import type { DropdownMenuItem } from "@erato/frontend/shared";

const rowMenu = vi.hoisted(() => ({ items: [] as DropdownMenuItem[] }));

// This kit hands the gated array straight to the host's menu, so what that
// menu was handed is what the suite has to be shown.
vi.mock("@erato/frontend/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@erato/frontend/shared")>()),
  DropdownMenu: ({ items }: { items: DropdownMenuItem[] }) => {
    rowMenu.items = items;
    return null;
  },
}));

i18n.loadAndActivate({ locale: "en", messages: {} });

it("keeps the host's chat history row contract", () => {
  expect(
    chatHistoryListConformanceFailures(ExampleChatHistoryList, {
      render: (element) => {
        // Cleared per case, so a row that stops rendering a menu at all reads
        // as empty rather than as the previous row's.
        rowMenu.items = [];
        return render(<I18nProvider i18n={i18n}>{element}</I18nProvider>);
      },
      openRowMenu: () => rowMenu.items,
    }),
  ).toEqual([]);
});
