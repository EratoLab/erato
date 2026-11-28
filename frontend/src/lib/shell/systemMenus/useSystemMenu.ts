import { useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { hostShellWithCapability, shellAnchor } from "@/lib/hostShell";
import { observePopoverViewport } from "@/lib/popoverViewport";
import {
  requestSystemMenus,
  SYSTEM_MENUS_CAPABILITY,
  SYSTEM_MENUS_EVENT,
  SYSTEM_MENUS_METHOD,
  SYSTEM_MENUS_VERSION,
} from "@/lib/shell/contract/systemMenus";
import {
  CONFIRM_ACTION_ID,
  confirmParams,
  findMenuEntry,
  menuIcons,
  toShellMenuItems,
} from "@/lib/shell/menus/menuEntry";
import { playHaptic } from "@/lib/shellHaptics";

import { drawMenuIcon, drawnMenuIcon } from "./drawMenuIcon";

import type { HostShell } from "@/lib/hostShell";
import type { MenuDescription } from "@/lib/shell/menus/menuEntry";

export interface SystemMenuOptions {
  /** Names the menu to the app; unique among the page's menus. */
  id: string;
  /**
   * `attach` for a button that stays put, so the app owns its touch;
   * `show` for a tap the page received on something that moves.
   */
  mode: "show" | "attach";
  /** `null` keeps the web menu. */
  entries: MenuDescription;
  title?: string;
  /** An entry that closes the menu, after its confirmation if it has one. */
  onChoose: (itemId: string) => void;
  /** A keep-open entry the person flipped to `on`. */
  onToggle?: (itemId: string, on: boolean) => void;
}

/** What a web menu hands its trigger to, where the app draws the menu. */
export interface NativeMenu {
  /**
   * A tap or key on the trigger: true when the app's menu takes it. `web`
   * opens the page's own menu if the app then does not draw this one.
   */
  open(trigger: Element, web: () => void): boolean;
  /** The trigger of an attached menu, or null once it is gone. */
  attachTo(trigger: Element | null): void;
}

/** A first menu waits this long at most for its icons to be drawn. */
const ICON_WAIT_MS = 400;
/**
 * How long a shown menu may take to appear: the icons' wait, then the app's
 * own second before it answers that nothing opened. A tap later than that,
 * with the menu's answer still on its way back, is taken as a menu that
 * never came; the app does not say when its menu appeared.
 */
const SHOW_GRACE_MS = 1500;
/**
 * How often an attached trigger's place is checked: a transform (the phone
 * drawer pushing the page aside) moves it without any event to hear.
 */
const PLACE_CHECK_MS = 250;

const isDrawable = (entries: MenuDescription) =>
  entries !== null && entries.length > 0;

/**
 * The host app's system menu for this description, where the app offers
 * `systemMenus` and the description is not `null`; undefined otherwise, and
 * the caller draws its web menu as before.
 */
export function useSystemMenu(
  options: SystemMenuOptions,
): NativeMenu | undefined {
  const shell = hostShellWithCapability(
    SYSTEM_MENUS_CAPABILITY,
    SYSTEM_MENUS_VERSION,
  );
  const sessionRef = useRef<SystemMenuSession | null>(null);
  if (shell && !sessionRef.current) {
    sessionRef.current = new SystemMenuSession(shell, options);
  }
  const session = sessionRef.current;

  // Before the trigger's own effects, which run first, attach it.
  useLayoutEffect(() => {
    session?.setOptions(options);
  });
  useEffect(() => () => session?.dispose(), [session]);

  const usable = session !== null && isDrawable(options.entries);
  return useMemo(
    () => (usable ? session.nativeMenu : undefined),
    [usable, session],
  );
}

interface Pick {
  id: string;
  itemId: string;
}

const isPick = (value: unknown): value is Pick =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Pick).id === "string" &&
  typeof (value as Pick).itemId === "string";

const isToggle = (value: unknown): value is Pick & { on: boolean } =>
  isPick(value) && typeof (value as { on?: unknown }).on === "boolean";

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;

/** Covered by something the page drew over it, or in an inert part of it. */
function unreachable(trigger: Element): boolean {
  if (trigger.closest("[inert]")) return true;
  if (typeof document.elementFromPoint !== "function") return false;
  const rect = trigger.getBoundingClientRect();
  const hit = document.elementFromPoint(
    rect.left + rect.width / 2,
    rect.top + rect.height / 2,
  );
  // Off screen there is nothing to hit; the app hides the button there.
  return hit !== null && !trigger.contains(hit);
}

