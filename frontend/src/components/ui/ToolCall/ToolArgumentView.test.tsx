import { i18n } from "@lingui/core";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import { ToolArgumentView } from "./ToolArgumentView";

import type { ToolArgumentNode } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

const UUID = "5f0c2a10-0000-4000-8000-00000000a001";

describe("ToolArgumentView", () => {
  it("never shows a member named by a machine id as a field name", () => {
    const view = {
      path: "",
      kind: "group",
      children: [
        { path: `/${UUID}`, kind: "value", machine_name: true },
        { path: "/stage", kind: "value" },
      ],
    } as unknown as ToolArgumentNode;
    render(
      <ToolArgumentView
        view={view}
        values={
          new Map([
            [
              `/${UUID}`,
              { text: "x", truncated: false, hiddenCharacters: false },
            ],
            [
              "/stage",
              { text: "won", truncated: false, hiddenCharacters: false },
            ],
          ])
        }
      />,
    );
    const shown = screen.getByTestId("tool-argument-view").textContent;
    expect(shown).not.toContain(UUID);
    expect(shown).toContain("an ID (see Technical details)");
    expect(shown).toContain("stage");
  });
});
