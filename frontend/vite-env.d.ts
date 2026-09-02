/// <reference types="vite/client" />

declare module "virtual:erato-icon-catalogs" {
  import type { SimpleIcon } from "simple-icons";

  export const loadSimpleIconBucket: (
    bucket: string,
  ) => Promise<Record<string, Pick<SimpleIcon, "path" | "title">>>;
  export const loadIconoirIconBucket: (
    bucket: string,
  ) => Promise<Record<string, unknown>>;
}
