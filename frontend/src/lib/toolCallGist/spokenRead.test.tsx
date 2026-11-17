import { i18n } from "@lingui/core";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OwnCallApprovalItem } from "@/components/ui/Message/OwnCallApprovalItem";
import { ToolUseStep } from "@/components/ui/Trace/steps/ToolUseStep";
import { messages as deMessages } from "@/locales/de/messages.json";

import data from "./fixtures/spokenCards/calls.json";
import { toolCallCardOf } from "./gist";
import { spokenApprovalFor, spokenApprovalPieces } from "./spokenCard";
import { spokenReadFactsOf } from "./spokenRead";

import type {
  ToolCallLabel,
  ToolDisplayMetadata,
  ToolUse,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";

vi.mock("@/hooks/ui/useThemedIcon", () => ({
  useThemedIcon: () => "icon-id",
}));

interface SetCall {
  id: string;
  tool_name: string;
  input: unknown;
  display: ToolDisplayMetadata;
}

const { calls } = data as unknown as { calls: SetCall[] };
const NOW = new Date("2026-11-17T09:00:00Z");
i18n.load({ de: deMessages as unknown as Messages });

const callOf = (id: string): SetCall => {
  const call = calls.find((entry) => entry.id === id);
  if (!call) throw new Error(`no call ${id}`);
  return call;
};

const sayLabel = (
  label: ToolCallLabel,
  input: unknown,
  language = "de",
  server = "CRM",
): string => {
  const previous = i18n.locale;
  i18n.activate(language);
  try {
    return spokenApprovalPieces(
      { type: "call", label, input, toolTitle: "read_query", server },
      { language, now: NOW, timeZone: "Europe/Berlin" },
    )
      .map((piece) => piece.text)
      .join(" ");
  } finally {
    i18n.activate(previous);
  }
};

const say = (id: string, language = "de"): string => {
  const call = callOf(id);
  const previous = i18n.locale;
  i18n.activate(language);
  try {
    return spokenApprovalPieces(spokenApprovalFor("mcp_tool", call), {
      language,
      now: NOW,
      timeZone: "Europe/Berlin",
    })
      .map((piece) => piece.text)
      .join(" ");
  } finally {
    i18n.activate(previous);
  }
};

const REQUEST_DE = "Bitte auf dem Bildschirm bestätigen.";
const REQUEST_EN = "Please confirm on screen.";

describe("the spoken sentence for reads, across read shapes", () => {
  it.each([
    [
      "a search",
      "read-01-search",
      "Ich möchte in Dynamics 365 nach Müller GmbH suchen.",
      "I'd like to search in Dynamics 365 for Müller GmbH.",
    ],
    [
      "one filter and a table",
      "read-02-query",
      "Ich möchte in Dynamics 365 aus der Tabelle opportunity Datensätze lesen, mit diesen Bedingungen: statecode ist 0.",
      "I'd like to read records from the table opportunity in Dynamics 365, with these conditions: statecode is 0.",
    ],
    [
      "several filters: three said, the rest counted",
      "read-03-sql-several-filters",
      "Ich möchte in Dynamics 365 Aufgaben auflisten, mit diesen Bedingungen: statecode ist 0. prioritycode ist 2. scheduledend liegt vor dem 31. Januar 2030. Dazu kommt eine weitere Bedingung, sie steht auf dem Bildschirm.",
      "I'd like to list tasks in Dynamics 365, with these conditions: statecode is 0. prioritycode is 2. scheduledend is before 31 January 2030. And one more condition, shown on screen.",
    ],
    [
      "a lookup by the record's key, named as an earlier result called it",
      "read-04-sql-record-by-id",
      "Ich möchte in Dynamics 365 aus der Tabelle opportunity den Datensatz Line 4 Retrofit lesen.",
      "I'd like to read the record Line 4 Retrofit from the table opportunity in Dynamics 365.",
    ],
    [
      "no filter, with a limit",
      "read-05-sql-no-filter",
      "Ich möchte in Dynamics 365 aus der Tabelle account Datensätze lesen. Höchstens 50 Datensätze.",
      "I'd like to read records from the table account in Dynamics 365. At most 50 records.",
    ],
    [
      "a long value named, many values counted",
      "read-06-sql-long-values",
      "Ich möchte in Dynamics 365 Aufgaben auflisten, mit diesen Bedingungen: description wird mit einem Text von etwa 20 Wörtern verglichen, er steht auf dem Bildschirm. prioritycode ist 0, 1, 2 oder drei weitere.",
      "I'd like to list tasks in Dynamics 365, with these conditions: description is compared with a text of about 20 words, shown on screen. prioritycode is 0, 1, 2 or three more.",
    ],
    [
      "a generic lookup by ID",
      "read-07-retrieve-record",
      "Ich möchte in Dynamics 365 den Datensatz Line 4 Retrofit lesen. Wo: opportunity.",
      "I'd like to read the record Line 4 Retrofit in Dynamics 365. Where: opportunity.",
    ],
    [
      "a join",
      "read-08-sql-join",
      "Ich möchte in Dynamics 365 aus den Tabellen opportunity und account Datensätze lesen, mit diesen Bedingungen: name ist Beispiel Industrie GmbH.",
      "I'd like to read records from the tables opportunity and account in Dynamics 365, with these conditions: name is Beispiel Industrie GmbH.",
    ],
    [
      "a record nobody read",
      "read-09-sql-record-nobody-read",
      "Ich möchte in Dynamics 365 aus der Tabelle opportunity einen Datensatz lesen, den ich in diesem Chat nicht gelesen habe.",
      "I'd like to read a record from the table opportunity in Dynamics 365 that I haven't read in this chat.",
    ],
    [
      "a list that only says it is filtered",
      "read-10-list-filtered",
      "Ich möchte in CRM Aufgaben auflisten. Mit Bedingungen, die auf dem Bildschirm stehen.",
      "I'd like to list tasks in CRM. With conditions shown on screen.",
    ],
    [
      "a related record in a condition, by its name",
      "read-11-sql-related-record",
      "Ich möchte in Dynamics 365 Aufgaben auflisten, mit diesen Bedingungen: regardingobjectid ist Line 4 Retrofit. statecode ist 0.",
      "I'd like to list tasks in Dynamics 365, with these conditions: regardingobjectid is Line 4 Retrofit. statecode is 0.",
    ],
    [
      "not a plain read: the generic sentence",
      "read-12-sql-select-into",
      "Ich möchte in Dynamics 365 das Tool read query verwenden.",
      "I'd like to use the tool read query in Dynamics 365.",
    ],
    [
      "a long search text named",
      "read-13-search-long-text",
      "Ich möchte in Notion nach einem Text von etwa 20 Wörtern suchen, er steht auf dem Bildschirm.",
      "I'd like to search in Notion for a text of about 20 words, shown on screen.",
    ],
    [
      "the operator's field names and coded values",
      "read-14-sql-glossary",
      "Ich möchte in Dynamics 365 aus der Tabelle opportunity Datensätze lesen, mit diesen Bedingungen: Risk level ist High. Estimated close date liegt spätestens am 31. Dezember.",
      "I'd like to read records from the table opportunity in Dynamics 365, with these conditions: Risk level is High. Estimated close date is on or before 31 December.",
    ],
  ])("%s", (_, id, german, english) => {
    expect(say(id)).toBe(`${german} ${REQUEST_DE}`);
    expect(say(id, "en")).toBe(`${english} ${REQUEST_EN}`);
  });

  it("never says a machine ID, a path holding one, or a whole web address", () => {
    const id = "5f0c2a10-0000-4000-8000-00000000a009";
    const label: ToolCallLabel = {
      action: "other",
      object_kind: "row",
      source: "generic",
      read: {
        object_kind: "row",
        filtered: true,
        item: {
          target: {
            pointer: "/url",
            values: [
              { path: "/url", text: "https://crm.example.com/api?token=abc" },
            ],
          },
        },
        query: {
          tables: ["opportunity"],
          conditions: [
            {
              column: "parentaccountid",
              operator: "equals",
              values: [{ path: "/q", text: id, machine_id: true }],
            },
            {
              column: "link",
              operator: "equals",
              values: [{ path: "/q", text: `tables/account/records/${id}` }],
            },
          ],
        },
      },
    };
    const said = sayLabel(label, {});
    expect(said).not.toContain(id);
    expect(said).not.toContain("token");
    expect(said).toContain("Wo: crm.example.com.");
    expect(said).toContain(
      "parentaccountid ist ein Datensatz, den ich in diesem Chat nicht gelesen habe.",
    );
    expect(said).toContain(
      "link ist ein Eintrag, dessen Kennung auf dem Bildschirm steht.",
    );
  });

  it("counts a condition with an operator it does not know", () => {
    const label = {
      action: "other",
      object_kind: "row",
      source: "generic",
      read: {
        object_kind: "row",
        query: {
          tables: ["account"],
          conditions: [
            {
              column: "name",
              operator: "sounds_like",
              values: [{ path: "/q", text: "Meier" }],
            },
          ],
        },
      },
    } as unknown as ToolCallLabel;
    expect(sayLabel(label, {}, "en")).toBe(
      `I'd like to read records from the table account in CRM. With one condition, shown on screen. ${REQUEST_EN}`,
    );
  });

  it("ignores a read description beside a verb the card says", () => {
    const label: ToolCallLabel = {
      action: "delete",
      object_kind: "row",
      source: "rules",
      read: { object_kind: "row", query: { tables: ["account"] } },
    };
    expect(spokenReadFactsOf(label)).toBeUndefined();
  });

  it("says a read inside a queue with its ordinal", () => {
    const call = callOf("read-04-sql-record-by-id");
    i18n.activate("de");
    const [what] = spokenApprovalPieces(spokenApprovalFor("mcp_tool", call), {
      language: "de",
      now: NOW,
      position: { index: 1, total: 2, sameAsPrevious: false },
    });
    expect(what.text).toBe(
      "Die zweite: Ich möchte in Dynamics 365 aus der Tabelle opportunity den Datensatz Line 4 Retrofit lesen.",
    );
  });
});

/** The display as an older backend stored it: the same, with no read description. */
const withoutRead = (display: ToolDisplayMetadata): ToolDisplayMetadata => {
  if (!display.label) return display;
  const { read: _read, ...label } = display.label;
  return { ...display, label };
};

/** React's generated ids differ between renders. */
const html = (node: HTMLElement): string =>
  node.innerHTML.replace(/(id|for|aria-[a-z]+)="[^"]*"/g, '$1=""');

const readCalls = calls.filter((call) => call.display.label?.read);

describe("the read description is for the voice only", () => {
  it("covers reads of every shape in the set", () => {
    expect(readCalls.map((call) => call.id)).toEqual(
      expect.arrayContaining([
        "read-01-search",
        "read-02-query",
        "read-04-sql-record-by-id",
        "read-07-retrieve-record",
        "read-10-list-filtered",
      ]),
    );
  });

  it("leaves the card the screen draws unchanged", () => {
    // A generic card passes its label on whole; only that copy may differ.
    const drawn = (label: ToolCallLabel | undefined, input: unknown) =>
      JSON.parse(
        JSON.stringify(toolCallCardOf(label, input), (key, value: unknown) =>
          key === "read" ? undefined : value,
        ),
      ) as unknown;
    for (const call of readCalls) {
      expect(drawn(call.display.label, call.input), call.id).toEqual(
        drawn(withoutRead(call.display).label, call.input),
      );
    }
  });

  it("renders the approval card and the trace row the same with and without it", () => {
    for (const call of readCalls) {
      const card = (display: ToolDisplayMetadata) =>
        html(
          render(
            <OwnCallApprovalItem
              toolName={call.tool_name}
              display={display}
              input={call.input}
              serverId="dynamics"
              isClientTool={false}
              openWorld={false}
              allowAlways
              status="pending"
              resolvedLabel={undefined}
              isBusy={false}
              scrollIntoViewOnMount={false}
              onDecide={vi.fn()}
            />,
          ).container,
        );
      const shown = card(call.display);
      expect(shown, call.id).toContain(call.tool_name.split("_")[0]);
      expect(shown, call.id).toBe(card(withoutRead(call.display)));

      const row = (display: ToolDisplayMetadata) =>
        html(
          render(
            <ToolUseStep
              part={
                {
                  content_type: "tool_use",
                  tool_call_id: call.id,
                  tool_name: call.tool_name,
                  status: "success",
                  input: call.input,
                  output: "[]",
                  display,
                } as unknown as ToolUse & { content_type: "tool_use" }
              }
              status="done"
              isStreaming={false}
              isCollapsed={false}
              isLastStep
            />,
          ).container,
        );
      const traced = row(call.display);
      expect(traced.length, call.id).toBeGreaterThan(200);
      expect(traced, call.id).toBe(row(withoutRead(call.display)));
    }
  });
});
