import { h } from "../react";
import { kitClassName } from "./utils";

import type { ComponentRegistry } from "@erato/frontend/library";

export const ExampleChatWelcomeScreen: NonNullable<
  ComponentRegistry["ChatWelcomeScreen"]
> = ({ className }) => (
  <section data-component-kit="example" className={kitClassName(className)}>
    <div>Erato</div>
  </section>
);
