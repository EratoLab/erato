import { t } from "@lingui/core/macro";
import { sanitize } from "lettersanitizer";
import PostalMime from "postal-mime";
import { useEffect, useId, useMemo, useState } from "react";

import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";
import { formatFileSize } from "@/components/ui/FileUpload/FilePreviewBase";
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  LoadingIcon,
  MailIcon,
  PageIcon,
} from "@/components/ui/icons";
import { createLogger } from "@/utils/debugLogger";

import { FilePreviewContent } from "./FilePreviewContent";

import type { Address, Attachment } from "postal-mime";

const logger = createLogger("UI", "EmlPreview");

interface ParsedAttachment {
  filename: string;
  mimeType: string;
  size: number;
  blobUrl: string;
}

interface ParsedEml {
  subject: string | null;
  from: string | null;
  to: string | null;
  cc: string | null;
  date: string | null;
  html: string;
  text: string;
  attachments: ParsedAttachment[];
  cidToBlobUrl: Map<string, string>;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; partial: PartialHeaders }
  | { kind: "ready"; parsed: ParsedEml };

interface PartialHeaders {
  subject: string | null;
  date: string | null;
}

function formatMailbox(m: { name?: string; address?: string }): string | null {
  const name = m.name?.trim();
  const address = m.address?.trim();
  if (name && address) return `${name} <${address}>`;
  if (address) return address;
  if (name) return name;
  return null;
}

function formatAddress(addr: Address | undefined): string | null {
  if (!addr) return null;
  if (addr.address !== undefined) return formatMailbox(addr);
  return (
    addr.group
      .map(formatMailbox)
      .filter((s): s is string => Boolean(s))
      .join(", ") || null
  );
}

function formatAddressList(addrs: Address[] | undefined): string | null {
  if (!addrs || addrs.length === 0) return null;
  const parts = addrs.map(formatAddress).filter((s): s is string => Boolean(s));
  return parts.length === 0 ? null : parts.join(", ");
}

// eslint-disable-next-line lingui/no-unlocalized-strings
const OCTET_STREAM = "application/octet-stream";

function attachmentBlob(attachment: Attachment): Blob {
  const { content, mimeType } = attachment;
  const type = mimeType.length > 0 ? mimeType : OCTET_STREAM;
  if (content instanceof ArrayBuffer) return new Blob([content], { type });
  if (content instanceof Uint8Array) {
    const copy = new Uint8Array(content.byteLength);
    copy.set(content);
    return new Blob([copy.buffer], { type });
  }
  if (typeof content === "string") {
    return new Blob([new TextEncoder().encode(content)], { type });
  }
  return new Blob([], { type });
}

function tryDecodeRaw(bytes: ArrayBuffer): PartialHeaders {
  try {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const headerBlock = text.split(/\r?\n\r?\n/, 1)[0] ?? "";
    const subject = matchHeader(headerBlock, "subject");
    const date = matchHeader(headerBlock, "date");
    return { subject, date };
  } catch {
    return { subject: null, date: null };
  }
}

function matchHeader(headerBlock: string, name: string): string | null {
  // eslint-disable-next-line lingui/no-unlocalized-strings
  const re = new RegExp(`^${name}:\\s*(.+(?:\\r?\\n[\\t ].+)*)`, "im");
  const match = re.exec(headerBlock);
  if (!match) return null;
  return match[1].replace(/\r?\n[\t ]+/g, " ").trim();
}

interface EmlPreviewProps {
  filename: string;
  url: string;
}

