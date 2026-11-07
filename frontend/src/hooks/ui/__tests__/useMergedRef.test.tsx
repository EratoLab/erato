import { render } from "@testing-library/react";
import { createRef, forwardRef, useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { useMergedRef } from "../useMergedRef";

const Probe = forwardRef<HTMLInputElement, { seen: (node: unknown) => void }>(
  function Probe({ seen }, ref) {
    const own = useRef<HTMLInputElement | null>(null);
    const setRef = useMergedRef(own, ref);
    return (
      <input
        ref={(node) => {
          setRef(node);
          seen(own.current);
        }}
      />
    );
  },
);

describe("useMergedRef", () => {
  it("fills the own ref and an object ref", () => {
    const seen = vi.fn();
    const ref = createRef<HTMLInputElement>();
    render(<Probe ref={ref} seen={seen} />);

    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(seen).toHaveBeenCalledWith(ref.current);
  });

  it("calls a callback ref", () => {
    const callback = vi.fn();
    render(<Probe ref={callback} seen={vi.fn()} />);

    expect(callback).toHaveBeenCalledWith(expect.any(HTMLInputElement));
  });
});
