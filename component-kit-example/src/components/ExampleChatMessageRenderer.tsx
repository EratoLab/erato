import { h } from "../react";
import { contentText } from "./utils";

import type { ComponentRegistry } from "@erato/frontend/library";

export const ExampleChatMessageRenderer: NonNullable<
  ComponentRegistry["ChatMessageRenderer"]
> = ({ message, controls: Controls, controlsContext, onMessageAction }) => (
  <article
    data-component-kit="example"
    className="erato-component-kit-example erato-component-kit-example-message"
  >
    <strong>{message.sender}</strong>
    <p>{contentText(message.content)}</p>
    {Controls
      ? Controls({
          messageId: message.id,
          isUserMessage: message.role === "user",
          onAction: onMessageAction,
          context: controlsContext,
        })
      : null}
  </article>
);
