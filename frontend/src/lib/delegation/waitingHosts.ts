import { createContext, useContext } from "react";

/**
 * The host each waiting task of a message waits for, by the parent's
 * `delegate_task` call id. A task's slot does not name it; only the waiting
 * item on the message's last stop does.
 */
export const WaitingHostsContext = createContext<
  Readonly<Record<string, string | undefined>>
>({});

export const useWaitingHost = (
  toolCallId: string | undefined,
): string | undefined => {
  const hosts = useContext(WaitingHostsContext);
  return toolCallId === undefined ? undefined : hosts[toolCallId];
};
