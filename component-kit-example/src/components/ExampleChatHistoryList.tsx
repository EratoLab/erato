import { kitClassName } from "./utils";

import type { ComponentRegistry } from "@erato/frontend/library";

export const ExampleChatHistoryList: NonNullable<
  ComponentRegistry["ChatHistoryList"]
> = ({ sessions, currentSessionId, onSessionSelect, className }) => (
  <nav data-component-kit="example" className={kitClassName(className)}>
    {sessions.map((session) => (
      <button
        key={session.id}
        type="button"
        aria-current={session.id === currentSessionId ? "page" : undefined}
        onClick={() => onSessionSelect(session.id)}
      >
        {session.title ?? session.id}
      </button>
    ))}
  </nav>
);
