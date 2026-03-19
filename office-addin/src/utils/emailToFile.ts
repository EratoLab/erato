import type { OutlookMailItemData } from "../providers/OutlookMailItemProvider";

interface EmailAddress {
  displayName: string;
  emailAddress: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatAddress(address: EmailAddress): string {
  if (address.displayName && address.displayName !== address.emailAddress) {
    return `${address.displayName} <${address.emailAddress}>`;
  }

  return address.emailAddress;
}

function sanitizeFilename(name: string | undefined): string {
  const base = (name || "email").trim();
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

export function emailToHtmlFile(mailItem: OutlookMailItemData): File {
  const headerRows: string[] = [];

  if (mailItem.from) {
    headerRows.push(
      `<strong>From:</strong> ${escapeHtml(formatAddress(mailItem.from))}`,
    );
  }

  if (mailItem.to.length > 0) {
    headerRows.push(
      `<strong>To:</strong> ${escapeHtml(mailItem.to.map(formatAddress).join(", "))}`,
    );
  }

  if (mailItem.cc.length > 0) {
    headerRows.push(
      `<strong>CC:</strong> ${escapeHtml(mailItem.cc.map(formatAddress).join(", "))}`,
    );
  }

  if (mailItem.dateTimeCreated) {
    headerRows.push(
      `<strong>Date:</strong> ${escapeHtml(mailItem.dateTimeCreated.toLocaleString())}`,
    );
  }

  headerRows.push(
    `<strong>Subject:</strong> ${escapeHtml(mailItem.subject || "(no subject)")}`,
  );

  const body =
    mailItem.bodyHtml ?? `<pre>${escapeHtml(mailItem.bodyText ?? "")}</pre>`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(mailItem.subject || "(no subject)")}</title></head>
<body>
<div style="font-family:sans-serif;font-size:13px;color:#333;border-bottom:1px solid #ccc;padding-bottom:8px;margin-bottom:16px">
  ${headerRows.join("<br>")}
</div>
${body}
</body></html>`;

  return new File([html], `${sanitizeFilename(mailItem.subject)}.html`, {
    type: "text/html",
  });
}
