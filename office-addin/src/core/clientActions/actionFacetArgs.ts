/** The backend rejects any single action-facet argument above this many UTF-8 bytes. */
export const ACTION_FACET_ARG_MAX_BYTES = 64 * 1024;

const encoder = new TextEncoder();

export function utf8ByteLength(value: string): number {
  return encoder.encode(value).length;
}

export function fitsActionFacetArg(value: string): boolean {
  return utf8ByteLength(value) <= ACTION_FACET_ARG_MAX_BYTES;
}

/**
 * An argument the server does not advertise fails the whole chat request, so only advertised keys
 * are kept. A server without argument metadata advertises none.
 */
export function advertisedFacetArgs(
  args: Readonly<Record<string, string>>,
  allowedArgs: ReadonlySet<string> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(args).filter(([key]) => allowedArgs?.has(key) ?? false),
  );
}
