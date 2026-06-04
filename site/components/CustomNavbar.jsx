"use client";

import { Navbar } from "nextra-theme-docs";
import EratoLabsLogo from "./EratoLabsLogo";

const NEW_WEBSITE_URL = "https://eratolabs.com/en/";
const navItems = [
  ["Product", NEW_WEBSITE_URL],
  ["Trust Center", NEW_WEBSITE_URL],
  ["Company", NEW_WEBSITE_URL],
];

export default function CustomNavbar() {
  return (
    <Navbar
      logo={
        <span aria-label="Erato Labs" className="inline-flex items-center">
          <EratoLabsLogo className="h-9 w-auto" />
        </span>
      }
    >
      <div className="hidden items-center gap-7 font-sans text-lg leading-[1.5] text-[#050505]/80 lg:flex dark:text-[#f7f6f3]/80">
        {navItems.map(([label, href]) => (
          <a
            className="transition-colors hover:text-[#050505] dark:hover:text-white"
            href={href}
            key={label}
          >
            {label}
          </a>
        ))}
        <a
          className="inline-flex items-center gap-1 transition-colors hover:text-[#050505] dark:hover:text-white"
          href="https://github.com/EratoLab/erato"
          rel="noopener"
          target="_blank"
        >
          GitHub
          <svg
            aria-hidden="true"
            className="h-2.5 w-2.5 text-[#10425d] dark:text-[#f7f6f3]"
            fill="none"
            viewBox="0 0 8 8"
          >
            <path
              d="M7.273 7.273V.727H.727M7.273.727.727 7.273"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
        </a>
        <a
          className="inline-flex h-10 items-center justify-center rounded-lg bg-[#10425d] px-4 text-base font-medium tracking-[0.32px] text-[#f7f6f3] transition-colors hover:bg-[#0b2f42] dark:bg-[#f7f6f3] dark:text-[#10425d] dark:hover:bg-white"
          href="mailto:contact@eratolabs.com"
          rel="noopener"
          target="_blank"
        >
          Talk to Sales
        </a>
      </div>
    </Navbar>
  );
}
