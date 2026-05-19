import { t } from "@lingui/core/macro";
import PostalMime from "postal-mime";
import { useEffect, useMemo, useRef, useState } from "react";
import { Letter } from "react-letter";

import { Alert } from "@/components/ui/Feedback/Alert";
import { formatFileSize } from "@/components/ui/FileUpload/FilePreviewBase";
import { LoadingIcon, MailIcon, PageIcon } from "@/components/ui/icons";
import { createLogger } from "@/utils/debugLogger";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
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
  const parts = addrs
    .map(formatAddress)
    .filter((s): s is string => Boolean(s));
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
  file: Pick<FileUploadItem, "id" | "filename" | "download_url">;
}

export const EmlPreview: React.FC<EmlPreviewProps> = ({ file }) => {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const downloadUrl = file.download_url;

  useEffect(() => {
    let aborted = false;
    const blobUrls: string[] = [];

    const load = async () => {
      let bytes: ArrayBuffer;
      try {
        const res = await fetch(downloadUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        bytes = await res.arrayBuffer();
      } catch (err) {
        logger.error("failed to fetch eml", err);
        if (!aborted) setState({ kind: "error", partial: { subject: null, date: null } });
        return;
      }

      try {
        const email = await PostalMime.parse(bytes);
        if (aborted) return;

        const attachments: ParsedAttachment[] = [];
        const cidToBlobUrl = new Map<string, string>();
        for (const att of email.attachments) {
          const blob = attachmentBlob(att);
          const url = URL.createObjectURL(blob);
          blobUrls.push(url);
          const trimmedName = att.filename?.trim();
          attachments.push({
            filename: trimmedName && trimmedName.length > 0
              ? trimmedName
              : t`attachment`,
            mimeType: att.mimeType.length > 0 ? att.mimeType : OCTET_STREAM,
            size: blob.size,
            blobUrl: url,
          });
          if (att.contentId !== undefined) {
            const cid = att.contentId.replace(/^<|>$/g, "");
            if (cid.length > 0) cidToBlobUrl.set(cid, url);
          }
        }

        const trimmedSubject = email.subject?.trim();
        setState({
          kind: "ready",
          parsed: {
            subject:
              trimmedSubject && trimmedSubject.length > 0
                ? trimmedSubject
                : null,
            from: formatAddress(email.from),
            to: formatAddressList(email.to),
            cc: formatAddressList(email.cc),
            date: email.date ?? null,
            html: email.html ?? "",
            text: email.text ?? "",
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
      for (const url of blobUrls) URL.revokeObjectURL(url);
    };
  }, [downloadUrl]);

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

  return <EmlPreviewBody parsed={state.parsed} />;
};

const EmlPreviewBody: React.FC<{
  parsed: ParsedEml;
}> = ({ parsed }) => {
  const iframeWrapperRef = useRef<HTMLDivElement>(null);

  const rewriteResources = useMemo(
    () => (url: string) => {
      if (!url.startsWith("cid:")) return url;
      const cid = url.slice(4).replace(/^<|>$/g, "");
      return parsed.cidToBlobUrl.get(cid) ?? url;
    },
    [parsed.cidToBlobUrl],
  );

  useEffect(() => {
    const iframe = iframeWrapperRef.current?.querySelector("iframe");
    if (!iframe) return;
    iframe.setAttribute("sandbox", "allow-same-origin");
    iframe.classList.add(
      "w-full",
      "rounded",
      "border",
      "border-[var(--theme-border-attachment)]",
      "bg-white",
    );

    const resize = () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc) return;
        const measured = Math.max(
          doc.body.scrollHeight,
          doc.documentElement.scrollHeight,
        );
        if (measured > 0) {
          const cap = window.innerHeight * 0.7;
          iframe.style.height = `${Math.min(measured + 8, cap)}px`;
        }
      } catch {
        // Same-origin should make contentDocument accessible; if anything
        // goes sideways, leave the iframe at the browser default height.
      }
    };

    iframe.addEventListener("load", resize);
    if (iframe.contentDocument?.readyState === "complete") resize();
    return () => iframe.removeEventListener("load", resize);
  }, [parsed.html, parsed.text]);

  return (
    <div data-testid="eml-preview" className="flex flex-col gap-4">
      <EmlHeader
        subject={parsed.subject}
        from={parsed.from}
        to={parsed.to}
        cc={parsed.cc}
        date={parsed.date}
      />
      {parsed.html ? (
        <div ref={iframeWrapperRef} data-testid="eml-preview-html">
          <Letter
            html={parsed.html}
            text={parsed.text || undefined}
            useIframe={true}
            iframeTitle={parsed.subject ?? t`Email preview`}
            rewriteExternalResources={rewriteResources}
          />
        </div>
      ) : (
        <pre
          data-testid="eml-preview-text"
          className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded border border-[var(--theme-border-attachment)] bg-[var(--theme-bg-accent)] p-3 text-sm text-[var(--theme-fg-primary)]"
        >
          {parsed.text || t`(no body)`}
        </pre>
      )}
      {parsed.attachments.length > 0 && (
        <EmlAttachmentList attachments={parsed.attachments} />
      )}
    </div>
  );
};

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
        <MailIcon className="size-5" />
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

const EmlAttachmentList: React.FC<{ attachments: ParsedAttachment[] }> = ({
  attachments,
}) => {
  return (
    <ul
      data-testid="eml-preview-attachments"
      className="flex flex-wrap gap-2"
      aria-label={t`Attachments`}
    >
      {attachments.map((att, index) => (
        <li key={`${att.filename}-${index}`} className="min-w-0">
          <a
            href={att.blobUrl}
            download={att.filename}
            target="_blank"
            rel="noopener noreferrer"
            title={att.filename}
            className="flex min-w-0 items-center gap-2 rounded-xl border border-[var(--theme-border-attachment)] bg-[var(--theme-bg-primary)] px-3 py-2 shadow-sm transition-colors hover:bg-[var(--theme-bg-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-fg-accent)]"
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--theme-bg-accent)] text-[var(--theme-fg-secondary)]">
              <PageIcon className="size-4" />
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
          </a>
        </li>
      ))}
    </ul>
  );
};

// eslint-disable-next-line lingui/no-unlocalized-strings
EmlPreview.displayName = "EmlPreview";
