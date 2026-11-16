import { reportOfficeHostStart } from "@erato/frontend/library";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OfficeHostReport } from "../OfficeHostReport";
import { useOffice } from "../OfficeProvider";

vi.mock("@erato/frontend/library", () => ({
  reportOfficeHostStart: vi.fn(() => Promise.resolve()),
}));
vi.mock("../OfficeProvider", () => ({ useOffice: vi.fn() }));

const office = (host: string | null, platform: string | null) =>
  vi.mocked(useOffice).mockReturnValue({
    isReady: true,
    host,
    platform,
    mailboxUser: null,
    supportsAudioCapture: false,
    itemTrackingRequiresPin: false,
  });

afterEach(() => {
  cleanup();
  vi.mocked(reportOfficeHostStart).mockClear();
});

describe("OfficeHostReport", () => {
  it("reports Outlook's host and platform once", () => {
    office("Outlook", "OfficeOnline");
    const { rerender } = render(<OfficeHostReport />);
    rerender(<OfficeHostReport />);
    expect(reportOfficeHostStart).toHaveBeenCalledTimes(1);
    expect(reportOfficeHostStart).toHaveBeenCalledWith({
      host: "Outlook",
      platform: "OfficeOnline",
    });
  });

  it("adds PowerPoint's API set and read tier", () => {
    office("PowerPoint", "PC");
    render(
      <OfficeHostReport details={() => ({ apiSet: "1.5", tier: "basic" })} />,
    );
    expect(reportOfficeHostStart).toHaveBeenCalledWith({
      host: "PowerPoint",
      platform: "PC",
      apiSet: "1.5",
      tier: "basic",
    });
  });

  it("leaves out a platform Office did not report and sends nothing outside Office", () => {
    office("Word", null);
    render(<OfficeHostReport />);
    expect(reportOfficeHostStart).toHaveBeenCalledWith({ host: "Word" });
    cleanup();
    vi.mocked(reportOfficeHostStart).mockClear();
    office(null, null);
    render(<OfficeHostReport />);
    expect(reportOfficeHostStart).not.toHaveBeenCalled();
  });
});
