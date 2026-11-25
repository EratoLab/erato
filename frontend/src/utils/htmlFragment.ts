// Element tags model-produced HTML fragments reliably contain. Deliberately
// narrow: plain German business text with `<Name>`, `<mail@firma.de>` or
// `<30 T€` must not match.
const HTML_FRAGMENT_TAG_RE =
  /<\/?(?:p|br|div|span|a|ul|ol|li|blockquote|h[1-6]|b|i|em|strong|u|s|table|thead|tbody|tr|td|th|pre|code|hr|img)(?:\s[^<>]*)?\/?>/i;

/** Whether a draft is HTML: the card that shows it and the host that writes it must agree. */
export function looksLikeHtmlFragment(text: string): boolean {
  return HTML_FRAGMENT_TAG_RE.test(text);
}
