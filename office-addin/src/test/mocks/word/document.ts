import { vi } from "vitest";

import type { Mock } from "vitest";

export interface MockWordDocument {
  url: string | null;
  mode: string;
  /** This store persists into the DOCX; spies verify that reading never touches it. */
  settings: {
    get: Mock<(name: string) => unknown>;
    set: Mock<(name: string, value: unknown) => void>;
    saveAsync: Mock<(callback?: (result: unknown) => void) => void>;
  };
}

export interface MockWordReadyInfo {
  host: string;
  platform: string;
}

export interface MockWordParagraphSpec {
  text: string;
  uniqueLocalId?: string;
  styleBuiltIn?: string;
  outlineLevel?: number;
}

export interface MockWordWrite {
  kind: "insertText" | "delete" | "insertOoxml" | "style";
  target: string;
  ordinal: number;
  value?: string;
  location?: string;
}

export interface MockWordRun {
  run: Mock<
    (callback: (context: unknown) => Promise<unknown>) => Promise<unknown>
  >;
  syncCount: () => number;
  setParagraphs: (paragraphs: MockWordParagraphSpec[]) => void;
  paragraphs: () => { text: string; uniqueLocalId: string }[];
  writes: () => MockWordWrite[];
  setSelection: (text: string) => void;
  /** Commands before a rejection still execute: an Office.js batch is not a transaction. */
  failWriteOn: (uniqueLocalId: string | null) => void;
  setTrackingMode: (mode: "Off" | "TrackAll" | "TrackMineOnly") => void;
  selections: () => string[][];
}

export interface MockWordHost {
  document: MockWordDocument;
  isSetSupported: Mock<(name: string, minVersion?: string) => boolean>;
  onReady: Mock<
    (callback?: (info: MockWordReadyInfo) => void) => Promise<MockWordReadyInfo>
  >;
  word: MockWordRun;
}

export const MOCK_WORD_READY_INFO: MockWordReadyInfo = {
  host: "Word",
  platform: "OfficeOnline",
};

interface MockParagraphState {
  text: string;
  uniqueLocalId: string;
  styleBuiltIn: string;
  outlineLevel: number;
}

let nextGeneratedId = 0;

function toState(
  paragraphs: MockWordParagraphSpec[],
  offset = 0,
): MockParagraphState[] {
  return paragraphs.map((paragraph, index) => ({
    text: paragraph.text,
    uniqueLocalId: paragraph.uniqueLocalId ?? `id-${offset + index + 1}`,
    styleBuiltIn: paragraph.styleBuiltIn ?? "Normal",
    outlineLevel: paragraph.outlineLevel ?? 10,
  }));
}

/** Reads and writes resolve at sync, with paragraph IDs resolved at execution time.
 * Office.onReady bypasses the CDN script that cannot load in jsdom. */
