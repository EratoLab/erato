import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installWordSelectionHost,
  SV2_MAIN_DOCUMENT,
  uninstallWordSelectionHost,
} from "../selectionHost";

import type {
  MockSelectionDocument,
  MockSelectionTarget,
  WordRequirementFlavour,
  WordSelectionHostFlavour,
} from "../selectionHost";

const HOSTS = ["mac", "pc", "web"] as const;

async function tagged(
  context: Word.RequestContext,
  tag: string,
): Promise<Word.Paragraph> {
  const paragraphs = context.document.body.paragraphs;
  paragraphs.load("items/text");
  await context.sync();
  const found = paragraphs.items.find((p) => p.text.startsWith(`${tag} `));
  if (!found) throw new Error(`no paragraph ${tag}`);
  return found;
}

async function firstHit(
  context: Word.RequestContext,
  tag: string,
  text: string,
): Promise<Word.Range> {
  const hits = (await tagged(context, tag)).search(text, { matchCase: true });
  hits.load("items/text");
  await context.sync();
  return hits.items[0];
}

async function selectionText(): Promise<string> {
  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    selection.load("text");
    await context.sync();
    return selection.text;
  });
}

async function errorCode(
  batch: (context: Word.RequestContext) => Promise<unknown>,
): Promise<string> {
  try {
    await Word.run(batch);
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
  uninstallWordSelectionHost();
});

