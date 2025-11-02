"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getLocaleFromPath, addLocaleToPath } from "../lib/i18n.js";

export default function HomepageHero() {
  const pathname = usePathname();
  const locale = getLocaleFromPath(pathname);

  // Translations
  const translations = {
    en: {
      tagline: "Erato brings the productivity of modern LLMs into your infrastructure – on-premise, compliant, open-source — on your terms.",
      tagline2: null,
      cta: "GET STARTED",
    },
    // TODO: German variant
    de: {
      tagline: "Der KI-Chat für On-Premise",
      tagline2: "und passend für die Bedürfnisse Ihrer Organisation.",
      cta: "LOSLEGEN",
    },
  };

  const t = translations[locale] || translations.en;
  const docsPath = addLocaleToPath("/docs", locale);

  return (
    <div className="flex flex-col md:flex-col max-w-[60rem] mx-auto px-6 py-10">
      <div className="w-full">
        <div className="text-8xl font-black">The Open Source AI Platform</div>
        <div className="text-lg max-w-[30rem] pt-2">
          {t.tagline}
          <br /> {t.tagline2}
        </div>
      </div>
      <div className="flex flex-col mt-4 md:mt-0 gap-4 justify-center font-bold text-center">
        <Link href={docsPath} className="p-2 px-12 rounded-sm bg-f33-green-500">
          {t.cta}
        </Link>
      </div>
    </div>
  );
}
