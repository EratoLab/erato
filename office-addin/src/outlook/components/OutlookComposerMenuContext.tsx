import { createContext, useContext } from "react";

export interface OutlookComposerMenuState {
  /**
   * The open thread's row: its chip is the way to change it ("in-composer"),
   * it went with an earlier message and can be added again ("add-again"),
   * the email is staged as a drop ("dropped"), or there is none.
   */
  thread: {
    row: "in-composer" | "add-again" | "dropped" | "none";
    fileName: string;
    size: number | null;
    addAgain: () => void;
  };
  /**
   * The item's own attachments: their bytes ride in a chip, their own or the
   * thread's on a send that carries the thread ("in-composer"), or nothing
   * carries them, so a row uploads one as a file of its own ("upload").
   */
  attachments: "in-composer" | "upload";
  /** Says what an add did where no chip appears to say it. */
  announce: (text: string) => void;
}

/**
 * Handed from the Outlook composer to the "+" menu content it registers,
 * which the shared composer renders inside its own tree.
 */
export const OutlookComposerMenuContext =
  createContext<OutlookComposerMenuState | null>(null);

export function useOutlookComposerMenu(): OutlookComposerMenuState | null {
  return useContext(OutlookComposerMenuContext);
}
