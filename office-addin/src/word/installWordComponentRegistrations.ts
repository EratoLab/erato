import {
  componentRegistry,
  registerSentWithDescriptors,
  setWordLiveCards,
} from "@erato/frontend/library";

import { WordHostCardRenderer } from "./components/WordHostCardRenderer";
import { wordSentWithDescriptors } from "./utils/wordSentWith";

export function installWordComponentRegistrations() {
  componentRegistry.HostCardCodeBlock = WordHostCardRenderer;
  setWordLiveCards(true);
  registerSentWithDescriptors(wordSentWithDescriptors);
}
