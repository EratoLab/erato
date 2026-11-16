import { fetchOfficeHostReport } from "@/lib/generated/v1betaApi/v1betaApiComponents";

/** What an Office add-in pane runs on; the backend counts each pane start once. */
export interface OfficeHostReport {
  /** `Office.HostType`, e.g. "PowerPoint". */
  host: string;
  /** `Office.PlatformType`, e.g. "PC". */
  platform?: string;
  /** PowerPoint only: the highest PowerPoint API set the pane detected, or "none". */
  apiSet?: string;
  /** PowerPoint only: the pane's read tier. */
  tier?: "full" | "basic" | "none";
}

const REPORTED_KEY = "erato.officeHostReported";
let reported = false;

/**
 * Once per pane start: a reload in the same pane, which keeps session storage, is not counted
 * again. A failed report is dropped; it must never get in the user's way.
 */
export async function reportOfficeHostStart(
  report: OfficeHostReport,
): Promise<void> {
  if (reported) return;
  reported = true;
  try {
    if (window.sessionStorage.getItem(REPORTED_KEY)) return;
  } catch {
    // No session storage: count every load.
  }
  try {
    await fetchOfficeHostReport({
      body: {
        host: report.host,
        platform: report.platform,
        api_set: report.apiSet,
        tier: report.tier,
      },
    });
    window.sessionStorage.setItem(REPORTED_KEY, "1");
  } catch {
    // Counting is best effort.
  }
}

export function resetOfficeHostReportForTests() {
  reported = false;
}
