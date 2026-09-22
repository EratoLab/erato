import { componentRegistry } from "@erato/frontend/library";

import { WordHostCardRenderer } from "./components/WordHostCardRenderer";

export function installWordComponentRegistrations() {
  componentRegistry.HostCardCodeBlock = WordHostCardRenderer;
}