describe.each(HOSTS)("selection host on %s", (flavour) => {
  const desktop = flavour !== "web";
  const install = (document: MockSelectionDocument = SV2_MAIN_DOCUMENT) =>
    installWordSelectionHost(document, { host: flavour });

  it("SV2:119-123 separates paragraphs and cells per host in Range.text", async () => {
    const host = install();
    host.select({ table: 0, tableWhole: true });
    expect(host.selectionText()).toBe(
      {
        mac: "CA1 Cell A1 text\tCB1 Cell B1 text\r\nCA2 Cell A2 text\tCB2 Cell B2 text\r\nR",
        pc: "CA1 Cell A1 text\tCB1 Cell B1 text\r\nCA2 Cell A2 text\tCB2 Cell B2 text\r\n",
        web: "CA1 Cell A1 text\rCB1 Cell B1 text\rCA2 Cell A2 text\rCB2 Cell B2 text\r",
      }[flavour],
    );
    host.select({ table: 0, cell: [0, 0], to: { table: 0, cell: [0, 1] } });
    expect(host.selectionText()).toBe(
      desktop
        ? "CA1 Cell A1 text\tCB1 Cell B1 text\t"
        : "CA1 Cell A1 text\rCB1 Cell B1 text\r",
    );
    host.select({ table: 0, cell: [1, 1], part: "Whole" });
    expect(await selectionText()).toBe(
      desktop ? "CB2 Cell B2 text\t" : "CB2 Cell B2 text\r",
    );
    const contentText = await Word.run(async (context) => {
      const range = (await tagged(context, "MP1"))
        .getRange("Content")
        .expandTo((await tagged(context, "MP3")).getRange("Content"));
      range.load("text");
      await context.sync();
      return range.text;
    });
    expect(contentText).toBe(
      "MP1 Multi paragraph uniform victor whiskey.\rMP2 Multi paragraph uniform xray yankee.\rMP3 Multi paragraph uniform zulu omega.",
    );
  });

  it("SV2:127 selects the paragraph mark too when the web selects whole paragraph content", async () => {
    install();
    await Word.run(async (context) => {
      (await tagged(context, "PL1")).getRange("Content").select();
      await context.sync();
    });
    expect(await selectionText()).toBe(
      `PL1 Plain paragraph kilo lima mike november oscar papa.${desktop ? "" : "\r"}`,
    );
    await Word.run(async (context) => {
      const hit = await firstHit(context, "PL1", "lima mike");
      hit.select();
      await context.sync();
    });
    expect(await selectionText()).toBe("lima mike");
  });

  it("SV2:55 carries the comment mark in a web hit and finds no footnote paragraph by ID on the web", async () => {
    const host = install();
    const hit = await Word.run(
      async (context) => (await firstHit(context, "CM1", "anchor phrase")).text,
    );
    expect(hit).toBe(desktop ? "anchor phrase" : "anchor phrase\u0005");
    const footnoteId = host.paragraphs("footnote")[0].id;
    expect(
      await errorCode(async (context) => {
        const paragraph =
          context.document.getParagraphByUniqueLocalId(footnoteId);
        paragraph.load("text");
        await context.sync();
      }),
    ).toBe(desktop ? "ok" : "ItemNotFound");
  });

  it("SV2:140-143 shows hidden, deleted, comment and footnote marks per host", async () => {
    install();
    const pascalHidden = {
      IncludeHiddenText: true,
      includeTextMarkedAsDeleted: false,
    };
    const read = (tag: string) =>
      Word.run(async (context) => {
        const paragraph = await tagged(context, tag);
        const texts = [
          paragraph.getText(),
          paragraph.getText(pascalHidden),
          paragraph.getText({ includeHiddenText: true }),
          paragraph.getText({ includeTextMarkedAsDeleted: true }),
          paragraph.getText({
            includeHiddenText: false,
            includeTextMarkedAsDeleted: false,
          }),
        ];
        paragraph.load("text");
        await context.sync();
        return [paragraph.text, ...texts.map((t) => t.value)];
      });
    const mark = desktop ? "\r" : "";
    const HT1 = "HT1 Hidden before hidden after words.";
    const HT1_ALL = "HT1 Hidden before SECRET hidden after words.";
    expect(await read("HT1")).toEqual([
      desktop ? HT1 : HT1_ALL,
      (desktop ? HT1 : HT1_ALL) + mark,
      HT1_ALL + mark,
      HT1_ALL + mark,
      (desktop ? HT1 : HT1_ALL) + mark,
      (desktop ? HT1 : HT1_ALL) + mark,
    ]);
    const TC1 = "TC1 Tracked inserted words kept end words.";
    const TC1_ALL = "TC1 Tracked inserted words kept deleted words end words.";
    expect(await read("TC1")).toEqual([
      flavour === "mac" ? TC1 : TC1_ALL,
      TC1 + mark,
      TC1 + mark,
      TC1 + mark,
      TC1_ALL + mark,
      TC1 + mark,
    ]);
    const CM1 = "CM1 Commented anchor phrase after comment.";
    expect((await read("CM1"))[0]).toBe(
      desktop ? CM1 : "CM1 Commented anchor phrase\u0005 after comment.",
    );
    expect((await read("CM1"))[1]).toBe(CM1 + mark);
    expect(await read("FN1")).toEqual([
      "FN1 Footnote host sentence\u0002 continues here.",
      ...Array<string>(5).fill(
        `FN1 Footnote host sentence continues here.${mark}`,
      ),
    ]);
  });

  it("reviews a range without tracked deletions, or without insertions for the original", async () => {
    const host = install();
    const review = async (target: MockSelectionTarget) => {
      host.select(target);
      return Word.run(async (context) => {
        const selection = context.document.getSelection();
        const current = selection.getReviewedText("Current");
        const original = selection.getReviewedText("Original");
        await context.sync();
        return [current.value, original.value];
      });
    };
    expect(
      await review({
        p: "TC1",
        text: "inserted",
        to: { p: "TC1", text: "end" },
      }),
    ).toEqual(["inserted words kept end", "kept deleted words end"]);
    const field = desktop
      ? '\u0013DATE \\@ "yyyy-MM-dd"\u00142026-10-06\u0015'
      : "2026-10-06";
    expect(
      (
        await review({
          p: "FD1",
          text: "before",
          to: { p: "HT1", text: "after" },
        })
      )[0],
    ).toBe(
      `before ${field} field after words.\rHT1 Hidden before SECRET hidden after`,
    );
  });

  it("gives a table's whole range, from its first cell to its last row end", async () => {
    install();
    const relations = await Word.run(async (context) => {
      const paragraph = await tagged(context, "CB2");
      const whole =
        paragraph.parentTableCellOrNullObject.parentTable.getRange("Whole");
      const first = (await tagged(context, "CA1")).getRange("Whole");
      const after = (await tagged(context, "RP1")).getRange("Whole");
      const inside = first.compareLocationWith(whole);
      const outside = after.compareLocationWith(whole);
      await context.sync();
      return [inside.value, outside.value];
    });
    expect(relations).toEqual(["InsideStart", "AdjacentAfter"]);
  });

  it("SV2:55-56 counts an inline picture in web prefix offsets but not in paragraph.text", async () => {
    const host = install();
    host.select({ p: "PC1", text: "after picture" });
    const anchor = await Word.run(async (context) => {
      const selection = context.document.getSelection();
      const paragraph = selection.paragraphs.getFirst();
      const prefix = paragraph
        .getRange("Start")
        .expandTo(selection.getRange("Start"));
      prefix.load("text");
      paragraph.load("text");
      const pictures = prefix.inlinePictures;
      pictures.load("items");
      await context.sync();
      return {
        start: prefix.text.length,
        text: paragraph.text,
        pictures: pictures.items.length,
      };
    });
    expect(anchor.text).toBe("PC1 Picture:  after picture.");
    expect(anchor.pictures).toBe(1);
    expect(anchor.start).toBe(desktop ? 14 : 15);
    expect(anchor.text.slice(anchor.start, anchor.start + 13)).toBe(
      desktop ? "after picture" : "fter picture.",
    );
  });

  it("SV2:133 selects an inline picture as one object with host-specific text", async () => {
    const host = install();
    host.select({ picture: 0 });
    const facts = await Word.run(async (context) => {
      const selection = context.document.getSelection();
      selection.load("text,isEmpty");
      const pictures = selection.inlinePictures;
      pictures.load("items");
      await context.sync();
      return [selection.text, selection.isEmpty, pictures.items.length];
    });
    expect(facts).toEqual([desktop ? "" : " ", false, 1]);
  });

  it("SV2:129-132 reports each story's body type and the cell around a selection", async () => {
    const host = install();
    const describeSelection = () =>
      Word.run(async (context) => {
        const selection = context.document.getSelection();
        const body = selection.parentBody;
        body.load("type");
        const outer = body.parentBodyOrNullObject;
        outer.load("type");
        const cell = selection.parentTableCellOrNullObject;
        cell.load("rowIndex,cellIndex");
        const paragraphs = selection.paragraphs;
        paragraphs.load("items/tableNestingLevel,items/styleBuiltIn");
        await context.sync();
        return {
          body: body.type,
          outer: outer.isNullObject ? null : outer.type,
          cell: cell.isNullObject ? null : [cell.rowIndex, cell.cellIndex],
          nesting: paragraphs.items.map((p) => p.tableNestingLevel),
          style: paragraphs.items.map((p) => p.styleBuiltIn),
        };
      });
    host.select({ story: "header", p: "HD1", text: "text line" });
    expect(await describeSelection()).toMatchObject({
      body: "Header",
      outer: desktop ? null : "MainDoc",
      style: ["Header"],
    });
    host.select({ story: "header", table: 0, cell: [0, 1] });
    expect(await describeSelection()).toMatchObject({
      body: "TableCell",
      outer: "Header",
      cell: [0, 1],
    });
    host.select({ story: "footnote", paragraph: 0, text: "body words" });
    expect(await describeSelection()).toMatchObject({
      body: desktop ? "Footnote" : "NoteItem",
      style: ["FootnoteText"],
    });
    host.select({ story: "textbox", p: "TB1" });
    expect((await describeSelection()).body).toBe("Shape");
    host.select({ story: "comment", paragraph: 0, part: "Start" });
    expect((await describeSelection()).body).toBe("Unknown");
    host.select({ table: 0, cell: [1, 0] });
    expect(await describeSelection()).toEqual({
      body: "TableCell",
      outer: "MainDoc",
      cell: [1, 0],
      nesting: [1],
      style: ["Normal"],
    });
    host.select({ table: 0, cell: [0, 0], to: { table: 0, cell: [0, 1] } });
    expect(await describeSelection()).toMatchObject({
      body: "MainDoc",
      cell: null,
      nesting: [1, 1],
    });
  });

  it("SV2:125 compares Whole, Content and neighbouring paragraphs", async () => {
    install();
    const relations = await Word.run(async (context) => {
      const pl1 = await tagged(context, "PL1");
      const li1 = await tagged(context, "LI1");
      const li2 = await tagged(context, "LI2");
      const mp1 = await tagged(context, "MP1");
      const heading = context.document.body.paragraphs.getFirst().getRange();
      const results = [
        pl1.getRange("Whole").compareLocationWith(pl1.getRange("Content")),
        pl1.getRange("Content").compareLocationWith(pl1.getRange("Whole")),
        pl1.getRange("End").compareLocationWith(pl1.getRange("Content")),
        pl1.getRange("After").compareLocationWith(pl1.getRange("Content")),
        li1.getRange("Whole").compareLocationWith(li2.getRange("Whole")),
        pl1.getRange("Whole").compareLocationWith(mp1.getRange("Whole")),
        mp1.getRange("Whole").compareLocationWith(heading),
      ];
      await context.sync();
      return results.map((r) => r.value);
    });
    expect(relations).toEqual([
      "ContainsStart",
      "InsideStart",
      "InsideEnd",
      "After",
      "AdjacentBefore",
      "Before",
      "After",
    ]);
  });

  it("SV2:84-87 formats new text like the first replaced character on desktop and plain on the web", async () => {
    const host = install();
    const bold = await Word.run(async (context) => {
      const written = (
        await firstHit(context, "MX1", "bravo charlie")
      ).insertText("NEW", "Replace");
      written.font.load("bold,italic");
      await context.sync();
      return [written.font.bold, written.font.italic];
    });
    expect(bold).toEqual(desktop ? [true, false] : [false, false]);
    const mx1 = host.paragraphs()[1];
    expect(mx1.text).toBe(
      "MX1 Alpha NEW delta echo foxtrot link golf 2026-10-06 hotel india.",
    );
    expect(mx1.runs.filter((r) => r.link || r.field)).toEqual([
      { text: "link", rStyle: "Hyperlink", link: "https://example.com/" },
      { text: "2026-10-06", field: 'DATE \\@ "yyyy-MM-dd"' },
    ]);
  });

  it("SV2:88-90 extends a desktop hit into a whole hyperlink and fails the web Replace", async () => {
    const host = install();
    const before = host.paragraphs()[1].text;
    const outcome = await errorCode(async (context) => {
      const hit = await firstHit(context, "MX1", "foxtrot li");
      expect(hit.text).toBe(desktop ? "foxtrot link" : "foxtrot li");
      hit.insertText("NEW", "Replace");
      await context.sync();
    });
    if (desktop) {
      expect(outcome).toBe("ok");
      expect(host.paragraphs()[1].text).toBe(
        "MX1 Alpha bravo charlie delta echo NEW golf 2026-10-06 hotel india.",
      );
      expect(host.paragraphs()[1].runs.some((r) => r.link)).toBe(false);
    } else {
      expect(outcome).toBe("GeneralException");
      expect(host.paragraphs()[1].text).toBe(before);
    }
  });

  it("SV2:90-91 drops a field that a Replace crosses", async () => {
    const host = install();
    await Word.run(async (context) => {
      (await firstHit(context, "FD1", "before 2026")).insertText(
        "B",
        "Replace",
      );
      await context.sync();
    });
    const fd1 = host.paragraphs().find((p) => p.text.startsWith("FD1"));
    expect(fd1?.text).toBe("FD1 Field B-10-06 field after words.");
    expect(fd1?.runs.some((r) => r.field)).toBe(false);
  });

  it("SV2:92 turns each newline into one paragraph in the same style", async () => {
    const host = install();
    const ids = host.paragraphs().map((p) => p.id);
    await Word.run(async (context) => {
      (await firstHit(context, "PL1", "kilo")).insertText("A\nB", "Replace");
      (await firstHit(context, "LI1", "quebec")).insertText(
        "X\r\nY",
        "Replace",
      );
      await context.sync();
    });
    const after = host.paragraphs();
    expect(after).toHaveLength(ids.length + 2);
    const at = after.findIndex((p) => p.text === "PL1 Plain paragraph A");
    expect(after.slice(at, at + 2).map((p) => [p.text, p.style])).toEqual([
      ["PL1 Plain paragraph A", "Normal"],
      ["B lima mike november oscar papa.", "Normal"],
    ]);
    expect(after[at].id).not.toBe(ids[2]);
    expect(after[at + 1].id).toBe(ids[2]);
    const li = after.findIndex((p) => p.text === "LI1 List item X");
    expect(
      after.slice(li, li + 2).map((p) => [p.text, p.style, p.list]),
    ).toEqual([
      ["LI1 List item X", "List Paragraph", true],
      ["Y romeo.", "List Paragraph", true],
    ]);
  });

  it("SV2:94-97 merges a cross-paragraph Replace into the last paragraph on desktop and keeps two on the web", async () => {
    const host = install({
      body: [
        { runs: "Block heading words", style: "Heading 1", id: "A" },
        {
          runs: "Block plain words",
          style: "List Paragraph",
          list: true,
          id: "B",
        },
      ],
    });
    await Word.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items");
      await context.sync();
      const head = paragraphs.items[0].search("heading words", {
        matchCase: true,
      });
      const tail = paragraphs.items[1].search("Block plain", {
        matchCase: true,
      });
      head.load("items");
      tail.load("items");
      await context.sync();
      head.items[0].expandTo(tail.items[0]).insertText("Z", "Replace");
      await context.sync();
    });
    expect(host.paragraphs().map((p) => [p.text, p.style, p.id])).toEqual(
      desktop
        ? [["Block Z words", "List Paragraph", "B"]]
        : [
            ["Block Z", "Heading 1", "A"],
            [" words", "List Paragraph", "B"],
          ],
    );
  });

  it("SV2:146 reports paragraph IDs in the host's GUID case", async () => {
    install();
    const id = await Word.run(async (context) => {
      const first = context.document.body.paragraphs.getFirst();
      first.load("uniqueLocalId");
      await context.sync();
      return first.uniqueLocalId;
    });
    expect(id).toMatch(desktop ? /^[0-9A-F-]{36}$/ : /^[0-9a-f-]{36}$/);
  });

  it("SV2:64-65 raises one late event for a programmatic select and none for the same range or a write", async () => {
    vi.useFakeTimers();
    const host = install();
    const events: unknown[] = [];
    host.addHandlerAsync("documentSelectionChanged", (event: unknown) =>
      events.push(event),
    );
    await Promise.resolve();
    const delay = { mac: 350, pc: 230, web: 90 }[flavour];
    const selectPl1 = () =>
      Word.run(async (context) => {
        (await tagged(context, "PL1")).getRange("Whole").select();
        await context.sync();
      });
    await selectPl1();
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(events).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(events).toEqual([
      { type: "documentSelectionChanged", document: Office.context.document },
    ]);
    await selectPl1();
    await Word.run(async (context) => {
      (await firstHit(context, "MP1", "victor")).insertText("V", "Replace");
      await context.sync();
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(events).toHaveLength(1);
  });

  it("SV2:99-105 writes a deletion plus an insertion under Track Changes and Reject restores it", async () => {
    const host = install();
    const original = host.paragraphs();
    await Word.run(async (context) => {
      context.document.changeTrackingMode = "TrackAll";
      (await firstHit(context, "PL1", "lima mike")).insertText(
        "LIMA",
        "Replace",
      );
      await context.sync();
    });
    expect(host.revisions().filter((r) => r.author === "Mock Author")).toEqual([
      { type: "Deleted", text: "lima mike", author: "Mock Author" },
      { type: "Added", text: "LIMA", author: "Mock Author" },
    ]);
    const listed = await Word.run(async (context) => {
      const pl1 = await tagged(context, "PL1");
      const own = pl1.getTrackedChanges();
      const all = context.document.body.getTrackedChanges();
      own.load("items/type");
      all.load("items/type,items/text,items/author");
      const text = pl1.getText();
      await context.sync();
      return {
        own: own.items.map((c) => c.type),
        all: all.items
          .filter((c) => c.author === "Mock Author")
          .map((c) => [c.type, c.text]),
        text: text.value,
      };
    });
    expect(listed.own).toEqual(["Added"]);
    expect(listed.all).toEqual(
      desktop
        ? [["Added", "LIMA"]]
        : [
            ["Deleted", "lima mike"],
            ["Added", "LIMA"],
          ],
    );
    expect(listed.text).toBe(
      `PL1 Plain paragraph kilo LIMA november oscar papa.${desktop ? "\r" : ""}`,
    );
    const rejectListed = () =>
      Word.run(async (context) => {
        const all = context.document.body.getTrackedChanges();
        all.load("items/author,items/type,items/text");
        await context.sync();
        const own = all.items.filter((c) => c.author === "Mock Author");
        own.forEach((c) => c.reject());
        await context.sync();
        return own.map((c) => [c.type, c.text]);
      });
    expect(await rejectListed()).toEqual(
      desktop
        ? [["Added", "LIMA"]]
        : [
            ["Deleted", "lima mike"],
            ["Added", "LIMA"],
          ],
    );
    expect(await rejectListed()).toEqual(
      desktop ? [["Deleted", flavour === "mac" ? "" : "lima mike"]] : [],
    );
    expect(host.paragraphs()).toEqual(original);
  });

  it("SV2:72-74 restores a paragraph exactly from its own getOoxml, in the body and in a cell", async () => {
    const host = install();
    const original = host.paragraphs();
    await Word.run(async (context) => {
      const mx1 = await tagged(context, "MX1");
      const cell = await tagged(context, "CB2");
      const mx1Backup = mx1.getOoxml();
      const cellBackup = cell.getOoxml();
      await context.sync();
      (await firstHit(context, "MX1", "Alpha bravo")).insertText(
        "ALPHA",
        "Replace",
      );
      (await firstHit(context, "CB2", "B2")).insertText("BEE", "Replace");
      await context.sync();
      mx1.insertOoxml(mx1Backup.value, "Replace");
      cell.insertOoxml(cellBackup.value, "Replace");
      await context.sync();
    });
    expect(
      host.paragraphs().map(({ text, style, list, nesting, runs }) => ({
        text,
        style,
        list,
        nesting,
        runs,
      })),
    ).toEqual(
      original.map(({ text, style, list, nesting, runs }) => ({
        text,
        style,
        list,
        nesting,
        runs,
      })),
    );
    expect(host.text({ table: 0, tableWhole: true })).toContain(
      desktop
        ? "CA2 Cell A2 text\tCB2 Cell B2 text\r\n"
        : "CA2 Cell A2 text\rCB2 Cell B2 text\r",
    );
  });

  it("puts every hazard and the styles part into getOoxml", async () => {
    const host = install();
    const ooxml = (tag: string) => host.ooxml({ p: tag, part: "Whole" });
    expect(ooxml("MX1")).toMatch(/<w:hyperlink r:id="rIdLink1"/);
    expect(ooxml("MX1")).toContain('Target="https://example.com/"');
    expect(ooxml("MX1")).toMatch(
      /fldCharType="begin".*DATE.*fldCharType="separate".*2026-10-06.*fldCharType="end"/,
    );
    expect(ooxml("MX1")).toContain("<w:b/>");
    expect(ooxml("HT1")).toContain("<w:vanish/>");
    expect(ooxml("TC1")).toMatch(/<w:ins w:id="\d+" w:author="Other Author"/);
    expect(ooxml("TC1")).toContain(
      '<w:delText xml:space="preserve">deleted words </w:delText>',
    );
    expect(ooxml("FN1")).toContain("<w:footnoteReference");
    expect(ooxml("CM1")).toContain("<w:commentReference");
    expect(ooxml("PC1")).toContain("<w:drawing>");
    expect(host.ooxml({ p: "H1", part: "Whole", to: { p: "MX1" } })).toContain(
      '<w:pStyle w:val="Heading1"/>',
    );
    expect(ooxml("H1")).toMatch(
      /pkg:name="\/word\/styles.xml".*<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"\/><w:basedOn w:val="Normal"\/><w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"\/><w:b\/><w:color w:val="2F5496"\/><w:sz w:val="32"\/>/,
    );
    const span = host.ooxml({ p: "PL1", text: "lima mike" });
    expect(span).toContain('<w:t xml:space="preserve">lima mike</w:t>');
    expect(span).not.toContain("kilo");
    expect(
      host.ooxml({ table: 0, cell: [0, 0], to: { table: 0, cell: [0, 1] } }),
    ).toMatch(
      /<w:tbl><w:tr><w:tc><w:p>.*CA1.*<\/w:tc><w:tc><w:p>.*CB1.*<\/w:tc><\/w:tr><\/w:tbl>/,
    );
  });

  it("reads mixed fonts as null on desktop and as the first character on the web, sets them on every character and resolves style fonts on desktop only", async () => {
    const host = install();
    const fonts = await Word.run(async (context) => {
      const mixed = (await firstHit(context, "MX1", "Alpha bravo")).font;
      const uniform = (await firstHit(context, "MX1", "bravo")).font;
      const heading = (await tagged(context, "H1")).getRange("Content").font;
      const styles = context.document.getStyles();
      const style = styles.getByNameOrNullObject("Heading 1");
      const missing = styles.getByNameOrNullObject("No Such Style");
      for (const font of [mixed, uniform, heading, style.font])
        font.load("bold,size,name");
      missing.load("nameLocal");
      await context.sync();
      return {
        values: [mixed, uniform, heading, style.font].map((f) => [
          f.bold,
          f.size,
          f.name,
        ]),
        missing: missing.isNullObject,
      };
    });
    expect(fonts).toEqual({
      values: [
        [desktop ? null : false, 11, "Calibri"],
        [true, 11, "Calibri"],
        [true, 16, "Calibri Light"],
        desktop ? [true, 16, "Calibri Light"] : [null, null, null],
      ],
      missing: true,
    });
    await Word.run(async (context) => {
      const range = await firstHit(context, "MX1", "Alpha bravo");
      range.font.bold = false;
      range.font.color = "#FF0000";
      await context.sync();
    });
    expect(host.writeSyncs().map((s) => s.writes)).toEqual([
      ["Font.bold=", "Font.color="],
    ]);
    // PF8: bold = false where the style gives no bold writes nothing on any host.
    expect(host.paragraphs()[1].runs.slice(0, 2)).toEqual([
      { text: "MX1 " },
      { text: "Alpha bravo", font: { color: "#FF0000" } },
    ]);
  });

  it("PF2: tracks a format change on inserted text when a set writes something new", async () => {
    install();
    const ooxml = await Word.run(async (context) => {
      context.document.changeTrackingMode = "TrackAll";
      const inserted = (await firstHit(context, "PL1", "lima mike")).insertText(
        "LIMA",
        "Replace",
      );
      inserted.font.bold = false;
      await context.sync();
      const unchanged = (await tagged(context, "PL1")).getOoxml();
      inserted.font.color = "#FF0000";
      await context.sync();
      const changed = (await tagged(context, "PL1")).getOoxml();
      await context.sync();
      return { unchanged: unchanged.value, changed: changed.value };
    });
    expect(ooxml.unchanged).not.toContain("w:rPrChange");
    expect(ooxml.changed).toContain("w:rPrChange");
    const listed = await Word.run(async (context) => {
      const all = context.document.body.getTrackedChanges();
      all.load("items/type,items/author");
      await context.sync();
      return all.items
        .filter((c) => c.author === "Mock Author")
        .map((c) => c.type);
    });
    expect(listed).toEqual(
      desktop ? ["Added"] : ["Deleted", "Added", "Formatted"],
    );
  });

  it("PF8 and PF2: writes no toggle switched off where it already is, and desktop no value the style gives", async () => {
    const host = install();
    await Word.run(async (context) => {
      (await tagged(context, "PL1")).getRange("Content").font.bold = false;
      const heading = (await tagged(context, "H1")).getRange("Content").font;
      heading.bold = true;
      heading.size = 16;
      heading.color = "#000000";
      await context.sync();
    });
    const [h1, , pl1] = host.paragraphs();
    expect(pl1.runs).toEqual([{ text: pl1.text }]);
    expect(h1.runs).toEqual([
      {
        text: h1.text,
        font: desktop
          ? { color: "#000000" }
          : {
              bold: true,
              boldBidirectional: true,
              size: 16,
              sizeBidirectional: 16,
              color: "#000000",
            },
      },
    ]);
  });

  it("PF2: names a heading's style per host and leaves paragraph properties out of the web's single-paragraph OOXML", async () => {
    install();
    const read = await Word.run(async (context) => {
      const h1 = await tagged(context, "H1");
      const mx1 = await tagged(context, "MX1");
      h1.load("style,styleBuiltIn");
      await context.sync();
      const style = context.document
        .getStyles()
        .getByNameOrNullObject(h1.style);
      style.load("nameLocal");
      const single = h1.getOoxml();
      const pair = h1
        .getRange("Whole")
        .expandTo(mx1.getRange("Whole"))
        .getOoxml();
      await context.sync();
      const pStyle = '<w:pStyle w:val="Heading1"/>';
      return {
        style: h1.style,
        builtIn: h1.styleBuiltIn,
        found: !style.isNullObject,
        single: single.value.includes(pStyle),
        pair: pair.value.includes(pStyle),
      };
    });
    expect(read).toEqual({
      style: desktop ? "Heading 1" : "heading 1",
      builtIn: "Heading1",
      found: desktop,
      single: desktop,
      pair: true,
    });
  });

  it("PF3: a span's own OOXML drops the link, control and field around it, and the object model still finds them", async () => {
    const host = install({
      body: [
        {
          runs: [
            "LK1 Before ",
            { text: "the link text", link: "https://example.com/" },
            " after.",
          ],
        },
        {
          runs: [
            "CC1 Before ",
            { text: "the control text", sdt: "tag-1" },
            " after.",
          ],
        },
        {
          runs: [
            "FD1 Before ",
            { text: "2026-10-06", field: 'DATE \\@ "yyyy-MM-dd"' },
            " after.",
          ],
        },
      ],
    });
    const inLink = host.ooxml({ p: "LK1", text: "link" });
    expect(inLink).toContain('<w:rStyle w:val="Hyperlink"/>');
    expect(inLink).not.toContain("<w:hyperlink");
    expect(
      host.ooxml({ p: "LK1", text: "the link text" }).includes("<w:hyperlink"),
    ).toBe(!desktop);
    expect(host.ooxml({ p: "LK1", part: "Whole" })).toContain("<w:hyperlink");
    expect(host.ooxml({ p: "CC1", text: "control" })).not.toContain("<w:sdt>");
    expect(host.ooxml({ p: "CC1", text: "Before the control" })).not.toContain(
      "<w:sdt>",
    );
    expect(host.ooxml({ p: "CC1", part: "Whole" })).toContain("<w:sdt>");
    const inField = host.ooxml({ p: "FD1", text: "10-06" });
    expect(inField).toContain("<w:noProof/>");
    expect(inField.includes("fldChar")).toBe(!desktop);
    expect(host.ooxml({ p: "FD1", part: "Whole" })).toContain("fldChar");

    const found = await Word.run(async (context) => {
      const link = await firstHit(context, "LK1", "link");
      const inside = await firstHit(context, "CC1", "control");
      const partly = await firstHit(context, "CC1", "Before the control");
      const result = await firstHit(context, "FD1", "10-06");
      const fd1 = await tagged(context, "FD1");
      link.load("hyperlink");
      const parent = inside.parentContentControlOrNullObject;
      parent.load("tag");
      const touched = partly.contentControls;
      touched.load("items/tag");
      const fields = fd1.fields;
      fields.load("items/code");
      await context.sync();
      const relation = fields.items[0].result.compareLocationWith(result);
      await context.sync();
      return {
        hyperlink: link.hyperlink,
        parent: parent.isNullObject ? null : parent.tag,
        touched: touched.items.map((c) => c.tag),
        code: fields.items[0].code,
        relation: relation.value,
      };
    });
    expect(found).toEqual({
      hyperlink: "https://example.com/",
      parent: "tag-1",
      touched: ["tag-1"],
      code: 'DATE \\@ "yyyy-MM-dd"',
      relation: "ContainsEnd",
    });
  });

  it("writes a page break as \\f and a column break as \\u000E and reads them back from OOXML", async () => {
    const host = install({ body: ["BR1 Page\fColumn\u000Eend."] });
    const xml = host.ooxml({ p: "BR1", part: "Content" });
    expect(xml).toContain('<w:br w:type="page"/>');
    expect(xml).toContain('<w:br w:type="column"/>');
    await Word.run(async (context) => {
      const br1 = await tagged(context, "BR1");
      const backup = br1.getOoxml();
      await context.sync();
      br1.insertOoxml(backup.value, "Replace");
      await context.sync();
    });
    expect(host.paragraphs()[0].text).toBe("BR1 Page\fColumn\u000Eend.");
  });

  it("SV2:74 and PF4: shows an insertOoxml restore in the same Word.run on desktop and only in a later one on the web", async () => {
    const host = install();
    const original = host.paragraphs()[2].text;
    const sameRun = await Word.run(async (context) => {
      const pl1 = await tagged(context, "PL1");
      const backup = pl1.getOoxml();
      await context.sync();
      (await firstHit(context, "PL1", "kilo")).insertText("KILO", "Replace");
      await context.sync();
      pl1.insertOoxml(backup.value, "Replace");
      await context.sync();
      const again = context.document.body.paragraphs;
      again.load("items/text");
      await context.sync();
      return again.items[2].text;
    });
    expect(sameRun).toBe(desktop ? original : original.replace("kilo", "KILO"));
    expect(host.paragraphs()[2].text).toBe(original);
  });

  it("writes the complex-script twin of a font set where the host does", async () => {
    const host = install();
    await Word.run(async (context) => {
      const range = (await tagged(context, "PL1")).getRange("Content");
      range.font.italic = true;
      range.font.size = 14;
      range.font.name = "Georgia";
      await context.sync();
    });
    expect(host.ooxml({ p: "PL1", part: "Content" })).toContain(
      desktop
        ? '<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia"/><w:i/><w:sz w:val="28"/>'
        : '<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia"/><w:i/><w:iCs/><w:sz w:val="28"/><w:szCs w:val="28"/>',
    );
  });

  it("errors on a desktop search over 256 characters, never on the web, and keeps the commands before it", async () => {
    const host = install();
    expect(
      await errorCode(async (context) => {
        const pl1 = await tagged(context, "PL1");
        pl1.search("x".repeat(256)).load("items");
        await context.sync();
      }),
    ).toBe("ok");
    expect(
      await errorCode(async (context) => {
        const pl1 = await tagged(context, "PL1");
        pl1.insertText("Start ", "Start");
        pl1.search("x".repeat(desktop ? 257 : 400)).load("items");
        await context.sync();
      }),
    ).toBe(desktop ? "SearchStringInvalidOrTooLong" : "ok");
    expect(host.paragraphs()[2].text).toBe(
      "Start PL1 Plain paragraph kilo lima mike november oscar papa.",
    );
  });

  describe("preflight impact 1: reading or selecting an expandTo range within one paragraph", () => {
    const SIDE_EFFECTS: MockSelectionDocument = {
      body: [
        {
          runs: [
            "SE1 ",
            { text: "hidden ", hidden: true },
            { text: "szcs ", font: { sizeBidirectional: 14 } },
            { text: "bcs ", font: { boldBidirectional: true } },
            { text: "both ", font: { bold: true, boldBidirectional: true } },
            { text: "size ", font: { size: 14 } },
            { text: "rtl", font: { rtl: true } },
            " end.",
          ],
        },
        "SE2 Next paragraph.",
      ],
    };
    const ORIGINAL = [
      { text: "SE1 " },
      { text: "hidden ", font: { hidden: true } },
      { text: "szcs ", font: { sizeBidirectional: 14 } },
      { text: "bcs ", font: { boldBidirectional: true } },
      { text: "both ", font: { bold: true, boldBidirectional: true } },
      { text: "size ", font: { size: 14 } },
      { text: "rtl", font: { rtl: true } },
      { text: " end." },
    ];
    const runsAfter = async (
      read: (se1: Word.Paragraph, end: Word.Range, se2: Word.Paragraph) => void,
    ) => {
      const host = install(SIDE_EFFECTS);
      await Word.run(async (context) => {
        const se1 = await tagged(context, "SE1");
        const se2 = await tagged(context, "SE2");
        read(se1, await firstHit(context, "SE1", " end."), se2);
        await context.sync();
      });
      return host.paragraphs()[0].runs;
    };
    const prefix = (se1: Word.Paragraph, end: Word.Range) =>
      se1.getRange("Start").expandTo(end.getRange("Start"));

    it("unhides, drops cs-only twins, adds szCs and drops rtl for a prefix range on the web only", async () => {
      const expected = desktop
        ? ORIGINAL
        : [
            { text: "SE1 hidden szcs bcs " },
            { text: "both ", font: { bold: true, boldBidirectional: true } },
            { text: "size ", font: { size: 14, sizeBidirectional: 14 } },
            { text: "rtl end." },
          ];
      expect(
        await runsAfter((se1, end) => {
          prefix(se1, end).load("text");
        }),
      ).toEqual(expected);
      expect(
        await runsAfter((se1, end) => {
          prefix(se1, end).select();
        }),
      ).toEqual(expected);
    });

    it("keeps hidden text and szCs-only runs for the paragraph's own Whole.expandTo(Whole) on the web", async () => {
      expect(
        await runsAfter((se1) => {
          const whole = se1.getRange("Whole");
          whole.expandTo(whole).getOoxml();
        }),
      ).toEqual(
        desktop
          ? ORIGINAL
          : [
              { text: "SE1 " },
              { text: "hidden ", font: { hidden: true } },
              { text: "szcs ", font: { sizeBidirectional: 14 } },
              { text: "bcs " },
              { text: "both ", font: { bold: true, boldBidirectional: true } },
              { text: "size ", font: { size: 14, sizeBidirectional: 14 } },
              { text: "rtl end." },
            ],
      );
    });

    it("changes nothing for a range over several paragraphs", async () => {
      expect(
        await runsAfter((se1, _end, se2) => {
          se1.getRange("Whole").expandTo(se2.getRange("Whole")).getOoxml();
        }),
      ).toEqual(ORIGINAL);
    });
  });

  it("finds repeated text by occurrence and never reads '^' as itself", async () => {
    install({ body: ["RP1 Repeated word one. Repeated word one. 50^2 one."] });
    const hits = await Word.run(async (context) => {
      const paragraph = context.document.body.paragraphs.getFirst();
      const repeated = paragraph.search("repeated word", { matchCase: false });
      const caret = paragraph.search("50^2", { matchCase: true });
      repeated.load("items/text");
      caret.load("items");
      await context.sync();
      const starts = repeated.items.map((hit) =>
        paragraph.getRange("Start").expandTo(hit.getRange("Start")),
      );
      starts.forEach((range) => range.load("text"));
      await context.sync();
      return {
        texts: repeated.items.map((h) => h.text),
        offsets: starts.map((r) => r.text.length),
        caret: caret.items.length,
      };
    });
    expect(hits).toEqual({
      texts: ["Repeated word", "Repeated word"],
      offsets: [4, 23],
      caret: 0,
    });
  });

  it("counts syncs and records which commands wrote", async () => {
    const host = install();
    await Word.run(async (context) => {
      const pl1 = await tagged(context, "PL1");
      pl1.getRange("Content").insertText("X", "End");
    });
    expect(host.syncCount()).toBe(2);
    expect(host.syncLog().map((s) => s.writes)).toEqual([
      [],
      ["Range.insertText"],
    ]);
    expect(host.writeSyncs()).toHaveLength(1);
    expect(host.calls()).toEqual([
      "ParagraphCollection.load",
      "RequestContext.sync",
      "Paragraph.getRange",
      "Range.insertText",
    ]);
  });

  it("requires a load and a sync before a property or result is read", async () => {
    install();
    await Word.run(async (context) => {
      const first = context.document.body.paragraphs.getFirst();
      const text = first.getText();
      expect(() => first.text).toThrow(/is not available/);
      expect(() => text.value).toThrow(/has not been loaded/);
      await context.sync();
      expect(text.value.startsWith("H1 Selection probe heading")).toBe(true);
      expect(() => first.text).toThrow(/is not available/);
    });
  });
});

