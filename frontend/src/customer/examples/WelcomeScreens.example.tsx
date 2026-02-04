/**
 * WelcomeScreens - Example Customer Overrides
 *
 * This file shows lightweight overrides for the chat and assistant
 * welcome/empty state components.
 *
 * To use this:
 * 1. Copy this file to: src/customer/components/WelcomeScreens.tsx
 * 2. Update src/config/componentRegistry.ts to import and use it
 *
 * @example
 * // In componentRegistry.ts:
 * import {
 *   WelcomeScreenExample,
 *   AssistantWelcomeScreenExample,
 * } from "@/customer/components/WelcomeScreens";
 *
 * export const componentRegistry: ComponentRegistry = {
 *   ChatWelcomeScreen: WelcomeScreenExample,
 *   AssistantWelcomeScreen: AssistantWelcomeScreenExample,
 * };
 */
import { t } from "@lingui/core/macro";

import type { AssistantWelcomeScreenProps } from "@/components/ui/Assistant/AssistantWelcomeScreen";
import type { WelcomeScreenProps } from "@/components/ui/WelcomeScreen";

export function WelcomeScreenExample({ className = "" }: WelcomeScreenProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-4 p-10 text-center ${className}`}
      data-testid="welcome-screen-example"
    >
      <div className="text-3xl font-semibold text-theme-fg-primary">
        {t({
          id: "customer.welcomeScreenExample.title",
          message: "Welcome to your custom chat",
        })}
      </div>
      <p className="max-w-md text-sm text-theme-fg-secondary">
        {t({
          id: "customer.welcomeScreenExample.subtitle",
          message:
            "This empty state is fully replaceable via componentRegistry.",
        })}
      </p>
    </div>
  );
}

export function AssistantWelcomeScreenExample({
  assistant,
  className = "",
}: AssistantWelcomeScreenProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 p-10 text-center ${className}`}
      data-testid="assistant-welcome-screen-example"
    >
      <div className="text-xl font-semibold text-theme-fg-primary">
        {t({
          id: "customer.assistantWelcomeScreenExample.title",
          message: "Custom assistant home",
        })}
      </div>
      <p className="text-sm text-theme-fg-secondary">
        {t({
          id: "customer.assistantWelcomeScreenExample.subtitle",
          message: "You are chatting with:",
        })}{" "}
        <span className="font-medium text-theme-fg-primary">
          {assistant.name}
        </span>
      </p>
    </div>
  );
}
