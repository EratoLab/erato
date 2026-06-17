import { h } from "../react";
import { kitClassName } from "./utils";

import type { ComponentRegistry } from "@erato/frontend/library";

export const ExampleAssistantWelcomeScreen: NonNullable<
  ComponentRegistry["AssistantWelcomeScreen"]
> = ({ assistant, className }) => (
  <section data-component-kit="example" className={kitClassName(className)}>
    <div>{assistant.name}</div>
  </section>
);