describe("requirement flavours", () => {
  const FLAVOURS: Record<WordRequirementFlavour, WordSelectionHostFlavour> = {
    m365: "mac",
    web: "web",
    ltsc2024: "pc",
    ltsc2021: "pc",
  };

  it.each([
    [
      "m365",
      {
        "WordApi 1.9": true,
        "WordApi 1.10": false,
        "WordApiDesktop 1.5": true,
      },
    ],
    [
      "web",
      {
        "WordApi 1.11": true,
        "WordApi 1.12": false,
        "WordApiDesktop 1.1": false,
        "WordApiOnline 1.1": true,
      },
    ],
    [
      "ltsc2024",
      {
        "WordApi 1.8": true,
        "WordApi 1.9": false,
        "WordApiDesktop 1.1": true,
        "WordApiDesktop 1.2": false,
      },
    ],
    [
      "ltsc2021",
      {
        "WordApi 1.3": true,
        "WordApi 1.4": false,
        "WordApiDesktop 1.1": false,
      },
    ],
  ] as const)(
    "SV2:11-13 and plan §4: answers isSetSupported for %s",
    (requirements, expected) => {
      installWordSelectionHost(SV2_MAIN_DOCUMENT, {
        host: FLAVOURS[requirements],
        requirements,
      });
      const answers = Object.fromEntries(
        Object.keys(expected).map((key) => {
          const [name, version] = key.split(" ");
          return [
            key,
            Office.context.requirements.isSetSupported(name, version),
          ];
        }),
      );
      expect(answers).toEqual(expected);
      expect(Office.context.requirements.isSetSupported("WordApi")).toBe(true);
    },
  );

  const PROBES: Record<
    string,
    (context: Word.RequestContext) => Promise<unknown>
  > = {
    getText: async (context) => {
      const text = context.document.body.paragraphs.getFirst().getText();
      await context.sync();
      return text.value;
    },
    uniqueLocalId: async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items/uniqueLocalId");
      await context.sync();
      return paragraphs.items[0].uniqueLocalId;
    },
    getParagraphByUniqueLocalId: async (context) => {
      const first = context.document.body.paragraphs.getFirst();
      first.load("uniqueLocalId");
      await context.sync();
      const paragraph = context.document.getParagraphByUniqueLocalId(
        first.uniqueLocalId || "missing",
      );
      paragraph.load("text");
      await context.sync();
    },
    changeTrackingMode: async (context) => {
      context.document.load("changeTrackingMode");
      await context.sync();
    },
    getStyles: async (context) => {
      const style = context.document
        .getStyles()
        .getByNameOrNullObject("Normal");
      style.font.load("name");
      await context.sync();
    },
    getTrackedChanges: async (context) => {
      context.document.body.getTrackedChanges().load("items");
      await context.sync();
    },
    fontHidden: async (context) => {
      const font = context.document.body.paragraphs
        .getFirst()
        .getRange("Content").font;
      font.load("hidden");
      await context.sync();
    },
    bidiSetter: async (context) => {
      context.document.body.paragraphs
        .getFirst()
        .getRange("Content").font.boldBidirectional = true;
      await context.sync();
    },
    getHyperlinkRanges: async (context) => {
      context.document.body
        .getRange("Whole")
        .getHyperlinkRanges()
        .load("items");
      await context.sync();
    },
    inlinePictures: async (context) => {
      context.document.body.getRange("Whole").inlinePictures.load("items");
      await context.sync();
    },
    compareLocationWith: async (context) => {
      const first = context.document.body.paragraphs.getFirst();
      const relation = first
        .getRange("Whole")
        .compareLocationWith(first.getRange("Content"));
      await context.sync();
      return relation.value;
    },
    loadAllParagraphProperties: async (context) => {
      context.document.body.paragraphs.load("items");
      await context.sync();
    },
  };
  const NOT_FOUND = "ApiNotFound";

  it.each([
    ["m365", {}],
    ["web", { fontHidden: NOT_FOUND, bidiSetter: NOT_FOUND }],
    [
      "ltsc2024",
      {
        fontHidden: NOT_FOUND,
        bidiSetter: NOT_FOUND,
        getParagraphByUniqueLocalId: "ItemNotFound",
      },
    ],
    [
      "ltsc2021",
      {
        getText: NOT_FOUND,
        uniqueLocalId: NOT_FOUND,
        getParagraphByUniqueLocalId: NOT_FOUND,
        changeTrackingMode: NOT_FOUND,
        getStyles: NOT_FOUND,
        getTrackedChanges: NOT_FOUND,
        fontHidden: NOT_FOUND,
        bidiSetter: NOT_FOUND,
      },
    ],
  ] as const)(
    "throws ApiNotFound for APIs outside %s",
    async (requirements, failures) => {
      installWordSelectionHost(SV2_MAIN_DOCUMENT, {
        host: FLAVOURS[requirements],
        requirements,
      });
      const outcomes: Record<string, string> = {};
      for (const [name, probe] of Object.entries(PROBES))
        outcomes[name] = await errorCode(probe);
      expect(outcomes).toEqual({
        ...Object.fromEntries(Object.keys(PROBES).map((name) => [name, "ok"])),
        ...failures,
      });
    },
  );

  it("reports null paragraph IDs on ltsc2024 while the set is supported", async () => {
    installWordSelectionHost(SV2_MAIN_DOCUMENT, {
      host: "pc",
      requirements: "ltsc2024",
    });
    expect(Office.context.requirements.isSetSupported("WordApi", "1.6")).toBe(
      true,
    );
    expect(await Word.run(PROBES.uniqueLocalId)).toBeNull();
  });

  it("reports the platform the run guard and support table read", () => {
    installWordSelectionHost(SV2_MAIN_DOCUMENT, { host: "web" });
    expect(Office.context.diagnostics.platform).toBe("OfficeOnline");
    installWordSelectionHost(SV2_MAIN_DOCUMENT, {
      host: "pc",
      requirements: "ltsc2021",
    });
    expect(Office.context.diagnostics.platform).toBe("PC");
  });
});

