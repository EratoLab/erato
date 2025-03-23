// TODO: remove this once #53 is resolved

import type { VoidToString } from "@/types/chat";

export function createTransformedQueryHook<T, Args extends unknown[]>(
  useQueryHook: (...args: Args) => {
    data: T | undefined;
    isPending: boolean;
    error: unknown;
  },
) {
  return (...args: Args) => {
    const { data, isPending, error } = useQueryHook(...args);
    const transformedData = data ? (data as VoidToString<T>) : undefined;
    return { data: transformedData, isPending, error };
  };
}
