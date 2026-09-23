import { skipToken } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMentionableAssistants } from "../useMentionableAssistants";

const mocks = vi.hoisted(() => ({
  features: vi.fn(),
  list: vi.fn(),
  frequent: vi.fn(),
  hubConfig: vi.fn(),
  hubList: vi.fn(),
}));

vi.mock("@/providers/FeatureConfigProvider", () => ({
  useAssistantsFeature: mocks.features,
}));
vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useListAssistants: mocks.list,
  useFrequentAssistants: mocks.frequent,
  useAssistantHubConfig: mocks.hubConfig,
  useListAssistantHubAssistants: mocks.hubList,
}));

const own = { id: "own", name: "Personal helper" };
const hubVersion = {
  hub_assistant_id: "hub-stable-id",
  assistant_id: "published-assistant-id",
  assistant: { name: "Hub researcher", description: "Research help" },
  creator: { email: null },
};

describe("useMentionableAssistants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.features.mockReturnValue({ enabled: true, delegationEnabled: true });
    mocks.list.mockReturnValue({ data: [own] });
    mocks.frequent.mockReturnValue({ data: { assistants: [] } });
    mocks.hubConfig.mockReturnValue({ data: { enabled: true } });
    mocks.hubList.mockReturnValue({ data: { versions: [hubVersion] } });
  });

  it("offers Hub assistants with the published assistant ID alongside personal assistants", () => {
    const { result } = renderHook(() => useMentionableAssistants());
    expect(result.current.all).toEqual([
      own,
      {
        id: "published-assistant-id",
        name: "Hub researcher",
        description: "Research help",
        ownerEmail: undefined,
      },
    ]);
    expect(result.current.isAvailable).toBe(true);
  });

  it("makes browsing available to users with only Hub assistants", () => {
    mocks.list.mockReturnValue({ data: [] });
    const { result } = renderHook(() => useMentionableAssistants());
    expect(result.current.isAvailable).toBe(true);
    expect(result.current.suggested[0].id).toBe("published-assistant-id");
  });

  it("excludes the bound Hub assistant and archived personal assistants", () => {
    mocks.list.mockReturnValue({
      data: [{ ...own, archived_at: "2026-09-23" }],
    });
    const { result } = renderHook(() =>
      useMentionableAssistants("published-assistant-id"),
    );
    expect(result.current.all).toEqual([]);
    expect(result.current.isAvailable).toBe(false);
  });

  it("preserves frequent suggestions while making Hub assistants browsable", () => {
    mocks.frequent.mockReturnValue({ data: { assistants: [own] } });
    const { result } = renderHook(() => useMentionableAssistants());
    expect(result.current.suggested).toEqual([own]);
    expect(result.current.all).toHaveLength(2);
  });

  it("continues to offer only one assistant per mention name", () => {
    mocks.list.mockReturnValue({ data: [{ ...own, name: "Hub researcher" }] });
    const { result } = renderHook(() => useMentionableAssistants());
    expect(result.current.all).toEqual([{ ...own, name: "Hub researcher" }]);
  });

  it("skips the Hub listing when the Hub is disabled", () => {
    mocks.hubConfig.mockReturnValue({ data: { enabled: false } });
    const { result } = renderHook(() => useMentionableAssistants());
    expect(mocks.hubList).toHaveBeenCalledWith(skipToken);
    expect(result.current.all).toEqual([own]);
  });

  it.each([
    { enabled: false, delegationEnabled: true },
    { enabled: true, delegationEnabled: false },
  ])("skips every query when delegation is unavailable: %o", (features) => {
    mocks.features.mockReturnValue(features);
    const { result } = renderHook(() => useMentionableAssistants());
    for (const query of [
      mocks.list,
      mocks.frequent,
      mocks.hubConfig,
      mocks.hubList,
    ]) {
      expect(query).toHaveBeenCalledWith(skipToken);
    }
    expect(result.current.isAvailable).toBe(false);
  });
});