describe("tracked ranges", () => {
  it.each(["mac", "pc"] as const)(
    "SV2:41-46 on %s: a foreign context reads stale text silently, mixing contexts throws, Word.run(r) reads the range grown by an edit inside it",
    async (flavour) => {
      const host = installWordSelectionHost(SV2_MAIN_DOCUMENT, {
        host: flavour,
      });
      host.select({ p: "PL1", text: "lima mike" });
      const tracked = await Word.run(async (context) => {
        const selection = context.document.getSelection();
        selection.track();
        selection.load("text");
        await context.sync();
        expect(selection.text).toBe("lima mike");
        return selection;
      });
      host.insertText({ p: "PL1", text: "lima" }, " INSIDE", "End");

      const foreign = await Word.run(async (context) => {
        tracked.load("text");
        await context.sync();
        return tracked.text;
      });
      expect(foreign).toBe("lima mike");

      expect(
        await errorCode(async (context) => {
          context.document.getSelection().expandTo(tracked);
          await context.sync();
        }),
      ).toBe("InvalidRequestContext");

      const live = await Word.run(tracked, async (context) => {
        tracked.load("text");
        await context.sync();
        return tracked.text;
      });
      expect(live).toBe("lima INSIDE mike");
      expect(host.run).toHaveBeenLastCalledWith(tracked, expect.any(Function));
    },
  );

  it("SV2:44-45 and :52 on web: a tracked range keeps its offsets and length, so an earlier edit moves it and a write lands on the wrong passage", async () => {
    const host = installWordSelectionHost(SV2_MAIN_DOCUMENT, { host: "web" });
    host.select({ p: "PL1", text: "lima mike" });
    const tracked = await Word.run(async (context) => {
      const selection = context.document.getSelection();
      selection.track();
      selection.load("text");
      await context.sync();
      return selection;
    });
    const read = () =>
      Word.run(tracked, async (context) => {
        tracked.load("text");
        await context.sync();
        return tracked.text;
      });
    host.insertText({ p: "PL1", text: "lima" }, " INSIDE", "End");
    expect(await read()).toBe("lima INSI");
    host.insertText({ p: "PL1", text: "kilo" }, "XYZ ", "Start");
    expect(await read()).toBe("ilo lima ");
    host.insertParagraphs({ p: "PL1" }, ["NEW1 Paragraph before."], "Before");
    expect(await read()).toBe("ilo lima ");
    await Word.run(tracked, async (context) => {
      tracked.insertText("WRITTEN", "Replace");
      await context.sync();
    });
    expect(host.paragraphs()[3].text).toBe(
      "PL1 Plain paragraph XYZ kWRITTENINSIDE mike november oscar papa.",
    );
  });

  it("refuses an untracked object once its run has ended", async () => {
    installWordSelectionHost(SV2_MAIN_DOCUMENT);
    const [tracked, untracked] = await Word.run(async (context) => {
      const first = context.document.body.paragraphs.getFirst();
      const a = first.getRange("Content");
      const b = first.getRange("Whole");
      context.trackedObjects.add(a);
      await context.sync();
      return [a, b];
    });
    await expect(
      Word.run(tracked, async (context) => {
        untracked.load("text");
        await context.sync();
      }),
    ).rejects.toMatchObject({ code: "InvalidObjectPath" });
  });
});