class SystemMenuSession {
  private options: SystemMenuOptions;
  /** The id of the shown menu while it is open. */
  private shownId: string | null = null;
  /** Counts shown menus; the answer to one the page gave up on is dropped. */
  private shows = 0;
  private shownAt = 0;
  private trigger: Element | null = null;
  private attachment: "none" | "pending" | "attached" = "none";
  /** Ends an attach still on its way when anything changes first. */
  private generation = 0;
  /** Entries the app answered `unsupported` for; not offered again. */
  private refusedItems = "";
  private sentItems = "";
  private sentAnchor = "";
  private stopTracking: (() => void) | null = null;
  /** Events reach a menu only while it is open or attached. */
  private stopListening: (() => void) | null = null;

  readonly nativeMenu: NativeMenu = {
    open: (trigger, web) => this.open(trigger, web),
    attachTo: (trigger) => this.attachTo(trigger),
  };

  constructor(
    private readonly shell: HostShell,
    options: SystemMenuOptions,
  ) {
    this.options = options;
  }

  setOptions(options: SystemMenuOptions) {
    this.options = options;
    for (const icon of menuIcons(options.entries ?? []))
      void drawMenuIcon(icon);
    this.reconcile();
  }

  dispose() {
    this.attachTo(null);
    this.stopListening?.();
    this.stopListening = null;
  }

  private items() {
    return toShellMenuItems(this.options.entries ?? [], drawnMenuIcon);
  }

  private async iconsDrawn() {
    const drawing = menuIcons(this.options.entries ?? []).map(drawMenuIcon);
    await Promise.race([
      Promise.all(drawing),
      new Promise((resolve) => setTimeout(resolve, ICON_WAIT_MS)),
    ]);
  }

  // MARK: events

  private listen() {
    if (this.stopListening) return;
    const offChosen = this.shell.on(SYSTEM_MENUS_EVENT.chosen, (payload) => {
      if (
        isPick(payload) &&
        this.attachment === "attached" &&
        payload.id === this.options.id
      ) {
        void this.choose(payload.itemId);
      }
    });
    const offToggled = this.shell.on(SYSTEM_MENUS_EVENT.toggled, (payload) => {
      if (!isToggle(payload)) return;
      const mine =
        (this.attachment === "attached" && payload.id === this.options.id) ||
        (this.shownId !== null && payload.id === this.shownId);
      if (!mine) return;
      playHaptic("selection");
      this.options.onToggle?.(payload.itemId, payload.on);
    });
    this.stopListening = () => {
      offChosen();
      offToggled();
    };
  }

  private stopListeningUnlessUsed() {
    if (this.attachment !== "none" || this.shownId !== null) return;
    this.stopListening?.();
    this.stopListening = null;
  }

  // MARK: shown menus

  private open(trigger: Element, web: () => void): boolean {
    if (!isDrawable(this.options.entries)) return false;
    if (this.shownId !== null) {
      // A second tap while the menu is coming changes nothing. The page is
      // not tapped while the app's menu is up, so a tap after that means it
      // never appeared: the web menu takes this one.
      if (Date.now() - this.shownAt < SHOW_GRACE_MS) return true;
      this.shows += 1;
      this.shownId = null;
      this.stopListeningUnlessUsed();
      return false;
    }
    // An attached menu's own id stays with its button; this one is the
    // shown menu a key or VoiceOver opened from the same trigger.
    const id =
      this.options.mode === "attach"
        ? // eslint-disable-next-line lingui/no-unlocalized-strings -- menu id
          `${this.options.id}:shown`
        : this.options.id;
    const show = ++this.shows;
    this.shownId = id;
    this.shownAt = Date.now();
    this.listen();
    void (async () => {
      let answer: unknown;
      try {
        await this.iconsDrawn();
        if (show !== this.shows) return;
        const items = this.items();
        this.sentItems = JSON.stringify(items);
        answer = await requestSystemMenus(
          this.shell,
          SYSTEM_MENUS_METHOD.show,
          {
            id,
            anchor: shellAnchor(trigger),
            ...(this.options.title ? { title: this.options.title } : {}),
            items,
          },
        );
      } catch {
        answer = undefined;
      }
      if (show !== this.shows) return;
      this.shownId = null;
      this.stopListeningUnlessUsed();
      if (field(answer, "shown") !== true) {
        web();
        return;
      }
      const chosen = field(answer, "chosen");
      if (typeof chosen === "string") await this.choose(chosen, trigger);
    })();
    return true;
  }

