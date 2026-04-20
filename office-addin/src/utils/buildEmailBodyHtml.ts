import { escapeHtml } from "./htmlConvert";
import { EMAIL_BODY_CSP, sanitizeEmailHtml } from "./sanitizeEmailHtml";

export interface EmailAddressInput {
  name?: string;
  address?: string;
}

export interface EmailBodyInput {
  subject: string;
  from?: EmailAddressInput | null;
  to?: EmailAddressInput[] | null;
  cc?: EmailAddressInput[] | null;
  date?: Date | null;
  bodyHtml?: string | null;
  bodyText?: string | null;
}

export function buildEmailBodyFile(input: EmailBodyInput): File {
  const subject = input.subject?.trim() ? input.subject : "(no subject)";
  const filename = `${sanitizeFilename(subject)}.html`;

  const headerRows: string[] = [];
  const fromAddress = formatAddress(input.from);
  if (fromAddress) {
    headerRows.push(`<strong>From:</strong> ${escapeHtml(fromAddress)}`);
  }
  const toAddresses = formatAddressList(input.to);
  if (toAddresses) {
    headerRows.push(`<strong>To:</strong> ${escapeHtml(toAddresses)}`);
  }
  const ccAddresses = formatAddressList(input.cc);
  if (ccAddresses) {
    headerRows.push(`<strong>CC:</strong> ${escapeHtml(ccAddresses)}`);
  }
  if (input.date && !isNaN(input.date.getTime())) {
    headerRows.push(
      `<strong>Date:</strong> ${escapeHtml(input.date.toLocaleString())}`,
    );
  }
  headerRows.push(`<strong>Subject:</strong> ${escapeHtml(subject)}`);

  const body = input.bodyHtml
    ? sanitizeEmailHtml(input.bodyHtml)
    : input.bodyText
      ? `<pre>${escapeHtml(input.bodyText)}</pre>`
      : "";

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${EMAIL_BODY_CSP}"><base target="_blank"><title>${escapeHtml(subject)}</title></head>
<body>
<div style="font-family:sans-serif;font-size:13px;color:#333;border-bottom:1px solid #ccc;padding-bottom:8px;margin-bottom:16px">
  ${headerRows.join("<br>")}
</div>
${body}
</body></html>`;

  return new File([html], filename, { type: "text/html" });
}

function formatAddress(address: EmailAddressInput | null | undefined): string {
  if (!address?.address) {
    return "";
  }
  const { name, address: addr } = address;
  return name && name !== addr ? `${name} <${addr}>` : addr;
}

function formatAddressList(
  addresses: EmailAddressInput[] | null | undefined,
): string {
  if (!addresses || addresses.length === 0) {
    return "";
  }
  return addresses
    .map(formatAddress)
    .filter((entry) => entry.length > 0)
    .join(", ");
}

function sanitizeFilename(name: string): string {
  const base = name.trim() || "email";
  return Array.from(base)
    .map((character) => {
      if ('<>:"/\\|?*'.includes(character)) {
        return "_";
      }
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 ? "_" : character;
    })
    .join("")
    .slice(0, 100);
}
