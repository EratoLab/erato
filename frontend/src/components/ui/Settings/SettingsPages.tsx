import { useEffect, useRef, useState } from "react";

import { useIsBelow } from "@/hooks/useResponsive";

import { Card } from "../Container/Card";
import { Row } from "../Controls/Row";
import { ChevronRightIcon } from "../icons";

import type React from "react";

/**
 * Below `sm` settings dialogs fill the screen and their tabs become pages.
 * Settings that look different on such a page (switches) read the same flag.
 */
export function useIsSettingsPageScreen(): boolean {
  return useIsBelow("sm");
}

/** A click with no pointer position came from the keyboard (Enter, Space). */
const fromKeyboard = (event?: React.MouseEvent) =>
  event === undefined || event.detail === 0;

const dialogOf = (event?: React.MouseEvent) =>
  event?.currentTarget instanceof Element
    ? event.currentTarget.closest<HTMLElement>('[data-ui="modal-shell"]')
    : null;

interface UseSettingsPagesOptions<T extends string> {
  isOpen: boolean;
  /** The dialog's visible tabs, in order. */
  tabs: { value: T; label: string }[];
  activeTab: T;
  onActiveTabChange: (tab: T) => void;
  /**
   * The tab a link asks for. The dialog then opens on its page instead of the
   * list, and goes to it when a new one is asked for while open.
   */
  requestedTab?: T;
  /** The dialog's title, on the list and naming it. */
  title: string;
  /** The back button's accessible name, such as "Back to Settings". */
  backLabel: string;
}

export interface SettingsPagesState<T extends string> {
  /** Below `sm`: the dialog fills the screen and its tabs become pages. */
  isNarrow: boolean;
  /** The list of pages is showing instead of a page. */
  showList: boolean;
  /** The tab whose content is on screen; `null` while the list shows. */
  shownTab: T | null;
  /** Spread onto ModalBase. */
  modalProps: {
    title: string;
    back?: {
      label: string;
      onBack: (event?: React.MouseEvent) => void;
      ref: React.Ref<HTMLButtonElement>;
    };
    placement: "center" | "fullscreen";
  };
  /** Spread onto SettingsPageList. */
  listProps: SettingsPageListProps<T>;
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
 * the caller keeps its tab rail and `modalProps` keeps the centred dialog.
 */
export function useSettingsPages<T extends string>({
  isOpen,
  tabs,
  activeTab,
  onActiveTabChange,
  requestedTab,
  title,
  backLabel,
}: UseSettingsPagesOptions<T>): SettingsPagesState<T> {
  const isNarrow = useIsSettingsPageScreen();
  const [onList, setOnList] = useState(requestedTab === undefined);
  // `undefined` while closed, `null` while open with no page asked for.
  const request = isOpen ? (requestedTab ?? null) : undefined;
  const [lastRequest, setLastRequest] = useState(request);
  if (request !== lastRequest) {
    setLastRequest(request);
    if (lastRequest === undefined) {
      setOnList(request === null);
    } else if (request !== null && request !== undefined) {
      setOnList(false);
    }
  }

  const backButtonRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  // The button that was pressed goes away, so focus has to move or it falls
  // out of the dialog. From the keyboard it goes to the next control; after a
  // tap or click to the dialog itself, which reads out the new title and
  // shows no ring (iOS rings a button focused after a tap). Opening leaves
  // focus to ModalBase, which must see it outside the dialog to remember what
  // to return it to.
  const pendingFocusRef = useRef<
    | { to: "back" }
    | { to: "row"; tab: T }
    | { to: "dialog"; dialog: HTMLElement | null }
    | null
  >(null);
  useEffect(() => {
    const pending = pendingFocusRef.current;
    pendingFocusRef.current = null;
    if (pending?.to === "dialog") {
      pending.dialog?.focus({ preventScroll: true });
    } else if (pending?.to === "back") {
      backButtonRef.current?.focus();
    } else if (pending?.to === "row") {
      listRef.current
        ?.querySelector<HTMLElement>(`[data-settings-page="${pending.tab}"]`)
        ?.focus();
    }
  }, [onList]);

  const showList = isNarrow && onList;
  const shownTab = showList ? null : activeTab;
  const page = isNarrow ? shownTab : null;
  const pageLabel = tabs.find((tab) => tab.value === page)?.label;

  return {
    isNarrow,
    showList,
    shownTab,
    modalProps: {
      title: pageLabel ?? title,
      back:
        page === null
          ? undefined
          : {
              label: backLabel,
              onBack: (event) => {
                pendingFocusRef.current = fromKeyboard(event)
                  ? { to: "row", tab: activeTab }
                  : { to: "dialog", dialog: dialogOf(event) };
                setOnList(true);
              },
              ref: backButtonRef,
            },
      placement: isNarrow ? "fullscreen" : "center",
    },
    listProps: {
      pages: tabs,
      label: title,
      listRef,
      onOpen: (tab, event) => {
        onActiveTabChange(tab);
        pendingFocusRef.current = fromKeyboard(event)
          ? { to: "back" }
          : { to: "dialog", dialog: dialogOf(event) };
        setOnList(false);
      },
    },
    panelProps: (tab, { tabId, panelId }) => ({
      id: panelId,
      hidden: tab !== shownTab,
      ...(isNarrow ? {} : { role: "tabpanel", "aria-labelledby": tabId }),
    }),
  };
}

interface SettingsPageListProps<T extends string> {
  pages: { value: T; label: string }[];
  onOpen: (tab: T, event?: React.MouseEvent) => void;
  /** Names the list for assistive technology; the dialog's title. */
  label: string;
  listRef: React.Ref<HTMLUListElement>;
}

/** The narrow screen's list of settings pages: one grouped section of rows. */
export function SettingsPageList<T extends string>({
  pages,
  onOpen,
  label,
  listRef,
}: SettingsPageListProps<T>) {
  return (
    <Card variant="surface" size="xs" data-ui="settings-page-list">
      <ul ref={listRef} aria-label={label} className="flex flex-col gap-0.5">
        {pages.map((page) => (
          <li key={page.value}>
            {/* list-row-geometry sets only the corner, so these utilities
                still size the row. */}
            <Row
              variant="list"
              onClick={(event) => onOpen(page.value, event)}
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
      </ul>
    </Card>
  );
}
