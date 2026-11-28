import { getOptionalTranslation } from "@/hooks/i18n";

import type { MenuEntry } from "./menuEntry";
import type { ChatModel } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const MODEL_ID_PREFIX = "model:";

export const modelEntryId = (chatProviderId: string) =>
  `${MODEL_ID_PREFIX}${chatProviderId}`;

/** The chat provider an entry id names, or null for another entry. */
export const modelChoice = (itemId: string): string | null =>
  itemId.startsWith(MODEL_ID_PREFIX)
    ? itemId.slice(MODEL_ID_PREFIX.length)
    : null;

/** A model's description in the person's language, where the server has one. */
export function modelDescription(model: ChatModel): string | null {
  if (!model.model_description) {
    return null;
  }
  // eslint-disable-next-line lingui/no-unlocalized-strings -- Translation key is dynamic by chat provider ID
  const translationId = `chat_models.${model.chat_provider_id}.description`;
  return getOptionalTranslation(translationId) ?? model.model_description;
}

export interface ModelMenuState {
  models: readonly ChatModel[];
  selectedId: string | null;
  /** The choice can be changed now (the chat's settings have loaded). */
  ready: boolean;
}

/**
 * The server's models as one choice. The name, the description and the
 * provider's icon stay separate fields, so no drawing has to read a name out
 * of a picture.
 */
export function describeModelMenu(
  { models, selectedId, ready }: ModelMenuState,
  { descriptions }: { descriptions: boolean },
): MenuEntry[] {
  return models.map((model) => {
    const description = descriptions ? modelDescription(model) : null;
    return {
      id: modelEntryId(model.chat_provider_id),
      label: model.model_display_name,
      ...(description ? { subtitle: description } : {}),
      ...(model.model_icon ? { icon: { iconId: model.model_icon } } : {}),
      state: model.chat_provider_id === selectedId ? "on" : "off",
      ...(!ready ? { disabled: true } : {}),
    };
  });
}
