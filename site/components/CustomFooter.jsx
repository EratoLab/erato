"use client";

import Link from "next/link";
import { ThemeSwitch } from "nextra-theme-docs";
import LanguageSwitcher from "./LanguageSwitcher";

export default function CustomFooter() {
  return (
    <footer className="border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Theme switcher aligned with rightmost column */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-8 mb-4">
          <div></div>
          <div></div>
          <div></div>
          <div></div>
          {/* Column 5 - Theme picker above Language */}
          <div className="flex justify-start">
            <ThemeSwitch />
          </div>
        </div>

        {/* 5-column grid layout */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-8">
          {/* Column 1 - Placeholder for future content */}
          <div className="space-y-4">
            {/* Empty for now - reserve space for future links like "Platform" */}
          </div>

          {/* Column 2 - Placeholder for future content */}
          <div className="space-y-4">
            {/* Empty for now - reserve space for future links like "Integrations" */}
          </div>

          {/* Column 3 - Placeholder for future content */}
          <div className="space-y-4">
            {/* Empty for now - reserve space for future links like "Resources" */}
          </div>

          {/* Column 4 - About */}
          <div className="space-y-4">
            <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 text-sm uppercase tracking-wider">
              About
            </h3>
            <ul className="space-y-2">
              <li>
                <Link
                  href="https://github.com/EratoLab/erato"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
                >
                  GitHub
                </Link>
              </li>
              <li>
                <Link
                  href="/docs"
                  className="text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
                >
                  Documentation
                </Link>
              </li>
            </ul>
          </div>

          {/* Column 5 - Languages */}
          <div className="space-y-4">
            <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 text-sm uppercase tracking-wider">
              Language
            </h3>
            <div className="flex flex-col gap-2">
              <LanguageSwitcher />
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