describe("sync control", () => {
  it("holds a sync until released and runs its commands then", async () => {
    const host = installWordSelectionHost(SV2_MAIN_DOCUMENT);
    const hang = host.hangSync();
    let settled = false;
    const done = Word.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items");
      await context.sync();
      return paragraphs.items.length;
    }).then((count) => {
      settled = true;
      return count;
    });
    expect(await hang.reached).toBe(1);
    await flush();
    expect(settled).toBe(false);
    expect(host.syncLog()).toEqual([]);
    hang.release();
    expect(await done).toBe(host.paragraphs().length);
    expect(host.syncLog()).toHaveLength(1);
  });

  it("can run a held sync's writes before its late reply", async () => {
    const host = installWordSelectionHost(SV2_MAIN_DOCUMENT);
    const hang = host.hangSync({ at: 2, execute: "immediately" });
    const done = Word.run(async (context) => {
      (await tagged(context, "PL1")).insertText("Late ", "Start");
      await context.sync();
    });
    await hang.reached;
    expect(host.paragraphs()[2].text.startsWith("Late PL1")).toBe(true);
    expect(host.writeSyncs()).toHaveLength(1);
    hang.release();
    await done;
  });

  it("lets a test edit the document between two syncs of one batch", async () => {
    const host = installWordSelectionHost(SV2_MAIN_DOCUMENT);
    host.beforeSync((index) => {
      if (index === 2) host.insertText({ p: "PL1", text: "kilo" }, "KILO");
    });
    const texts = await Word.run(async (context) => {
      const pl1 = await tagged(context, "PL1");
      const before = pl1.text;
      pl1.load("text");
      await context.sync();
      return [before, pl1.text];
    });
    expect(texts).toEqual([
      "PL1 Plain paragraph kilo lima mike november oscar papa.",
      "PL1 Plain paragraph KILO lima mike november oscar papa.",
    ]);
  });
});

