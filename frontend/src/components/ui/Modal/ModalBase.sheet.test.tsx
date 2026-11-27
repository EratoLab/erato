import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModalBase } from "./ModalBase";
import { sheetSettlesClosed } from "./useSheetDismiss";

const originalMatchMedia = window.matchMedia;

function mockScreen({
  phone = true,
  reducedMotion = false,
}: { phone?: boolean; reducedMotion?: boolean } = {}) {
  window.matchMedia = (query: string) =>
    ({
      matches:
        (query.includes("max-width") && phone) ||
        (query.includes("prefers-reduced-motion") && reducedMotion),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

function Harness({
  onClose,
  title = "Share",
  placement,
}: {
  onClose?: () => void;
  title?: string;
  placement?: "center" | "bottom" | "fullscreen";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <ModalBase
        isOpen={open}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        title={title}
        placement={placement}
      >
        <p>Body</p>
        <input aria-label="Name" />
      </ModalBase>
    </>
  );
}

const shell = () => screen.getByRole("dialog");
const header = () =>
  shell().querySelector('[data-ui="modal-header"]') as HTMLElement;

/** One finger from `from` through each of `to`, `stepMs` apart. */
function drag(
  target: HTMLElement,
  from: number,
  to: number[],
  { stepMs = 40, lift = true } = {},
) {
  fireEvent.touchStart(target, {
    touches: [{ clientX: 100, clientY: from }],
  });
  for (const y of to) {
    act(() => {
      vi.advanceTimersByTime(stepMs);
    });
    fireEvent.touchMove(target, { touches: [{ clientX: 100, clientY: y }] });
  }
  if (lift) {
    const last = to.at(-1) ?? from;
    fireEvent.touchEnd(target, {
      touches: [],
      changedTouches: [{ clientX: 100, clientY: last }],
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  mockScreen();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.matchMedia = originalMatchMedia;
});

describe("ModalBase as a sheet on a phone", () => {
  it("opens as a sheet with a grabber, except full screen", () => {
    const { rerender } = render(
      <ModalBase isOpen onClose={vi.fn()} title="Share" placement="bottom">
        <p>Body</p>
      </ModalBase>,
    );
    const overlay = document.querySelector('[data-ui="modal-overlay"]');
    expect(overlay).toHaveAttribute("data-sheet");
    expect(overlay).toHaveClass("items-end");
    expect(overlay).not.toHaveClass("[--modal-viewport-margin:0.5rem]");
    expect(shell()).toHaveAttribute("data-sheet");
    expect(shell()).not.toHaveClass("max-w-full");
    const grabber = shell().querySelector('[data-ui="modal-grabber"]');
    expect(grabber).toHaveAttribute("aria-hidden", "true");
    expect(shell().firstElementChild).toBe(grabber);

    rerender(
      <ModalBase isOpen onClose={vi.fn()} title="Share" placement="fullscreen">
        <p>Body</p>
      </ModalBase>,
    );
    expect(shell()).not.toHaveAttribute("data-sheet");
    expect(shell().querySelector('[data-ui="modal-grabber"]')).toBeNull();
  });

  it("stays a centred dialog under a mouse or on a wide screen", () => {
    mockScreen({ phone: false });
    render(
      <ModalBase isOpen onClose={vi.fn()} title="Share">
        <p>Body</p>
      </ModalBase>,
    );
    expect(shell()).not.toHaveAttribute("data-sheet");
    expect(shell().querySelector('[data-ui="modal-grabber"]')).toBeNull();
  });

  it("closes on a swipe down from the header and gives focus back", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.click(opener);

    drag(header(), 20, [40, 80, 140]);
    expect(shell().style.transform).toBe("translateY(100%)");
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("follows the finger and springs back from a short drag", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    vi.spyOn(shell(), "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 400, 393, 400),
    );

    drag(header(), 420, [440, 470], { lift: false });
    expect(shell().style.transform).toBe("translateY(50px)");
    // Held still before letting go: no flick, and short of the close distance.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    fireEvent.touchEnd(header(), {
      touches: [],
      changedTouches: [{ clientX: 100, clientY: 470 }],
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(shell().style.transform).toBe("");
  });

  it("leaves a drag in the content to scrolling", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const body = screen.getByText("Body");
    vi.spyOn(body, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 120, 300, 20),
    );

    drag(body, 200, [260, 340, 420]);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(shell().style.transform).toBe("");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("slides out before closing from the close button and Escape", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    fireEvent.click(screen.getByRole("button", { name: "Close modal" }));
    expect(shell().style.transform).toBe("translateY(100%)");
    // A second press while it slides does not close twice.
    fireEvent.keyDown(document, { key: "Escape" });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.keyDown(document, { key: "Escape" });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes at once without sliding when motion is reduced", () => {
    mockScreen({ reducedMotion: true });
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("comes back into view when the caller keeps it open", () => {
    render(
      <ModalBase isOpen onClose={vi.fn()} title="Saving">
        <p>Body</p>
      </ModalBase>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close modal" }));
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(shell().style.transform).toBe("translateY(100%)");
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(shell().style.transform).toBe("");
  });

  it("keeps the keyboard in the sheet's fields", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const field = screen.getByRole("textbox", { name: "Name" });
    field.focus();
    fireEvent.touchStart(header(), {
      touches: [{ clientX: 100, clientY: 10 }],
    });
    fireEvent.touchEnd(header(), { touches: [], changedTouches: [] });
    expect(field).toHaveFocus();
    expect(shell()).toBeInTheDocument();
  });
});

describe("sheetSettlesClosed", () => {
  it("closes past 30% of the height or on a downward flick", () => {
    expect(sheetSettlesClosed(100, 400, 0)).toBe(false);
    expect(sheetSettlesClosed(130, 400, 0)).toBe(true);
    expect(sheetSettlesClosed(20, 400, 0.8)).toBe(true);
    expect(sheetSettlesClosed(300, 400, -0.8)).toBe(false);
  });
});