export function installMockWordDocument(
  paragraphs: MockWordParagraphSpec[] = [],
): MockWordHost {
  const office = Office as unknown as Record<string, unknown>;

  const document: MockWordDocument = {
    url: "https://contoso.sharepoint.com/Shared%20Documents/report.docx",
    mode: "readWrite",
    settings: {
      get: vi.fn(() => undefined),
      set: vi.fn(),
      saveAsync: vi.fn(),
    },
  };

  const isSetSupported = vi.fn((_name: string, _minVersion?: string) => true);

  const onReady = vi.fn(
    (
      callback?: (info: MockWordReadyInfo) => void,
    ): Promise<MockWordReadyInfo> => {
      callback?.(MOCK_WORD_READY_INFO);
      return Promise.resolve(MOCK_WORD_READY_INFO);
    },
  );

  let body = toState(paragraphs);
  let selectionText = "";
  let failWriteId: string | null = null;
  let syncCount = 0;
  let writes: MockWordWrite[] = [];
  let trackingMode = "Off";
  const selections: string[][] = [];

  const run = vi.fn(
    async (callback: (context: unknown) => Promise<unknown>) => {
      syncCount = 0;
      let loaded = false;
      const pending: { resolve: () => void }[] = [];
      let queue: (() => void)[] = [];

      const deferred = <T>(read: () => T) => {
        let resolved = false;
        pending.push({
          resolve: () => {
            resolved = true;
          },
        });
        return {
          get value(): T {
            if (!resolved) {
              throw new Error(
                "a ClientResult was read before context.sync() resolved it",
              );
            }
            return read();
          },
        };
      };

      const ordinalOf = (id: string) =>
        body.findIndex((entry) => entry.uniqueLocalId === id) + 1;

      const rejectIfUnwritable = (id: string) => {
        if (failWriteId === id) {
          throw new Error(`GeneralException: ${id} cannot be edited`);
        }
      };

      const rangeProxy = (first: string, last = first) => ({
        first,
        last,
        expandTo: (other: { last: string }) => rangeProxy(first, other.last),
        select: () =>
          queue.push(() => {
            const start = body.findIndex((p) => p.uniqueLocalId === first);
            const end = body.findIndex((p) => p.uniqueLocalId === last);
            if (start < 0 || end < start) throw new Error("ItemNotFound");
            selections.push(
              body.slice(start, end + 1).map((p) => p.uniqueLocalId),
            );
            selectionText = body
              .slice(start, end + 1)
              .map((p) => p.text)
              .join("\n");
          }),
      });

      const paragraphProxy = (uniqueLocalId: string) => {
        const state = () =>
          body.find((entry) => entry.uniqueLocalId === uniqueLocalId);
        return {
          uniqueLocalId,
          getRange: () => rangeProxy(uniqueLocalId),
          get styleBuiltIn() {
            return state()?.styleBuiltIn ?? "Normal";
          },
          set styleBuiltIn(value: string) {
            writes.push({
              kind: "style",
              target: uniqueLocalId,
              ordinal: ordinalOf(uniqueLocalId),
              value,
            });
          },
          get outlineLevel() {
            return state()?.outlineLevel ?? 10;
          },
          getText: () => {
            const captured = state()?.text ?? "";
            return deferred(() => captured);
          },
          insertText: (text: string, location: string) => {
            queue.push(() => {
              rejectIfUnwritable(uniqueLocalId);
              const index = body.findIndex(
                (entry) => entry.uniqueLocalId === uniqueLocalId,
              );
              if (index < 0) return;
              writes.push({
                kind: "insertText",
                target: uniqueLocalId,
                ordinal: index + 1,
                value: text,
                location,
              });
              const lines = text.split("\n");
              const head = body[index];
              const created = lines.slice(1).map((line) => {
                nextGeneratedId += 1;
                return {
                  text: line,
                  uniqueLocalId: `new-${nextGeneratedId}`,
                  styleBuiltIn: head.styleBuiltIn,
                  outlineLevel: head.outlineLevel,
                };
              });
              body.splice(index, 1, { ...head, text: lines[0] }, ...created);
            });
          },
          delete: () => {
            queue.push(() => {
              rejectIfUnwritable(uniqueLocalId);
              const index = body.findIndex(
                (entry) => entry.uniqueLocalId === uniqueLocalId,
              );
              if (index < 0) return;
              writes.push({
                kind: "delete",
                target: uniqueLocalId,
                ordinal: index + 1,
              });
              body.splice(index, 1);
            });
          },
        };
      };

      const collection = {
        load: () => {
          loaded = true;
        },
        get items() {
          if (!loaded) return [];
          return body.map((entry) => paragraphProxy(entry.uniqueLocalId));
        },
      };

      const selection = {
        load: (_properties: string) => {},
        get text() {
          return selectionText;
        },
        insertText: (text: string, location: string) => {
          queue.push(() => {
            writes.push({
              kind: "insertText",
              target: "selection",
              ordinal: 0,
              value: text,
              location,
            });
          });
        },
      };

      const bodyProxy = {
        paragraphs: collection,
        // JSON stands in for opaque OOXML so tests can verify exact restoration.
        getOoxml: () => {
          const snapshot = JSON.stringify(body);
          return deferred(() => snapshot);
        },
        insertOoxml: (ooxml: string, location: string) => {
          queue.push(() => {
            writes.push({
              kind: "insertOoxml",
              target: "body",
              ordinal: 0,
              value: ooxml,
              location,
            });
            body = JSON.parse(ooxml) as MockParagraphState[];
          });
        },
      };

      const context = {
        document: {
          load: () => {},
          get changeTrackingMode() {
            return trackingMode;
          },
          body: bodyProxy,
          getSelection: () => selection,
          getParagraphByUniqueLocalId: (id: string) => paragraphProxy(id),
        },
        sync: () => {
          syncCount += 1;
          const queued = queue;
          queue = [];
          try {
            // Office.js stops at the first rejection without rolling back earlier commands.
            for (const command of queued) command();
          } catch (error) {
            return Promise.reject(
              error instanceof Error ? error : new Error(String(error)),
            );
          }
          for (const entry of pending) entry.resolve();
          return Promise.resolve();
        },
      };
      return await callback(context);
    },
  );

  const context = Office.context as unknown as Record<string, unknown>;
  context.document = document;
  context.requirements = { isSetSupported };
  office.onReady = onReady;
  (globalThis as Record<string, unknown>).Word = { run };

  return {
    document,
    isSetSupported,
    onReady,
    word: {
      run,
      syncCount: () => syncCount,
      setParagraphs: (next) => {
        body = toState(next);
        writes = [];
      },
      paragraphs: () =>
        body.map((entry) => ({
          text: entry.text,
          uniqueLocalId: entry.uniqueLocalId,
        })),
      writes: () => [...writes],
      setSelection: (text) => {
        selectionText = text;
      },
      failWriteOn: (uniqueLocalId) => {
        failWriteId = uniqueLocalId;
      },
      setTrackingMode: (mode) => {
        trackingMode = mode;
      },
      selections: () => selections.map((ids) => [...ids]),
    },
  };
}

export function uninstallMockWordDocument() {
  const office = Office as unknown as Record<string, unknown>;
  const context = Office.context as unknown as Record<string, unknown>;
  delete context.document;
  delete context.requirements;
  delete office.onReady;
  delete (globalThis as Record<string, unknown>).Word;
}