describe("selection events", () => {
  it("SV2:63-66 registers asynchronously, fires once per changed user selection and removes one handler", async () => {
    const host = installWordSelectionHost(SV2_MAIN_DOCUMENT);
    const seen: string[] = [];
    const first = () => seen.push("first");
    const second = () => seen.push("second");
    const results: unknown[] = [];
    host.addHandlerAsync("documentSelectionChanged", first, (r: unknown) =>
      results.push(r),
    );
    host.addHandlerAsync("documentSelectionChanged", second, {}, (r: unknown) =>
      results.push(r),
    );
    expect(host.handlerCount()).toBe(0);
    await flush();
    expect(results).toEqual([
      { status: "succeeded", value: undefined },
      { status: "succeeded", value: undefined },
    ]);
    host.select({ p: "PL1", text: "kilo" });
    host.select({ p: "PL1", text: "kilo" });
    expect(seen).toEqual(["first", "second"]);
    host.removeHandlerAsync("documentSelectionChanged", { handler: first });
    await flush();
    host.select({ p: "MP1", text: "victor" });
    host.select({ p: "MP2", text: "xray" }, { event: false });
    expect(seen).toEqual(["first", "second", "second"]);
    host.removeHandlerAsync("documentSelectionChanged");
    await flush();
    expect(host.handlerCount()).toBe(0);
  });

  it("can hold or fail a registration", async () => {
    const host = installWordSelectionHost(SV2_MAIN_DOCUMENT);
    const release = host.holdHandlerRegistration();
    const results: { status: string }[] = [];
    host.addHandlerAsync(
      "documentSelectionChanged",
      () => {},
      (r: { status: string }) => results.push(r),
    );
    await flush();
    expect(results).toEqual([]);
    release();
    expect(results.map((r) => r.status)).toEqual(["succeeded"]);
    host.failHandlerRegistration("blocked");
    host.addHandlerAsync(
      "documentSelectionChanged",
      () => {},
      (r: { status: string }) => results.push(r),
    );
    host.addHandlerAsync(
      "documentSelectionChanged",
      "not a function",
      (r: { status: string }) => results.push(r),
    );
    await flush();
    expect(results.map((r) => r.status)).toEqual([
      "succeeded",
      "failed",
      "failed",
    ]);
    expect(host.handlerCount()).toBe(1);
  });
});

