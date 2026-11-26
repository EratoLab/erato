import { useEffect, useRef, useState } from "react";

import { useIsBelow } from "@/hooks/useResponsive";

import { Card } from "../Container/Card";
import { Row } from "../Controls/Row";
import { ChevronRightIcon } from "../icons";

import type React from "react";

interface UseSettingsPagesOptions<T extends string> {
  isOpen: boolean;
  activeTab: T;
  onActiveTabChange: (tab: T) => void;
  /** Open on `activeTab`'s page instead of the list, as a link to one setting does. */
  startOnPage: boolean;
}

export interface SettingsPagesState<T extends string> {
  /** Below `sm`: the dialog fills the screen and its tabs become pages. */
  isNarrow: boolean;
  /** The list of pages is showing instead of a page. */
  showList: boolean;
  /** The tab whose content is on screen; `null` while the list shows. */
  shownTab: T | null;
  /** The page open on a narrow screen, which titles the dialog; `null` otherwise. */
  page: T | null;
  openPage: (tab: T) => void;
  backToList: () => void;
  backButtonRef: React.RefObject<HTMLButtonElement | null>;
  listRef: React.RefObject<HTMLElement | null>;
  /** Tab-panel semantics on a wide screen; on a narrow one no tab list exists to label it. */
  panelProps: (
    tab: T,
    ids: { tabId: string; panelId: string },
  ) => {
    id: string;
    hidden: boolean;
    role?: "tabpanel";
    "aria-labelledby"?: string;
  };
}

/**
 * Settings on a narrow screen, the way a phone's own settings work: a list of
 * the dialog's tabs, each opening its page with a way back. On a wider screen
 * the caller keeps its tab rail and this only reports `isNarrow: false`.
 */
export function useSettingsPages<T extends string>({
  isOpen,
  activeTab,
  onActiveTabChange,
  startOnPage,
}: UseSettingsPagesOptions<T>): SettingsPagesState<T> {
  const isNarrow = useIsBelow("sm");
  const [onList, setOnList] = useState(!startOnPage);
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setOnList(!startOnPage);
    }
  }

  const backButtonRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLElement | null>(null);
  // Set only by navigation: opening the dialog leaves focus to ModalBase, which
  // must see focus outside the dialog to remember what to return it to.
  const pendingFocusRef = useRef<{ to: "back" } | { to: "row"; tab: T } | null>(
    null,
  );
  useEffect(() => {
    const pending = pendingFocusRef.current;
    pendingFocusRef.current = null;
    if (pending?.to === "back") {
      backButtonRef.current?.focus();
    } else if (pending?.to === "row") {
      listRef.current
        ?.querySelector<HTMLElement>(`[data-settings-page="${pending.tab}"]`)
        ?.focus();
    }
  }, [onList]);

  const showList = isNarrow && onList;
  const shownTab = showList ? null : activeTab;

  return {
    isNarrow,
    showList,
    shownTab,
    page: isNarrow ? shownTab : null,
    openPage: (tab) => {
      onActiveTabChange(tab);
      pendingFocusRef.current = { to: "back" };
      setOnList(false);
    },
    backToList: () => {
      pendingFocusRef.current = { to: "row", tab: activeTab };
      setOnList(true);
    },
    backButtonRef,
    listRef,
    panelProps: (tab, { tabId, panelId }) => ({
      id: panelId,
      hidden: tab !== shownTab,
      ...(isNarrow ? {} : { role: "tabpanel", "aria-labelledby": tabId }),
    }),
  };
}

interface SettingsPageListProps<T extends string> {
  pages: { value: T; label: string }[];
  onOpen: (tab: T) => void;
  /** Names the list for assistive technology; the dialog's title. */
  label: string;
  listRef: React.Ref<HTMLElement>;
}

/** The narrow screen's list of settings pages: one grouped section of rows. */
export function SettingsPageList<T extends string>({
  pages,
  onOpen,
  label,
  listRef,
}: SettingsPageListProps<T>) {
  return (
    <nav ref={listRef} aria-label={label} data-ui="settings-page-list">
      <Card
        variant="surface"
        as="ul"
        size="xs"
        className="flex flex-col gap-0.5"
      >
        {pages.map((page) => (
          <li key={page.value}>
            <Row
              variant="list"
              onClick={() => onOpen(page.value)}
              data-settings-page={page.value}
              trailing={
                <ChevronRightIcon
                  aria-hidden="true"
                  className="size-5 text-theme-fg-muted"
                />
              }
              className="min-h-[44px] w-full items-center gap-3 px-3 py-2 text-base text-theme-fg-primary"
            >
              {page.label}
            </Row>
          </li>
        ))}
      </Card>
    </nav>
  );
}
