import { I18nProvider as LinguiI18nProvider } from "@lingui/react";
import { useEffect, useState } from "react";

import { i18n, initializeI18n } from "@/lib/i18n";

import type React from "react";

interface I18nProviderProps {
  children: React.ReactNode;
}

export function I18nProvider({ children }: I18nProviderProps) {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void initializeI18n().finally(() => setIsLoading(false));
  }, []);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-lg text-gray-600">Loading translations...</div>
      </div>
    );
  }

  return <LinguiI18nProvider i18n={i18n}>{children}</LinguiI18nProvider>;
}
