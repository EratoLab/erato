import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DefaultComposerContextChipFace } from "@/components/ui/Chat/ComposerContext/ComposerContextChip";

import { composerContextChipFaceConformanceFailures } from "../composerContextChipFace";

import type { ComposerContextChipFaceProps } from "@/components/ui/Chat/ComposerContext/types";

const harness = { render };

describe("composerContextChipFaceConformanceFailures", () => {
  it("passes the host's own face", () => {
    expect(
      composerContextChipFaceConformanceFailures(
        DefaultComposerContextChipFace,
        harness,
      ),
    ).toEqual([]);
  });

  it("passes a face that wraps the default", () => {
    const Wrapped = (props: ComposerContextChipFaceProps) => (
      <span data-kit="wrapped">
        <DefaultComposerContextChipFace {...props} />
      </span>
    );
    expect(
      composerContextChipFaceConformanceFailures(Wrapped, harness),
    ).toEqual([]);
  });

  it("reports a face with a button of its own", () => {
    const Nested = ({ item }: ComposerContextChipFaceProps) => (
      <span>
        {item.label}
        <button type="button">x</button>
      </span>
    );
    const failures = composerContextChipFaceConformanceFailures(
      Nested,
      harness,
    );
    expect(
      failures.filter((failure) => /focusable or clickable/.test(failure)),
    ).toHaveLength(18);
  });

  it("reports a face that drops the label", () => {
    const Blank = ({ meta }: ComposerContextChipFaceProps) => (
      <span>{meta}</span>
    );
    const failures = composerContextChipFaceConformanceFailures(Blank, harness);
    expect(failures).toHaveLength(18);
    expect(failures.every((failure) => failure.includes("label"))).toBe(true);
  });

  it("reports a face that drops the meta, the scope default included", () => {
    const LabelOnly = ({ item }: ComposerContextChipFaceProps) => (
      <span>{item.label}</span>
    );
    const failures = composerContextChipFaceConformanceFailures(
      LabelOnly,
      harness,
    );
    expect(failures).toHaveLength(18);
    expect(failures.every((failure) => failure.includes("meta"))).toBe(true);
    expect(failures.some((failure) => failure.includes("suggested"))).toBe(
      true,
    );
  });
});
