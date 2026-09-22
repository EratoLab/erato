import { vi } from "vitest";

import type { Mock } from "vitest";

/** The subset of `Office.context.document` the Word composition reads. */
export interface MockWordDocument {
  /** Null models an unsaved document, where Office.js exposes no URL. */
  url: string | null;
  mode: string;
  /**
   * Spied, and deliberately so: this store persists into the .docx, and the
   * read gate must never touch it. Tests assert zero calls.
   */
  settings: {
    get: Mock<(name: string) => unknown>;
    set: Mock<(name: string, value: unknown) => void>;
    saveAsync: Mock<(callback?: (result: unknown) => void) => void>;
  };
}

/** What `Office.onReady()` resolves to. */
export interface MockWordReadyInfo {
  host: string;
  platform: string;
}

/** One paragraph in the mock document's main story. */
export interface MockWordParagraphSpec {
  text: string;
  uniqueLocalId?: string;
  styleBuiltIn?: string;
  /** Word reports 10 for body text; 1..9 are the heading outline levels. */
  outlineLevel?: number;
}

/** One mutation the document actually received, in execution order. */
export interface MockWordWrite {
  kind: "insertText" | "delete" | "insertOoxml" | "style";
  /** `uniqueLocalId` for a paragraph write; `"body"` / `"selection"` else. */
  target: string;
  /** Ordinal (1-based) the target held when the write executed. */
  ordinal: number;
  value?: string;
  /** `insertText` location, verbatim. */
  location?: string;
}

export interface MockWordRun {
  /** `Word.run` itself, so a test can make it reject. */
  run: Mock<
    (callback: (context: unknown) => Promise<unknown>) => Promise<unknown>
  >;
  /** How many `context.sync()` calls the last run issued. */
  syncCount: () => number;
  /** Replace the document body between renders. */
  setParagraphs: (paragraphs: MockWordParagraphSpec[]) => void;
  /** The body as it stands now — what a write test asserts against. */
  paragraphs: () => { text: string; uniqueLocalId: string }[];
  /** Every mutation, in execution order. Cleared by `setParagraphs`. */
  writes: () => MockWordWrite[];
  /** Text of the current selection; `""` is a collapsed insertion point. */
  setSelection: (text: string) => void;
  /**
   * Make the write to this paragraph throw when the queue reaches it — a
   * paragraph inside a locked content control, or a final paragraph mark that
   * cannot be deleted. Commands queued BEFORE it still execute, which is the
   * whole point: an Office.js batch is not a transaction.
   */
  failWriteOn: (uniqueLocalId: string | null) => void;
  setTrackingMode: (mode: "Off" | "TrackAll" | "TrackMineOnly") => void;
  selections: () => string[][];
}

export interface MockWordHost {
  document: MockWordDocument;
  /** Requirement-set probe; drive it to model a host below the floor. */
  isSetSupported: Mock<(name: string, minVersion?: string) => boolean>;
  /**
   * Resolves `Office.onReady()`; drive it to model a different surface. Typed
   * precisely rather than as a bare `Mock`, so a `mockImplementation` in a test
   * is checked against the promise-returning shape `OfficeProvider` awaits.
   */
  onReady: Mock<
    (callback?: (info: MockWordReadyInfo) => void) => Promise<MockWordReadyInfo>
  >;
  /** `globalThis.Word`, the document read and write surface. */
  word: MockWordRun;
}

/** What `Office.onReady()` resolves to on Word for the web. */
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

/**
 * Installs Word-specific stubs over the shared `setupOffice.ts` global:
 * `Office.context.document`, an `Office.context.requirements.isSetSupported`
 * probe answering for `WordApi` and `NestedAppAuth`, `Office.onReady`, and a
 * `globalThis.Word` whose `run` walks — and mutates — a paragraph collection.
 *
 * `Office.onReady` is the load-bearing part. `loadOfficeJs()` short-circuits
 * when it is already a function and otherwise appends a CDN script whose
 * `onload` never fires under jsdom — which would park `OfficeProvider` on its
 * loading branch forever and leave the chat surface unrendered. Installing it
 * therefore also means NO CDN script is appended, which is what the Word route
 * test pins.
 *
 * The paragraph stubs model Office.js's two-phase contract faithfully:
 * `items` is empty until the collection's `load` has been synced, a
 * `getText()` result throws on `.value` until the sync that resolves it, and
 * every WRITE is queued and executed in queue order at the next `sync()` — so
 * a batch whose commands are queued in the wrong order fails here exactly as
 * it would in Word.
 *
 * `getParagraphByUniqueLocalId` resolves its id at EXECUTION time, which is
 * what the real API does: the id is stable for the session, so a proxy taken
 * before a sibling edit still lands on the right paragraph afterwards.
 *
 * Returns the stub so tests can drive the probe, the ready info and the body.
 */
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

  // Answers "supported" for every set by default: the activation floor means a
  // host that reaches the pane at all already clears WordApi 1.7.
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
      /** Queued commands, executed in order at the next sync. */
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

      /** A paragraph proxy addressed by its session-stable id. */
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
            // Recorded, never honoured: D-31 says the executor introduces no
            // style of its own, and a test asserts this log stays empty.
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
              // A newline creates further paragraphs; the head keeps its id
              // and its style, the new ones inherit the style and get fresh
              // ids, exactly as Word reports them.
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
        // A JSON snapshot stands in for OOXML: the executor treats it as an
        // opaque string, and a revert test wants exact restoration.
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
            // Word executes the batch command by command and STOPS at the
            // first rejection; everything queued before it stays applied.
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

/**
 * Removes the Word stubs to restore a clean shared state. Call in `afterEach`.
 */
export function uninstallMockWordDocument() {
  const office = Office as unknown as Record<string, unknown>;
  const context = Office.context as unknown as Record<string, unknown>;
  delete context.document;
  delete context.requirements;
  delete office.onReady;
  delete (globalThis as Record<string, unknown>).Word;
}
