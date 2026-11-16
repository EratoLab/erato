import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  reportOfficeHostStart,
  resetOfficeHostReportForTests,
} from "./officeHostReport";

const fetchOfficeHostReport = vi.hoisted(() => vi.fn());
vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  fetchOfficeHostReport,
}));

beforeEach(() => {
  window.sessionStorage.clear();
  resetOfficeHostReportForTests();
  fetchOfficeHostReport.mockReset().mockResolvedValue(undefined);
});
afterEach(() => window.sessionStorage.clear());

describe("reportOfficeHostStart", () => {
  it("reports once per pane start", async () => {
    const report = {
      host: "PowerPoint",
      platform: "PC",
      apiSet: "1.5",
      tier: "basic",
    } as const;
    await reportOfficeHostStart(report);
    await reportOfficeHostStart(report);
    expect(fetchOfficeHostReport).toHaveBeenCalledTimes(1);
    expect(fetchOfficeHostReport).toHaveBeenCalledWith({
      body: {
        host: "PowerPoint",
        platform: "PC",
        api_set: "1.5",
        tier: "basic",
      },
    });
  });

  it("does not count a reload in the same pane again", async () => {
    await reportOfficeHostStart({ host: "Word", platform: "Mac" });
    resetOfficeHostReportForTests();
    await reportOfficeHostStart({ host: "Word", platform: "Mac" });
    expect(fetchOfficeHostReport).toHaveBeenCalledTimes(1);
  });

  it("swallows a failed report and tries again after a reload", async () => {
    fetchOfficeHostReport.mockRejectedValueOnce(new Error("offline"));
    await expect(
      reportOfficeHostStart({ host: "Outlook" }),
    ).resolves.toBeUndefined();
    resetOfficeHostReportForTests();
    await reportOfficeHostStart({ host: "Outlook" });
    expect(fetchOfficeHostReport).toHaveBeenCalledTimes(2);
  });
});
