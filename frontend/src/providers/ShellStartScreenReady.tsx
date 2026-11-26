import { useEffect } from "react";

import { reportDrawnWhenSettled } from "@/lib/shellStartScreen";

/**
 * Mounted with the app's layout: tells a host app that covers the starting
 * page (`startScreen`) once the layout and its first data are on screen.
 */
export function ShellStartScreenReady() {
  useEffect(() => reportDrawnWhenSettled(), []);
  return null;
}
