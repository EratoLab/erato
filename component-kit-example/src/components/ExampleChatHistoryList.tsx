import {
  DropdownMenu,
  chatHistoryRowMenuOptions,
  useChatHistoryRowMenuItems,
  useChatHistoryRowPresentation,
} from "@erato/frontend/shared";

import { kitClassName } from "./utils";

import type { ComponentRegistry } from "@erato/frontend/library";
import type { ChatHistoryRowMenuOptions } from "@erato/frontend/shared";

// Badges, subline and menu items arrive already composed and already gated. A
// kit that rebuilds any of them loses every row rule added after it shipped.
const ExampleChatHistoryRow = ({
  menuOptions,
  isCurrent,
  onSelect,
}: {
  menuOptions: ChatHistoryRowMenuOptions;
  isCurrent: boolean;
  onSelect: () => void;
}) => {
  const { session } = menuOptions;
  const { title, badges, subline, ariaLabel } =
    useChatHistoryRowPresentation(session);
  const menuItems = useChatHistoryRowMenuItems(menuOptions);

  return (
    <li className="erato-component-kit-example-chat-row">
      <button
        type="button"
        data-chat-id={session.id}
        aria-label={ariaLabel}
        aria-current={isCurrent ? "page" : undefined}
        onClick={onSelect}
      >
        {badges}
        <span>{title}</span>
      </button>
      <DropdownMenu items={menuItems} />
      {subline}
    </li>
  );
};

export const ExampleChatHistoryList: NonNullable<
  ComponentRegistry["ChatHistoryList"]
> = (props) => (
  <ul
    data-component-kit="example"
    className={`erato-component-kit-example-chat-list ${kitClassName(props.className)}`}
  >
    {props.sessions.map((session) => (
      <ExampleChatHistoryRow
        key={session.id}
        menuOptions={chatHistoryRowMenuOptions(props, session)}
        isCurrent={session.id === props.currentSessionId}
        onSelect={() => props.onSessionSelect(session.id)}
      />
    ))}
  </ul>
);
