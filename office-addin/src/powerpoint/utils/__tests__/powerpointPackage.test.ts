import { describe, expect, it } from "vitest";

import { parseOfficeXml } from "../../../utils/officeXml";
import { readChart } from "../powerpointPackage";

const C = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";

const chart = (plot: string, extra = "") =>
  readChart(
    parseOfficeXml(
      `<c:chartSpace xmlns:c="${C}" xmlns:a="${A}">${extra}<c:chart><c:autoTitleDeleted val="1"/><c:plotArea>${plot}</c:plotArea></c:chart></c:chartSpace>`,
    ),
  );
const pts = (values: (string | number)[]) =>
  values.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join("");
const num = (values: (string | number)[], format = "General") =>
  `<c:numRef><c:numCache><c:formatCode>${format}</c:formatCode><c:ptCount val="${values.length}"/>${pts(values)}</c:numCache></c:numRef>`;

describe("chart data keeps its meaning", () => {
  it("turns date categories into dates and names a value format", () => {
    const out = chart(
      `<c:lineChart><c:ser><c:cat>${num([45292, 45323], "m/d/yyyy")}</c:cat><c:val>${num([0.25, 0.5], "0%")}</c:val></c:ser></c:lineChart>`,
    );
    expect(out.categories).toEqual(["2024-01-01", "2024-02-01"]);
    expect(out.series[0]).toEqual({ values: [0.25, 0.5], format: "0%" });
  });

  it("counts dates from 1904 where the chart says so", () => {
    const out = chart(
      `<c:lineChart><c:ser><c:cat>${num([0], "[$-409]mmm\\-yy")}</c:cat><c:val>${num([1])}</c:val></c:ser></c:lineChart>`,
      `<c:date1904 val="1"/>`,
    );
    expect(out.categories).toEqual(["1904-01-01"]);
  });

  it("keeps every level of multi-level categories", () => {
    const out = chart(
      `<c:barChart><c:barDir val="col"/><c:ser><c:cat><c:multiLvlStrRef><c:multiLvlStrCache><c:ptCount val="4"/><c:lvl>${pts(["Q1", "Q2", "Q1", "Q2"])}</c:lvl><c:lvl><c:pt idx="0"><c:v>2024</c:v></c:pt><c:pt idx="2"><c:v>2025</c:v></c:pt></c:lvl></c:multiLvlStrCache></c:multiLvlStrRef></c:cat><c:val>${num([1, 2, 3, 4])}</c:val></c:ser></c:barChart>`,
    );
    expect(out.categories).toEqual([
      "2024 / Q1",
      "2024 / Q2",
      "2025 / Q1",
      "2025 / Q2",
    ]);
  });

  it("gives scatter and bubble points their x values and sizes", () => {
    const out = chart(
      `<c:bubbleChart><c:ser><c:xVal>${num([1.5, 2])}</c:xVal><c:yVal>${num([3, 4])}</c:yVal><c:bubbleSize>${num([10, 20])}</c:bubbleSize></c:ser></c:bubbleChart>`,
    );
    expect(out.type).toBe("bubble");
    expect(out.series[0]).toEqual({
      x: [1.5, 2],
      values: [3, 4],
      sizes: [10, 20],
    });
  });
});

describe("chart limits", () => {
  it("does not allocate from a crafted point count", () => {
    const started = Date.now();
    const out = chart(
      `<c:lineChart><c:ser><c:val><c:numRef><c:numCache><c:ptCount val="60000000"/><c:pt idx="0"><c:v>1</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:lineChart>`,
    );
    expect(Date.now() - started).toBeLessThan(500);
    expect(out.series[0].values).toHaveLength(200);
    expect(out.unread).toEqual([
      "points 201-60000000 of each series: cut to keep the result small",
    ]);
  });

  it("caps titles, series names and labels", () => {
    const long = "x".repeat(30000);
    const out = readChart(
      parseOfficeXml(
        `<c:chartSpace xmlns:c="${C}" xmlns:a="${A}"><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>${long}</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:lineChart><c:ser><c:tx><c:v>${long}</c:v></c:tx><c:cat><c:strRef><c:strCache><c:ptCount val="1"/>${pts([long])}</c:strCache></c:strRef></c:cat><c:val>${num([1])}</c:val></c:ser></c:lineChart></c:plotArea></c:chart></c:chartSpace>`,
      ),
    );
    expect(JSON.stringify(out).length).toBeLessThan(1000);
  });

  it("numbers an unnamed series by its place in the chart", () => {
    const out = chart(
      `<c:lineChart><c:ser></c:ser><c:ser><c:val><c:numRef><c:f>A1</c:f></c:numRef></c:val></c:ser></c:lineChart>`,
    );
    expect(out.unread).toEqual([
      "series 1 values: not saved with the chart",
      "series 2 values: not saved with the chart",
    ]);
  });
});
