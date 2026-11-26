import {
  componentRegistry,
  registerSentWithDescriptors,
  setWordLiveCards,
} from "@erato/frontend/library";

import { WordApprovalItemCard } from "./components/WordApprovalItemCard";
import { WordHostCardRenderer } from "./components/WordHostCardRenderer";
import { wordSentWithDescriptors } from "./utils/wordSentWith";

export function installWordComponentRegistrations() {
  componentRegistry.HostCardCodeBlock = WordHostCardRenderer;
  componentRegistry.ApprovalItemCard = WordApprovalItemCard;
  setWordLiveCards(true);
  registerSentWithDescriptors(wordSentWithDescriptors);
}
