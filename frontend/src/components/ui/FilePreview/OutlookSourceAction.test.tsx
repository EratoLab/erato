import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OutlookSourceNavigationProvider } from "@/providers/OutlookSourceNavigationProvider";

import { OutlookSourceAction } from "./OutlookSourceAction";

import type { OutlookFileProvenance } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const state = vi.hoisted(() => ({
  state: "ready",
  discoveryExtensions: {
    "x-erato-outlook-navigation": {
      version: 1,
      target: "classicOutlook",
      launchUriPrefix: "erato-launch://outlook/open?reference=",
      maxReferenceBytes: 16384,
    },
  },
}));
vi.mock("@/providers/DesktopSidecarProvider", () => ({
  useDesktopSidecar: () => ({ snapshot: state }),
}));
const parent = {
  external_ids: [
    { key: "ews_id", value: "parent-ews" },
    { key: "email_message_id", value: "<parent@example.test>" },
  ],
  mailbox: { emailAddress: "shared@example.test" },
};
const provenance: OutlookFileProvenance = {
  version: 1,
  origins: [{ topLevelParent: parent }],
};

beforeEach(() => {
  vi.spyOn(window.navigator, "platform", "get").mockReturnValue("Win32");
  state.state = "ready";
});

describe("Open in Outlook action", () => {
  it("uses Office.js in Outlook even when a desktop link is available, only after a click", async () => {
    const open = vi.fn(async () => {});
    render(
      <OutlookSourceNavigationProvider
        navigator={{ canOpen: () => true, open }}
      >
        <OutlookSourceAction provenance={provenance} />
      </OutlookSourceNavigationProvider>,
    );
    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open in Outlook" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith(parent));
  });
  it("uses the same explicit desktop link without an Outlook adapter (web, Word and Teams)", () => {
    render(
      <OutlookSourceAction
        provenance={
          JSON.parse(JSON.stringify(provenance)) as OutlookFileProvenance
        }
      />,
    );
    const link = screen.getByRole("link", { name: "Open in Outlook" });
    expect(link).toHaveAttribute(
      "href",
      expect.stringMatching(/^erato-launch:\/\/outlook\/open\?reference=/),
    );
    expect(link).toHaveAttribute("target", "_blank");
  });
  it("lets the user choose a different origin and never opens all matches", async () => {
    const other = { external_ids: [{ key: "ews_id", value: "other-ews" }] };
    const open = vi.fn(async () => {});
    render(
      <OutlookSourceNavigationProvider
        navigator={{ canOpen: () => true, open }}
      >
        <OutlookSourceAction
          provenance={{
            version: 1,
            origins: [...provenance.origins, { document: other }],
          }}
        />
      </OutlookSourceNavigationProvider>,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "1" } });
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open in Outlook" }));
    await waitFor(() => expect(open).toHaveBeenCalledExactlyOnceWith(other));
  });
  it("shows an Office.js failure without silently opening a second application", async () => {
    const open = vi.fn().mockRejectedValue(new Error("not found"));
    render(
      <OutlookSourceNavigationProvider
        navigator={{ canOpen: () => true, open }}
      >
        <OutlookSourceAction provenance={provenance} />
      </OutlookSourceNavigationProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open in Outlook" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Outlook could not open this email",
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
  it("has no action for a legacy upload and explains unavailable navigation for a known source", () => {
    const { rerender } = render(<OutlookSourceAction />);
    expect(screen.queryByText("Open in Outlook")).not.toBeInTheDocument();
    state.state = "error";
    rerender(<OutlookSourceAction provenance={provenance} />);
    expect(
      screen.getByText(
        "Opening this source email is unavailable on this device.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
