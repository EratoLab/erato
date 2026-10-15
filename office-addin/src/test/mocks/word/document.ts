import { vi } from "vitest";

import { resetWordDocumentIdentityForTests } from "../../../word/utils/wordDocumentIdentity";

import type { Mock } from "vitest";

export interface MockWordDocument {
  url: string | null;
  mode: string;
  /** Reports `url` at call time ("" while unsaved), as Word does after a save. */
  getFilePropertiesAsync: Mock<
    (
      callback: (result: Office.AsyncResult<Office.FileProperties>) => void,
    ) => void
  >;
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
  /** WordprocessingML appended inside the paragraph's w:p in Paragraph.getOoxml, e.g. a pending
   * revision; a paragraph write drops it. */
  ooxml?: string;
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
  /** Ranges built with expandTo, which Word for the web must not select (ERMAIN-932). */
  expansions: () => number;
  /** Report every paragraph ID as null, as single-purchase Office does; writes still track the
   * paragraph internally under its ID. */
  hideParagraphIds: (hidden: boolean) => void;
  /** End getText with the paragraph mark, as Word on Windows and Mac does. */
  showParagraphMarks: (shown: boolean) => void;
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
  ooxml?: string;
}

const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function paragraphPackage(paragraph: MockParagraphState | undefined): string {
  return `<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage"><pkg:part pkg:name="/word/document.xml"><pkg:xmlData><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve">${escapeXml(paragraph?.text ?? "")}</w:t></w:r>${paragraph?.ooxml ?? ""}</w:p><w:sectPr/></w:body></w:document></pkg:xmlData></pkg:part></pkg:package>`;
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
    ...(paragraph.ooxml === undefined ? {} : { ooxml: paragraph.ooxml }),
  }));
}

/** Reads and writes resolve at sync, with paragraph IDs resolved at execution time.
 * Office.onReady bypasses the CDN script that cannot load in jsdom. */
export function installMockWordDocument(
  paragraphs: MockWordParagraphSpec[] = [],
): MockWordHost {
  const office = Office as unknown as Record<string, unknown>;
  // Each install is a fresh pane load.
  resetWordDocumentIdentityForTests();

  const document: MockWordDocument = {
    url: "https://contoso.sharepoint.com/Shared%20Documents/report.docx",
    mode: "readWrite",
    getFilePropertiesAsync: vi.fn((callback) => {
      callback({
        status: Office.AsyncResultStatus.Succeeded,
        value: { url: document.url ?? "" },
      } as Office.AsyncResult<Office.FileProperties>);
    }),
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
  let idsHidden = false;
  let expansions = 0;
  let marksShown = false;
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
        expandTo: (other: { last: string }) => {
          expansions += 1;
          return rangeProxy(first, other.last);
        },
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
          get uniqueLocalId() {
            return idsHidden ? null : uniqueLocalId;
          },
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
            const captured = `${state()?.text ?? ""}${marksShown ? "\r" : ""}`;
            return deferred(() => captured);
          },
          getOoxml: () => {
            const captured = paragraphPackage(state());
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
              body.splice(
                index,
                1,
                { ...head, text: lines[0], ooxml: undefined },
                ...created,
              );
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
        // Revisions show in Paragraph.getOoxml here; the list stays empty.
        getTrackedChanges: () => ({ load: () => {}, items: [] }),
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
      expansions: () => expansions,
      hideParagraphIds: (hidden) => {
        idsHidden = hidden;
      },
      showParagraphMarks: (shown) => {
        marksShown = shown;
      },
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
