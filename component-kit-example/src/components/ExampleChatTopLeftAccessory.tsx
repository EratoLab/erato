import { h } from "../react";

import type { ComponentRegistry } from "@erato/frontend/library";

export const ExampleChatTopLeftAccessory: NonNullable<
  ComponentRegistry["ChatTopLeftAccessory"]
> = () => <span data-component-kit="example" hidden />;
