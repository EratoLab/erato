import { t } from "@lingui/core/macro";
import { useMemo } from "react";

import {
  componentRegistry,
  resolveComponentOverride,
} from "@/config/componentRegistry";

import type { EratoAppointmentCodeBlockProps } from "@/config/componentRegistry";

interface AppointmentSummary {
  subject: string;
  start: Date;
  end: Date;
  attendees: string[];
  location?: string;
}

const DATE_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit", // eslint-disable-line lingui/no-unlocalized-strings
  minute: "2-digit", // eslint-disable-line lingui/no-unlocalized-strings
};

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Mirrors the add-in's payload validation (`parseAppointmentDetails` in the
 * Outlook composition) so web and add-in agree on which fences are renderable:
 * parseable start/end and a positive duration.
 */
function parseAppointmentSummary(fenceBody: string): AppointmentSummary | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fenceBody.trim());
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const raw = parsed as Record<string, unknown>;
  if (typeof raw.start !== "string" || typeof raw.end !== "string") {
    return null;
  }
  const start = new Date(raw.start);
  const end = new Date(raw.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }
  if (end.getTime() <= start.getTime()) {
    return null;
  }

  const summary: AppointmentSummary = {
    subject: typeof raw.subject === "string" ? raw.subject : "",
    start,
    end,
    attendees: [
      ...toStringArray(raw.attendees),
      ...toStringArray(raw.optionalAttendees),
    ],
  };
  if (typeof raw.location === "string" && raw.location.trim() !== "") {
    summary.location = raw.location;
  }
  return summary;
}

function formatWhen(summary: AppointmentSummary): string {
  const startText = summary.start.toLocaleString(undefined, DATE_TIME_FORMAT);
  const sameDay = summary.start.toDateString() === summary.end.toDateString();
  const endText = sameDay
    ? summary.end.toLocaleTimeString(undefined, {
        hour: "2-digit", // eslint-disable-line lingui/no-unlocalized-strings
        minute: "2-digit", // eslint-disable-line lingui/no-unlocalized-strings
      })
    : summary.end.toLocaleString(undefined, DATE_TIME_FORMAT);
  return `${startText} – ${endText}`;
}

/**
 * Default fallback for erato-appointment code blocks when no host-specific
 * renderer is registered: a read-only summary card, so a chat produced by the
 * add-in's scheduling facet stays legible in the web app and on share links.
 * The Outlook add-in registers a richer renderer that adds the native
 * open-appointment action. While the fence is still streaming (or the model
 * emitted malformed JSON) the raw content renders as a muted block, matching
 * the add-in renderer's behavior.
 */
export function DefaultEratoAppointmentCodeBlock({
  content,
}: EratoAppointmentCodeBlockProps) {
  const summary = useMemo(() => parseAppointmentSummary(content), [content]);

  if (!summary) {
    return (
      <div className="my-2 whitespace-pre-wrap rounded-[var(--theme-radius-message)] border border-theme-border bg-theme-bg-secondary p-3 text-sm text-theme-fg-muted">
        {content}
      </div>
    );
  }

  const rows: { label: string; value: string }[] = [
    {
      label: t({ id: "chat.message.appointment.when", message: "When" }),
      value: formatWhen(summary),
    },
    ...(summary.location
      ? [
          {
            label: t({
              id: "chat.message.appointment.where",
              message: "Where",
            }),
            value: summary.location,
          },
        ]
      : []),
    ...(summary.attendees.length > 0
      ? [
          {
            label: t({
              id: "chat.message.appointment.attendees",
              message: "Attendees",
            }),
            value: summary.attendees.join(", "),
          },
        ]
      : []),
  ];

  return (
    <div className="my-2 rounded-[var(--theme-radius-message)] border border-theme-border bg-theme-bg-secondary p-3">
      <p className="text-xs uppercase tracking-wide text-theme-fg-muted">
        {t({
          id: "chat.message.appointment.suggested",
          message: "Suggested appointment",
        })}
      </p>
      {summary.subject ? (
        <p className="mt-1 text-sm font-medium text-theme-fg-primary">
          {summary.subject}
        </p>
      ) : null}
      <dl className="mt-2 space-y-1 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex gap-2">
            <dt className="shrink-0 text-theme-fg-muted">{row.label}</dt>
            <dd className="min-w-0 break-words text-theme-fg-secondary">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** erato-appointment fence renderer: the host override or the default card. */
export function EratoAppointmentBlock(props: EratoAppointmentCodeBlockProps) {
  const Renderer = resolveComponentOverride(
    componentRegistry.EratoAppointmentCodeBlock,
    DefaultEratoAppointmentCodeBlock,
  );
  return <Renderer {...props} />;
}
