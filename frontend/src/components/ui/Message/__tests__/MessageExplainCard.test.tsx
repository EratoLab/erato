import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { MESSAGE_EXPLAIN_MAX_FOLLOW_UPS } from "@/hooks/chat/store/messageExplainStore";
import { messages as enMessages } from "@/locales/en/messages.json";

import { MessageExplainCardView } from "../MessageExplainCard";

import type {
  MessageExplainCardState,
  MessageExplainTurnState,
} from "@/hooks/chat/store/messageExplainStore";
import type { Messages } from "@lingui/core";

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

const turn = (
  id: number,
  patch: Partial<MessageExplainTurnState> = {},
): MessageExplainTurnState => ({
  id,
  question: null,
  answer: "",
  status: "done",
  ...patch,
});

const cardWith = (
  turns: MessageExplainTurnState[],
): MessageExplainCardState => ({
  messageId: "m1",
  passage: "Committed-use discounts",
  anchor: { startBlock: "0:0", startOffset: 0, endBlock: "0:0", endOffset: 23 },
  turns,
});

const answered = cardWith([
  turn(1, { answer: "A deal with the provider." }),
  turn(2, {
    question: "What if we need less?",
    answer: "You still pay for all of it.",
  }),
]);

const renderCard = (
  card: MessageExplainCardState,
  props: Partial<Parameters<typeof MessageExplainCardView>[0]> = {},
) => {
  const handlers = { onAsk: vi.fn(), onRetry: vi.fn(), onClose: vi.fn() };
  render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider enableCustomTheme={false}>
        <article data-ui="message-content">
          <MessageExplainCardView
            card={card}
            renderAnswer={(text, isStreaming) => (
              <p data-testid="answer" data-streaming={isStreaming}>
                {text}
              </p>
            )}
            {...handlers}
            {...props}
          />
        </article>
      </ThemeProvider>
    </I18nProvider>,
  );
  return handlers;
};

const followUpField = () =>
  screen.getByRole("textbox", { name: "Ask a follow-up question" });
const sendButton = () => screen.getByRole("button", { name: "Send" });

describe("MessageExplainCardView", () => {
  it("is a card marked as not saved, named after the passage", () => {
    renderCard(answered);

    const card = screen.getByRole("group", {
      name: "Explain: Committed-use discounts",
    });
    expect(card).toHaveAttribute("data-ui", "message-explain");
    expect(card).toHaveAttribute("data-variant", "surface");
    const header = card.querySelector('[data-ui="card-header"]')!;
    expect(within(header as HTMLElement).getByText("Explain")).toBeVisible();
    expect(header.querySelector('[data-ui="status-pill"]')).toHaveTextContent(
      "Not saved",
    );
    expect(
      within(header as HTMLElement).getByRole("button", { name: "Close" }),
    ).toBeVisible();
    expect(card.querySelector('[data-ui="card-footer"]')).toContainElement(
      followUpField(),
    );
  });

  it("shows the loading line until the first words arrive", () => {
    renderCard(cardWith([turn(1, { status: "loading" })]));

    expect(screen.getByText("Loading")).toBeVisible();
    expect(screen.queryByTestId("answer")).not.toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
  });

  it("streams the answer and keeps Send off until it is complete", () => {
    renderCard(
      cardWith([turn(1, { status: "streaming", answer: "A deal with" })]),
    );

    expect(screen.getByTestId("answer")).toHaveTextContent("A deal with");
    expect(screen.getByTestId("answer")).toHaveAttribute(
      "data-streaming",
      "true",
    );
    fireEvent.change(followUpField(), { target: { value: "And then?" } });
    expect(followUpField()).toBeEnabled();
    expect(sendButton()).toBeDisabled();
  });

  it("shows a follow-up as a plain line above its answer", () => {
    renderCard(answered);

    const turns = document.querySelectorAll('[data-ui="message-explain-turn"]');
    expect(turns).toHaveLength(2);
    expect(turns[1].firstElementChild).toHaveTextContent(
      "What if we need less?",
    );
    expect(turns[1].lastElementChild).toHaveTextContent(
      "You still pay for all of it.",
    );
    expect(screen.getAllByTestId("answer")[1]).toHaveAttribute(
      "data-streaming",
      "false",
    );
  });

  it("asks the typed follow-up on Send and on Enter, and clears the field", () => {
    const { onAsk } = renderCard(answered);
    expect(sendButton()).toBeDisabled();

    fireEvent.change(followUpField(), {
      target: { value: "Why three years?" },
    });
    fireEvent.click(sendButton());
    expect(onAsk).toHaveBeenLastCalledWith("Why three years?");
    expect(followUpField()).toHaveValue("");

    fireEvent.change(followUpField(), { target: { value: "And one year?" } });
    fireEvent.submit(followUpField().closest("form")!);
    expect(onAsk).toHaveBeenLastCalledWith("And one year?");
  });

  it("shows an error with Try again and keeps the field off", () => {
    const { onRetry } = renderCard(cardWith([turn(1, { status: "error" })]));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-tone", "error");
    expect(alert).toHaveTextContent("The explanation could not be loaded.");
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(followUpField()).toBeDisabled();
    expect(sendButton()).toBeDisabled();
  });

  it("keeps what arrived of a follow-up answer above its error", () => {
    renderCard(
      cardWith([
        turn(1, { answer: "A deal." }),
        turn(2, { question: "Why?", answer: "Because", status: "error" }),
      ]),
    );

    expect(screen.getAllByTestId("answer")[1]).toHaveTextContent("Because");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The answer could not be loaded.",
    );
  });

  it("takes no more questions after the follow-up limit", () => {
    renderCard(
      cardWith([
        turn(1, { answer: "A deal." }),
        ...Array.from({ length: MESSAGE_EXPLAIN_MAX_FOLLOW_UPS }, (_, index) =>
          turn(index + 2, { question: `Q${index}`, answer: `A${index}` }),
        ),
      ]),
    );

    expect(
      screen.getByRole("textbox", { name: "No more follow-up questions here" }),
    ).toBeDisabled();
  });

  it("closes on the X and on Escape, and returns focus to the message text", () => {
    const { onClose } = renderCard(answered);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    followUpField().focus();
    fireEvent.keyDown(followUpField(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[data-ui="message-content"]')).toHaveFocus();
  });

  it("takes focus when it was just opened, and not otherwise", () => {
    renderCard(answered, { shouldFocusOnMount: () => true });
    expect(followUpField()).toHaveFocus();
  });
});
