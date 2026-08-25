import type { Message } from "@/types/chat";

export interface ModelSwitch {
  fromModel: string;
  toModel: string;
}

/** Reconstruct model switches from persisted assistant generation metadata. */
export function getModelSwitches(
  messages: Record<
    string,
    Pick<Message, "id" | "role" | "chatProviderId" | "previous_message_id">
  >,
  messageOrder: readonly string[],
  modelNames: ReadonlyMap<string, string>,
): Record<string, ModelSwitch> {
  const switches: Record<string, ModelSwitch> = {};
  const modelIdsByUserMessage = new Map<string, string>();

  for (const messageId of messageOrder) {
    const message = messages[messageId];
    if (
      message.role === "assistant" &&
      message.chatProviderId &&
      message.previous_message_id
    ) {
      modelIdsByUserMessage.set(
        message.previous_message_id,
        message.chatProviderId,
      );
    }
  }

  let previousModelId: string | undefined;

  for (const messageId of messageOrder) {
    const message = messages[messageId];
    if (message.role !== "user") {
      continue;
    }

    const modelId =
      modelIdsByUserMessage.get(message.id) ?? message.chatProviderId;
    if (!modelId) {
      previousModelId = undefined;
      continue;
    }

    if (previousModelId && previousModelId !== modelId) {
      switches[message.id] = {
        fromModel: modelNames.get(previousModelId) ?? previousModelId,
        toModel: modelNames.get(modelId) ?? modelId,
      };
    }

    previousModelId = modelId;
  }

  return switches;
}
