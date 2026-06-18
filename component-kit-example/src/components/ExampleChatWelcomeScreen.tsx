import { h, useLingui } from "../react";
import { kitClassName } from "./utils";

import type { ComponentRegistry } from "@erato/frontend/library";

export const ExampleChatWelcomeScreen: NonNullable<
  ComponentRegistry["ChatWelcomeScreen"]
> = ({ className }) => {
  const { _ } = useLingui();

  return (
    <section data-component-kit="example" className={kitClassName(className)}>
      <div>
        {_({
          id: "componentKit.example.welcome",
          message: "Example component kit",
        })}
      </div>
    </section>
  );
};