  private async choose(itemId: string, trigger = this.trigger) {
    // The page may have changed while the menu was open (an archived chat).
    const entry = findMenuEntry(this.options.entries ?? [], itemId);
    if (!entry || entry.disabled) return;
    if (entry.confirm) {
      let answer: unknown;
      try {
        answer = await requestSystemMenus(
          this.shell,
          SYSTEM_MENUS_METHOD.confirm,
          confirmParams(
            entry.confirm,
            trigger ? shellAnchor(trigger) : undefined,
          ),
        );
      } catch {
        // Not asked is not agreed: the person can pick it again.
        return;
      }
      if (field(answer, "chosen") !== CONFIRM_ACTION_ID) return;
    }
    this.options.onChoose(itemId);
  }

  // MARK: attached menus

  private attachTo(trigger: Element | null) {
    if (trigger === this.trigger) return;
    this.stopTracking?.();
    this.stopTracking = null;
    this.detach();
    this.trigger = trigger;
    if (trigger && this.options.mode === "attach") {
      this.stopTracking = this.track(trigger);
    }
    this.reconcile();
  }

  /** Attaches, updates or detaches so the app has what the page has now. */
  private reconcile() {
    const trigger = this.trigger;
    const items = isDrawable(this.options.entries) ? this.items() : null;
    const wanted =
      trigger !== null &&
      this.options.mode === "attach" &&
      items !== null &&
      JSON.stringify(items) !== this.refusedItems &&
      !unreachable(trigger);
    if (!wanted) {
      this.detach();
    } else if (this.attachment === "none") {
      this.attach(trigger);
    }
    this.sendItems();
  }

  private attach(trigger: Element) {
    const generation = ++this.generation;
    this.attachment = "pending";
    void (async () => {
      await this.iconsDrawn();
      if (generation !== this.generation) return;
      const items = this.items();
      const anchor = shellAnchor(trigger);
      let answer: unknown;
      try {
        answer = await requestSystemMenus(
          this.shell,
          SYSTEM_MENUS_METHOD.attach,
          {
            id: this.options.id,
            anchor,
            items,
          },
        );
      } catch {
        answer = undefined;
      }
      const attached = field(answer, "attached") === true;
      if (generation !== this.generation) {
        // Superseded while on its way: what the app attached must go.
        if (attached) this.requestDetach();
        return;
      }
      if (!attached) {
        this.attachment = "none";
        if (field(answer, "unsupported") !== undefined) {
          this.refusedItems = JSON.stringify(items);
        }
        this.stopListeningUnlessUsed();
        return;
      }
      this.attachment = "attached";
      this.sentItems = JSON.stringify(items);
      this.sentAnchor = JSON.stringify(anchor);
      this.listen();
      this.sendItems();
    })();
  }

  private detach() {
    // A shown menu's entries were sent too; only an attachment ends here.
    if (this.attachment === "none") return;
    this.generation += 1;
    const wasAttached = this.attachment === "attached";
    this.attachment = "none";
    this.sentItems = "";
    if (wasAttached) this.requestDetach();
    this.stopListeningUnlessUsed();
  }

  private requestDetach() {
    void requestSystemMenus(this.shell, SYSTEM_MENUS_METHOD.detach, {
      id: this.options.id,
    }).catch(() => {});
  }

  /** New entries for an open or attached menu, when they changed. */
  private sendItems() {
    const id =
      this.shownId ?? (this.attachment === "attached" ? this.options.id : null);
    if (!id || !isDrawable(this.options.entries)) return;
    const items = this.items();
    const sent = JSON.stringify(items);
    if (sent === this.sentItems) return;
    this.sentItems = sent;
    void requestSystemMenus(this.shell, SYSTEM_MENUS_METHOD.update, {
      id,
      items,
    }).catch(() => {});
  }

  /**
   * The app cannot see the page's layout, so the trigger's place is sent
   * again when it may have moved, and the attachment goes while the trigger
   * is covered or inert.
   */
  private track(trigger: Element): () => void {
    let frame = 0;
    const check = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        this.reconcile();
        if (this.attachment !== "attached") return;
        const anchor = shellAnchor(trigger);
        const sent = JSON.stringify(anchor);
        if (sent === this.sentAnchor) return;
        this.sentAnchor = sent;
        void requestSystemMenus(this.shell, SYSTEM_MENUS_METHOD.update, {
          id: this.options.id,
          anchor,
        }).catch(() => {});
      });
    };
    const resize = new ResizeObserver(check);
    resize.observe(trigger);
    resize.observe(document.documentElement);
    const stopViewport = observePopoverViewport(check);
    document.addEventListener("transitionend", check, true);
    const interval = window.setInterval(check, PLACE_CHECK_MS);
    // A page restored from the back-forward cache lost its attachment.
    const restored = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      this.detach();
      this.reconcile();
    };
    window.addEventListener("pageshow", restored);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(interval);
      resize.disconnect();
      stopViewport();
      document.removeEventListener("transitionend", check, true);
      window.removeEventListener("pageshow", restored);
    };
  }
}