export const EmlPreview: React.FC<EmlPreviewProps> = ({ url }) => {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let aborted: boolean = false;
    const blobUrls: string[] = [];

    const load = async () => {
      let bytes: ArrayBuffer;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        bytes = await res.arrayBuffer();
      } catch (err) {
        logger.error("failed to fetch eml", err);
        if (!aborted)
          setState({ kind: "error", partial: { subject: null, date: null } });
        return;
      }

      try {
        const email = await PostalMime.parse(bytes);
        if (aborted) return;

        // Build attachments locally and only commit URLs into the shared
        // cleanup list once we know we're going to setState. If the effect
        // was torn down mid-parse, every URL we created here gets revoked
        // before we bail out.
        const localBlobUrls: string[] = [];
        const attachments: ParsedAttachment[] = [];
        const cidToBlobUrl = new Map<string, string>();
        for (const att of email.attachments) {
          // `aborted` is mutated by the effect cleanup, which TS flow can't
          // see from inside this async closure.
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (aborted) break;
          const blob = attachmentBlob(att);
          const objectUrl = URL.createObjectURL(blob);
          localBlobUrls.push(objectUrl);
          const trimmedName = att.filename?.trim();
          attachments.push({
            filename:
              trimmedName && trimmedName.length > 0
                ? trimmedName
                : t`attachment`,
            mimeType: att.mimeType.length > 0 ? att.mimeType : OCTET_STREAM,
            size: blob.size,
            blobUrl: objectUrl,
          });
          if (att.contentId !== undefined) {
            const cid = att.contentId.replace(/^<|>$/g, "");
            if (cid.length > 0) {
              if (cidToBlobUrl.has(cid)) {
                logger.log("duplicate Content-ID; last write wins", cid);
              }
              cidToBlobUrl.set(cid, objectUrl);
            }
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (aborted) {
          for (const u of localBlobUrls) URL.revokeObjectURL(u);
          return;
        }

        const trimmedSubject = email.subject?.trim();
        const subject =
          trimmedSubject && trimmedSubject.length > 0 ? trimmedSubject : null;
        const from = formatAddress(email.from);
        const to = formatAddressList(email.to);
        const cc = formatAddressList(email.cc);
        const html = email.html ?? "";
        const text = email.text ?? "";

        // postal-mime is permissive: it returns an empty envelope rather than
        // throwing on garbage bytes. If nothing of substance came out, drop
        // into the malformed-MIME fallback so the user sees an explicit
        // error instead of a blank preview.
        const looksEmpty =
          !subject &&
          !from &&
          to === null &&
          cc === null &&
          !html &&
          !text &&
          attachments.length === 0;
        if (looksEmpty) {
          for (const u of localBlobUrls) URL.revokeObjectURL(u);
          setState({ kind: "error", partial: tryDecodeRaw(bytes) });
          return;
        }

        blobUrls.push(...localBlobUrls);
        setState({
          kind: "ready",
          parsed: {
            subject,
            from,
            to,
            cc,
            date: email.date ?? null,
            html,
            text,
            attachments,
            cidToBlobUrl,
          },
        });
      } catch (err) {
        logger.warn("postal-mime failed; falling back to header-only", err);
        if (!aborted) setState({ kind: "error", partial: tryDecodeRaw(bytes) });
      }
    };

    void load();

    return () => {
      aborted = true;
      for (const objectUrl of blobUrls) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  if (state.kind === "loading") {
    return (
      <div
        className="flex items-center justify-center py-12"
        aria-live="polite"
        aria-busy="true"
        data-testid="eml-preview-loading"
      >
        <LoadingIcon className="size-6 animate-spin text-[var(--theme-fg-muted)]" />
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div data-testid="eml-preview-error">
        <EmlHeader
          subject={state.partial.subject}
          from={null}
          to={null}
          cc={null}
          date={state.partial.date}
        />
        <Alert type="warning" className="mt-4">
          {t`Preview unavailable: this email could not be parsed.`}
        </Alert>
      </div>
    );
  }

  if (isThreadShape(state.parsed)) {
    return <EmlThreadBody parsed={state.parsed} />;
  }
  return <EmlPreviewBody parsed={state.parsed} />;
};

/**
 * A `.eml` is a thread bundle (per `synthesizeThreadEml` in the office-addin)
 * when the outer body is empty and at least one attachment is itself a
 * `message/rfc822` part. Standalone forwards with an `.eml` attachment still
 * have a non-empty outer body, so they fall through to the normal preview.
 */
function isThreadShape(parsed: ParsedEml): boolean {
  if (parsed.html.length > 0 || parsed.text.length > 0) return false;
  return parsed.attachments.some((attachment) =>
    attachment.mimeType.toLowerCase().includes("message/rfc822"),
  );
}

const EmlPreviewBody: React.FC<{
  parsed: ParsedEml;
}> = ({ parsed }) => {
  const [selected, setSelected] = useState<ParsedAttachment | null>(null);

  // Pre-sanitize the HTML body up here so the iframe's `srcDoc` is rendered
  // with `sandbox` already set on the element in JSX — applying sandbox in a
  // post-mount effect would leave a window where the unsandboxed iframe has
  // already begun parsing/executing the email HTML.
  //
  // The iframe runs in a *null-origin* sandbox (`sandbox=""` — no flags).
  // No scripts, no same-origin access to the parent, no form submission, no
  // top-level navigation. A sanitizer bypass therefore cannot read cookies
  // or LocalStorage. The cost: we can't measure `contentDocument` to
  // auto-resize, so the iframe gets a fixed CSS height with internal scroll.
  const sanitizedHtml = useMemo(() => {
    if (!parsed.html) return "";
    return sanitize(parsed.html, parsed.text || undefined, {
      rewriteExternalResources: (url) => {
        if (!url.startsWith("cid:")) return url;
        const cid = url.slice(4).replace(/^<|>$/g, "");
        return parsed.cidToBlobUrl.get(cid) ?? url;
      },
    });
  }, [parsed.html, parsed.text, parsed.cidToBlobUrl]);

  return (
    <div data-testid="eml-preview" className="flex flex-col gap-4">
      <EmlHeader
        subject={parsed.subject}
        from={parsed.from}
        to={parsed.to}
        cc={parsed.cc}
        date={parsed.date}
      />
      {selected ? (
        <div
          data-testid="eml-attachment-preview"
          className="flex flex-col gap-3"
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={<ArrowLeftIcon className="size-4" aria-hidden="true" />}
            onClick={() => setSelected(null)}
            className="w-fit"
          >
            {t`Back to email`}
          </Button>
          <div className="truncate text-sm text-[var(--theme-fg-muted)]">
            {selected.filename}
          </div>
          <FilePreviewContent
            filename={selected.filename}
            url={selected.blobUrl}
            mimeType={selected.mimeType}
          />
        </div>
      ) : (
        <>
          {parsed.html ? (
            <iframe
              data-testid="eml-preview-html"
              title={parsed.subject ?? t`Email preview`}
              sandbox=""
              srcDoc={sanitizedHtml}
              className="h-[60vh] w-full rounded border border-[var(--theme-border-attachment)] bg-white"
            />
          ) : (
            <pre
              data-testid="eml-preview-text"
              className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded border border-[var(--theme-border-attachment)] bg-[var(--theme-bg-accent)] p-3 text-sm text-[var(--theme-fg-primary)]"
            >
              {parsed.text || t`(no body)`}
            </pre>
          )}
          {parsed.attachments.length > 0 && (
            <EmlAttachmentList
              attachments={parsed.attachments}
              onSelect={setSelected}
            />
          )}
        </>
      )}
    </div>
  );
};

interface ThreadMessage {
  /** Stable per-thread identifier: parsed Message-ID when available, else a content-derived fallback. */
  id: string;
  subject: string | null;
  from: string | null;
  date: string | null;
  html: string;
  text: string;
  attachments: ParsedAttachment[];
  cidToBlobUrl: Map<string, string>;
}

const EmlThreadBody: React.FC<{ parsed: ParsedEml }> = ({ parsed }) => {
  const [messages, setMessages] = useState<ThreadMessage[] | null>(null);
  const [selected, setSelected] = useState<ParsedAttachment | null>(null);

  useEffect(() => {
    let aborted = false;
    const blobUrls: string[] = [];

    const parseNested = async () => {
      const out: ThreadMessage[] = [];
      const nestedAttachments = parsed.attachments.filter((attachment) =>
        attachment.mimeType.toLowerCase().includes("message/rfc822"),
      );
      for (const attachment of nestedAttachments) {
        try {
          const response = await fetch(attachment.blobUrl);
          const bytes = await response.arrayBuffer();
          const message = await PostalMime.parse(bytes);
          if (aborted) return;
          const cidToBlobUrl = new Map<string, string>();
          const childAttachments: ParsedAttachment[] = [];
          for (const child of message.attachments) {
            const blob = attachmentBlob(child);
            const childUrl = URL.createObjectURL(blob);
            blobUrls.push(childUrl);
            const trimmedName = child.filename?.trim();
            childAttachments.push({
              filename:
                trimmedName && trimmedName.length > 0
                  ? trimmedName
                  : t`attachment`,
              mimeType:
                child.mimeType.length > 0 ? child.mimeType : OCTET_STREAM,
              size: blob.size,
              blobUrl: childUrl,
            });
            if (child.contentId !== undefined) {
              const cid = child.contentId.replace(/^<|>$/g, "");
              if (cid.length > 0) cidToBlobUrl.set(cid, childUrl);
            }
          }
          const fallbackId = `thread-msg-${out.length}-${(message.subject ?? "").slice(0, 32)}`;
          out.push({
            id: message.messageId ?? fallbackId,
            subject: nullIfEmpty(message.subject),
            from: formatAddress(message.from),
            date: message.date ?? null,
            html: message.html ?? "",
            text: message.text ?? "",
            attachments: childAttachments,
            cidToBlobUrl,
          });
        } catch (error) {
          logger.warn("postal-mime failed to parse nested message", error);
        }
      }
      if (aborted) return;
      setMessages(out);
    };

    void parseNested();
    return () => {
      aborted = true;
      for (const objectUrl of blobUrls) URL.revokeObjectURL(objectUrl);
    };
  }, [parsed.attachments]);

  if (messages === null) {
    return (
      <div
        className="flex items-center justify-center py-12"
        aria-live="polite"
        aria-busy="true"
        data-testid="eml-thread-loading"
      >
        <LoadingIcon className="size-6 animate-spin text-[var(--theme-fg-muted)]" />
      </div>
    );
  }

  if (selected) {
    return (
      <div data-testid="eml-thread" className="flex flex-col gap-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={<ArrowLeftIcon className="size-4" aria-hidden="true" />}
          onClick={() => setSelected(null)}
          className="w-fit"
        >
          {t`Back to thread`}
        </Button>
        <div className="truncate text-sm text-[var(--theme-fg-muted)]">
          {selected.filename}
        </div>
        <FilePreviewContent
          filename={selected.filename}
          url={selected.blobUrl}
          mimeType={selected.mimeType}
        />
      </div>
    );
  }

  return (
    <div data-testid="eml-thread" className="flex flex-col gap-3">
      <EmlHeader
        subject={parsed.subject}
        from={null}
        to={null}
        cc={null}
        date={null}
      />
      <div className="flex flex-col gap-2">
        {messages.map((message, index) => (
          <ThreadMessageSection
            key={message.id}
            message={message}
            defaultExpanded={index === messages.length - 1}
            onSelectAttachment={setSelected}
            panelId={`eml-thread-panel-${message.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`}
          />
        ))}
      </div>
    </div>
  );
};

const ThreadMessageSection: React.FC<{
  message: ThreadMessage;
  defaultExpanded: boolean;
  onSelectAttachment: (attachment: ParsedAttachment) => void;
  panelId: string;
}> = ({ message, defaultExpanded, onSelectAttachment, panelId }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  // Sanitised HTML body for the iframe `srcDoc`. The iframe is rendered
  // with `sandbox=""` (null origin, no scripts, no same-origin) — see the
  // matching note on `EmlPreviewBody`.
  const sanitizedHtml = useMemo(() => {
    if (!message.html) return "";
    return sanitize(message.html, message.text || undefined, {
      rewriteExternalResources: (url) => {
        if (!url.startsWith("cid:")) return url;
        const cid = url.slice(4).replace(/^<|>$/g, "");
        return message.cidToBlobUrl.get(cid) ?? url;
      },
    });
  }, [message.html, message.text, message.cidToBlobUrl]);

  return (
    <div
      data-testid="eml-thread-message"
      className="rounded border border-[var(--theme-border-attachment)] bg-[var(--theme-bg-primary)]"
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-start gap-2 p-3 text-left"
        aria-expanded={expanded}
        aria-controls={panelId}
      >
        <span
          className="mt-0.5 inline-flex shrink-0 items-center text-[var(--theme-fg-muted)]"
          aria-hidden="true"
        >
          {expanded ? (
            <ChevronDownIcon className="size-4" />
          ) : (
            <ChevronRightIcon className="size-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[var(--theme-fg-primary)]">
            {message.from ?? t`Unknown sender`}
          </p>
          <p className="truncate text-xs text-[var(--theme-fg-muted)]">
            {[message.date, message.subject]
              .filter((part): part is string => Boolean(part))
              .join(" · ")}
          </p>
        </div>
        {message.attachments.length > 0 && (
          <span className="shrink-0 text-xs text-[var(--theme-fg-muted)]">
            {message.attachments.length === 1
              ? t`1 file`
              : t`${message.attachments.length} files`}
          </span>
        )}
      </button>
      {expanded && (
        <div
          id={panelId}
          role="region"
          className="flex flex-col gap-3 px-3 pb-3"
        >
          {message.html ? (
            <iframe
              data-testid="eml-thread-message-html"
              title={message.subject ?? t`Email`}
              sandbox=""
              srcDoc={sanitizedHtml}
              className="h-[40vh] w-full rounded border border-[var(--theme-border-attachment)] bg-white"
            />
          ) : message.text ? (
            <pre
              data-testid="eml-thread-message-text"
              className="max-h-[40vh] overflow-auto whitespace-pre-wrap rounded border border-[var(--theme-border-attachment)] bg-[var(--theme-bg-accent)] p-3 text-sm text-[var(--theme-fg-primary)]"
            >
              {message.text}
            </pre>
          ) : null}
          {message.attachments.length > 0 && (
            <EmlAttachmentList
              attachments={message.attachments}
              onSelect={onSelectAttachment}
            />
          )}
        </div>
      )}
    </div>
  );
};

function nullIfEmpty(value: string | undefined): string | null {
  if (value === undefined) return null;
  return value.trim().length === 0 ? null : value;
}

const EmlHeader: React.FC<{
  subject: string | null;
  from: string | null;
  to: string | null;
  cc: string | null;
  date: string | null;
}> = ({ subject, from, to, cc, date }) => {
  return (
    <div className="flex items-start gap-3 rounded border border-[var(--theme-border-attachment)] bg-[var(--theme-bg-primary)] p-3">
      <div className="mt-0.5 shrink-0 text-[var(--theme-fg-muted)]">
        <MailIcon className="size-5" aria-hidden="true" />
      </div>
      <dl className="grid min-w-0 flex-1 grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
        {subject && (
          <>
            <dt className="font-medium text-[var(--theme-fg-muted)]">{t`Subject`}</dt>
            <dd className="truncate font-medium text-[var(--theme-fg-primary)]">
              {subject}
            </dd>
          </>
        )}
        {from && (
          <>
            <dt className="font-medium text-[var(--theme-fg-muted)]">{t`From`}</dt>
            <dd className="truncate text-[var(--theme-fg-primary)]">{from}</dd>
          </>
        )}
        {to && (
          <>
            <dt className="font-medium text-[var(--theme-fg-muted)]">{t`To`}</dt>
            <dd className="truncate text-[var(--theme-fg-primary)]">{to}</dd>
          </>
        )}
        {cc && (
          <>
            <dt className="font-medium text-[var(--theme-fg-muted)]">{t`Cc`}</dt>
            <dd className="truncate text-[var(--theme-fg-primary)]">{cc}</dd>
          </>
        )}
        {date && (
          <>
            <dt className="font-medium text-[var(--theme-fg-muted)]">{t`Date`}</dt>
            <dd className="truncate text-[var(--theme-fg-primary)]">{date}</dd>
          </>
        )}
      </dl>
    </div>
  );
};

const EmlAttachmentList: React.FC<{
  attachments: ParsedAttachment[];
  onSelect: (attachment: ParsedAttachment) => void;
}> = ({ attachments, onSelect }) => {
  return (
    <ul
      data-testid="eml-preview-attachments"
      className="flex flex-wrap gap-2"
      aria-label={t`Attachments`}
    >
      {attachments.map((att, index) => (
        <li key={`${att.filename}-${index}`} className="min-w-0">
          <button
            type="button"
            onClick={() => onSelect(att)}
            title={att.filename}
            className="flex min-w-0 items-center gap-2 rounded-xl border border-[var(--theme-border-attachment)] bg-[var(--theme-bg-primary)] px-3 py-2 text-left shadow-sm transition-colors hover:bg-[var(--theme-bg-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-fg-accent)]"
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--theme-bg-accent)] text-[var(--theme-fg-secondary)]">
              <PageIcon className="size-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-[var(--theme-fg-primary)]">
                {att.filename}
              </div>
              <div className="truncate text-xs text-[var(--theme-fg-muted)]">
                {att.mimeType}
                {att.size > 0 ? ` • ${formatFileSize(att.size)}` : ""}
              </div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
};

// eslint-disable-next-line lingui/no-unlocalized-strings
EmlPreview.displayName = "EmlPreview";
