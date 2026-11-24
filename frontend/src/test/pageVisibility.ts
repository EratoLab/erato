import { vi } from "vitest";

/** Shows or hides the page the way a browser does, `visibilitychange` included. */
export function setPageVisibility(visibility: DocumentVisibilityState) {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(visibility);
  vi.spyOn(document, "hidden", "get").mockReturnValue(visibility === "hidden");
  document.dispatchEvent(new Event("visibilitychange"));
}
