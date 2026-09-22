import { componentRegistry } from "@erato/frontend/library";

import { WordHostCardRenderer } from "./components/WordHostCardRenderer";

/**
 * Register the Word HostCardCodeBlock renderer before the first chat render.
 * Installing it in an effect would initially render action fences as plain code.
 */
export function installWordComponentRegistrations() {
  componentRegistry.HostCardCodeBlock = WordHostCardRenderer;
}
