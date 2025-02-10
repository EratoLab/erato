"use client";

export const dynamic = "force-static";

export type Env = {
  apiRootUrl: string;
};

declare global {
  interface Window {
    API_ROOT_URL?: string;
  }
}

export const env = (): Env => {
  const apiRootUrl =
    process.env.NEXT_PUBLIC_API_ROOT_URL || window.API_ROOT_URL;
  if (!apiRootUrl) {
    throw new Error("API_ROOT_URL not set");
  }

  return {
    apiRootUrl,
  };
};