describe("test controls", () => {
  it("deletes, inserts and restyles paragraphs and formats runs as a user would", () => {
    const host = installWordSelectionHost(SV2_MAIN_DOCUMENT);
    const texts = () => host.paragraphs().map((p) => p.text);
    const count = texts().length;
    host.deleteParagraphs({ p: "PL1" });
    expect(texts()).toHaveLength(count - 1);
    expect(texts().some((text) => text.startsWith("PL1 "))).toBe(false);
    host.insertParagraphs(
      { p: "MP1" },
      ["NEW1 First new.", { runs: "NEW2 Second new.", style: "Heading 2" }],
      "Before",
    );
    const mp1 = texts().findIndex((text) => text.startsWith("MP1 "));
    expect(texts().slice(mp1 - 2, mp1)).toEqual([
      "NEW1 First new.",
      "NEW2 Second new.",
    ]);
    const inserted = host.paragraphs().slice(mp1 - 2, mp1);
    expect(inserted.map((p) => p.style)).toEqual(["Normal", "Heading 2"]);
    expect(new Set(host.paragraphs().map((p) => p.id)).size).toBe(count + 1);
    host.setParagraphStyle({ p: "MP2" }, "Heading 3");
    host.format(
      { p: "MP3", text: "zulu" },
      { font: { italic: true }, sdt: "tag" },
    );
    const after = host.paragraphs();
    expect(after.find((p) => p.text.startsWith("MP2 "))?.style).toBe(
      "Heading 3",
    );
    expect(after.find((p) => p.text.startsWith("MP3 "))?.runs).toContainEqual({
      text: "zulu",
      font: { italic: true },
      sdt: "tag",
    });
  });

  it("tracks a user edit under Track Changes, and Reject or Accept settles it", () => {
    const host = installWordSelectionHost({
      body: ["MP1 Multi paragraph uniform victor whiskey."],
    });
    host.setTrackingMode("TrackAll");
    expect(host.trackingMode()).toBe("TrackAll");
    host.insertText({ p: "MP1", text: "victor" }, "VICTOR");
    expect(host.revisions()).toEqual([
      { type: "Deleted", text: "victor", author: "Mock Author" },
      { type: "Added", text: "VICTOR", author: "Mock Author" },
    ]);
    host.rejectAllRevisions();
    expect(host.paragraphs()[0].text).toBe(
      "MP1 Multi paragraph uniform victor whiskey.",
    );
    expect(host.revisions()).toEqual([]);
    host.insertText({ p: "MP1", text: "victor" }, "VICTOR");
    host.acceptAllRevisions();
    expect(host.paragraphs()[0].text).toBe(
      "MP1 Multi paragraph uniform VICTOR whiskey.",
    );
    expect(host.revisions()).toEqual([]);
  });

  it("runs after-sync hooks, fires selection events on demand and reports the document URL", async () => {
    const host = installWordSelectionHost(SV2_MAIN_DOCUMENT, {
      url: "https://example.com/selection.docx",
    });
    expect(Office.context.document.url).toBe(
      "https://example.com/selection.docx",
    );
    const synced: number[] = [];
    const stop = host.afterSync((index) => synced.push(index));
    await Word.run(async (context) => {
      context.document.body.paragraphs.load("items");
      await context.sync();
    });
    stop();
    await Word.run(async (context) => {
      context.document.body.paragraphs.load("items");
      await context.sync();
    });
    expect(synced).toEqual([1]);
    const handler = vi.fn();
    host.addHandlerAsync("documentSelectionChanged", handler);
    await flush();
    host.fireSelectionChanged();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("reports null paragraph IDs when asked, on any requirement level", async () => {
    installWordSelectionHost(SV2_MAIN_DOCUMENT, { nullParagraphIds: true });
    const id = await Word.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items/uniqueLocalId");
      await context.sync();
      return paragraphs.items[0].uniqueLocalId;
    });
    expect(id).toBeNull();
  });
});
