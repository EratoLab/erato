import { i18n } from "@lingui/core";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installFakePowerPoint,
  removeFakePowerPoint,
  requirementsUpTo,
} from "../../../test/mocks/powerpoint/fakePowerPoint";
import { powerpointInclusionStore } from "../../hooks/powerpointInclusionStore";
import { powerpointReadSupport } from "../../utils/powerpointReadSupport";
import { PowerPointChatInput } from "../PowerPointChatInput";

import type {
  AddinChatInputRenderProps,
  AddinSendPreparation,
} from "../../../core/AddinChatCore";
import type { AddinChatInputCoreProps } from "../../../core/AddinChatInputCore";
import type { ComposerContextItem } from "@erato/frontend/library";

const mocks = vi.hoisted(() => ({
  composer: null as AddinChatInputCoreProps | null,
  available: new Map<string, () => boolean>(),
}));

vi.mock("../../../core/AddinChatInputCore", () => ({
  AddinChatInputCore: (props: AddinChatInputCoreProps) => {
    mocks.composer = props;
    return null;
  },
}));

vi.mock("@erato/frontend/library", async () => {
  const mock = await import("../../../test/helpers/eratoLibraryMock");
  return mock.createEratoLibraryMock({
    useFacets: () => ({
      data: {
        action_facets: [
          {
            id: "powerpoint_presentation",
            allowed_args: [
              "presentation_name",
              "read_tier",
              "selection_summary",
            ],
          },
        ],
      },
    }),
    registerClientToolExecutor: (
      name: string,
      _executor: unknown,
      isAvailable: () => boolean,
    ) => {
      mocks.available.set(name, isAvailable);
      return () => mocks.available.delete(name);
    },
  });
});

beforeEach(() => {
  i18n.load("en", {});
  i18n.activate("en");
  installFakePowerPoint({
    slides: [{ id: "256#", shapes: [] }],
    selectedSlideIds: ["256#"],
  });
});

afterEach(() => {
  cleanup();
  removeFakePowerPoint();
  powerpointInclusionStore.resetForTests();
  mocks.composer = null;
  mocks.available.clear();
});

function renderInput(set = "1.10") {
  const onSendMessage = vi.fn<AddinChatInputRenderProps["onSendMessage"]>();
  const props = {
    chatId: null,
    onSendMessage,
  } as unknown as AddinChatInputRenderProps;
  render(
    <PowerPointChatInput
      chatInputProps={props}
      support={powerpointReadSupport(requirementsUpTo(set))}
    />,
  );
  return { onSendMessage };
}

const chip = () => mocks.composer?.contextItems?.[0] as ComposerContextItem;
const send = () =>
  act(() => mocks.composer!.onSendMessage("Summarise slide 1"));

describe("PowerPoint composer", () => {
  it("includes the presentation by default and sends the facet with the selection", async () => {
    const { onSendMessage } = renderInput();
    expect(chip()).toMatchObject({ state: "included", label: "Presentation" });
    send();
    const prepare = onSendMessage.mock.calls[0][11] as AddinSendPreparation;
    expect(prepare).toBeDefined();
    const prepared = await prepare.run(new AbortController().signal);
    expect(prepared).toEqual({
      hostContextIdentity: null,
      actionFacet: {
        id: "powerpoint_presentation",
        args: {
          presentation_name: "Presentation",
          read_tier: "full (PowerPointApi 1.10)",
          selection_summary: "Selected slides: 1 (id 256#).",
        },
      },
    });
    expect(
      [...mocks.available.values()].every((isAvailable) => isAvailable()),
    ).toBe(true);
  });

  it("sends nothing of the presentation and withholds the tools once left out", () => {
    const { onSendMessage } = renderInput();
    act(() => chip().onRemove?.());
    expect(chip().state).toBe("suggested");
    send();
    expect(onSendMessage.mock.calls[0][4]).toBeUndefined();
    expect(onSendMessage.mock.calls[0][11]).toBeUndefined();
    expect(
      [...mocks.available.values()].some((isAvailable) => isAvailable()),
    ).toBe(false);
    act(() => chip().onRestore?.());
    expect(chip().state).toBe("included");
  });

  it("keeps the tools listed for the turn when inclusion is turned off after the send", () => {
    renderInput();
    send();
    act(() => chip().onRemove?.());
    expect(
      [...mocks.available.values()].every((isAvailable) => isAvailable()),
    ).toBe(true);
  });

  it("offers no selection read and no chip on a host that cannot read slides", () => {
    renderInput("1.3");
    expect(mocks.composer?.contextItems).toEqual([]);
    expect(mocks.available.size).toBe(0);
  });

  it("registers no selection read on PowerPointApi 1.4", () => {
    renderInput("1.4");
    expect([...mocks.available.keys()]).toEqual([
      "powerpoint_read_presentation",
      "powerpoint_read_slide",
    ]);
  });
});
