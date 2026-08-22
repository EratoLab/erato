import { createContext, useContext } from "react";

import type { ReactNode } from "react";

const DelegatedRunOpenContext = createContext<
  ((chatId: string) => void) | null
>(null);

/**
 * How the host opens a delegated run from surfaces buried deep in the
 * message tree (the trace's open-run affordance), where prop threading
 * would have to survive custom message renderers. Web surfaces mount no
 * provider and keep the default new-tab link; a host without chat routes
 * (the add-in pane) supplies its own opener instead.
 */
export function DelegatedRunOpenProvider({
  onOpen,
  children,
}: {
  onOpen: (chatId: string) => void;
  children: ReactNode;
}) {
  return (
    <DelegatedRunOpenContext.Provider value={onOpen}>
      {children}
    </DelegatedRunOpenContext.Provider>
  );
}

export const useDelegatedRunOpener = () => useContext(DelegatedRunOpenContext);
