import { create } from "zustand";

import type { LocalTaskView, LocalTaskViewState } from "./localTaskCoordinator";

/**
 * The local-evidence jobs this device knows, by the task's chat, so a parent's
 * task card can show the native state. Fixed states and cloud ids only.
 */
export const useLocalTaskViewsStore = create<{
  byChatId: ReadonlyMap<string, LocalTaskViewState>;
}>(() => ({ byChatId: new Map() }));

export function publishLocalTaskViews(views: readonly LocalTaskView[]): void {
  useLocalTaskViewsStore.setState({
    byChatId: new Map(views.map((view) => [view.chatId, view.state])),
  });
}
