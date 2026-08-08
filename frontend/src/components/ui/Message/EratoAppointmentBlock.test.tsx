import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import { componentRegistry } from "@/config/componentRegistry";
import { messages as enMessages } from "@/locales/en/messages.json";

import {
  DefaultEratoAppointmentCodeBlock,
  EratoAppointmentBlock,
} from "./EratoAppointmentBlock";

import type { EratoAppointmentCodeBlockProps } from "@/config/componentRegistry";
import type { Messages } from "@lingui/core";

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

const renderBlock = (ui: React.ReactElement) =>
  render(<I18nProvider i18n={i18n}>{ui}</I18nProvider>);

const VALID_PAYLOAD = JSON.stringify({
  start: "2026-07-09T10:00:00+02:00",
  end: "2026-07-09T11:00:00+02:00",
  subject: "Quarterly sync",
  attendees: ["ada@example.com"],
  optionalAttendees: ["grace@example.com"],
  location: "Room 4",
});

describe("DefaultEratoAppointmentCodeBlock", () => {
  it("renders a read-only summary card for a valid payload", () => {
    renderBlock(<DefaultEratoAppointmentCodeBlock content={VALID_PAYLOAD} />);

    expect(screen.getByText("Suggested appointment")).toBeInTheDocument();
    expect(screen.getByText("Quarterly sync")).toBeInTheDocument();
    expect(screen.getByText("Room 4")).toBeInTheDocument();
    expect(
      screen.getByText("ada@example.com, grace@example.com"),
    ).toBeInTheDocument();
    expect(screen.getByText("When")).toBeInTheDocument();
  });

  it("shows the raw payload muted when it does not parse", () => {
    renderBlock(
      <DefaultEratoAppointmentCodeBlock content={'{"start":"2026-07-'} />,
    );

    expect(screen.getByText(/"start"/)).toBeInTheDocument();
    expect(screen.queryByText("Suggested appointment")).toBeNull();
  });

  it("rejects an inverted time range", () => {
    const inverted = JSON.stringify({
      start: "2026-07-09T11:00:00+02:00",
      end: "2026-07-09T10:00:00+02:00",
    });
    renderBlock(<DefaultEratoAppointmentCodeBlock content={inverted} />);

    expect(screen.queryByText("Suggested appointment")).toBeNull();
  });
});

describe("EratoAppointmentBlock", () => {
  it("prefers a registered host renderer over the default card", () => {
    const original = componentRegistry.EratoAppointmentCodeBlock;
    function HostAppointmentBlock({ content }: EratoAppointmentCodeBlockProps) {
      return <div data-testid="host-appointment-block">{content}</div>;
    }
    componentRegistry.EratoAppointmentCodeBlock = HostAppointmentBlock;
    try {
      renderBlock(<EratoAppointmentBlock content={VALID_PAYLOAD} />);

      expect(screen.getByTestId("host-appointment-block")).toBeInTheDocument();
      expect(screen.queryByText("Suggested appointment")).toBeNull();
    } finally {
      componentRegistry.EratoAppointmentCodeBlock = original;
    }
  });
});
