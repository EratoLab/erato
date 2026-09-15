import { DropdownMenu, useChatHistoryRow } from "@erato/frontend/shared";

import { kitClassName } from "./utils";

import type {
  ChatHistoryListProps,
  ChatSession,
  ComponentRegistry,
} from "@erato/frontend/library";

// Badges, subline and menu items arrive already composed and already gated. A
// kit that rebuilds any of them loses every row rule added after it shipped.
const ExampleChatHistoryRow = ({
  listProps,
  session,
  isCurrent,
  onSelect,
}: {
  listProps: ChatHistoryListProps;
  session: ChatSession;
  isCurrent: boolean;
  onSelect: () => void;
}) => {
  const { title, badges, subline, ariaLabel, menuItems } = useChatHistoryRow(
    listProps,
    session,
  );

  return (
    // The row element is the one carrying `CHAT_HISTORY_ROW_TEST_ID.row`; the
    // accessible name may sit on it or, as here, on a descendant.
    <li className="erato-component-kit-example-chat-row" data-chat-id={session.id}>
      <button
        type="button"
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
        listProps={props}
        session={session}
        isCurrent={session.id === props.currentSessionId}
        onSelect={() => props.onSessionSelect(session.id)}
      />
    ))}
  </ul>
);
