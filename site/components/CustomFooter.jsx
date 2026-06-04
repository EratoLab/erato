import EratoLabsLogo from "./EratoLabsLogo";

const NEW_WEBSITE_URL = "https://eratolabs.com/en/";

const footerColumns = [
  {
    title: "Product",
    links: [
      ["Features", NEW_WEBSITE_URL],
      ["Integration", "https://erato.chat/docs"],
      ["Security", NEW_WEBSITE_URL],
      ["Prices", NEW_WEBSITE_URL],
    ],
  },
  {
    title: "Erato Labs",
    links: [
      ["Contact", "mailto:contact@eratolabs.com"],
      ["About us", NEW_WEBSITE_URL],
      ["Team", NEW_WEBSITE_URL],
    ],
  },
];

const socialLinks = [
  ["LinkedIn", "https://www.linkedin.com/company/erato-labs"],
  ["GitHub", "https://github.com/EratoLab/erato"],
];

const legalLinks = [
  ["Imprint", `${NEW_WEBSITE_URL}imprint`],
  ["Privacy Policy", NEW_WEBSITE_URL],
  ["Cookie Policy", NEW_WEBSITE_URL],
];

function ExternalArrow() {
  return (
    <svg
      aria-hidden="true"
      className="h-3 w-3 rotate-[-45deg] text-[#10425d] dark:text-[#f7f6f3]"
      fill="none"
      viewBox="0 0 11 11"
    >
      <path
        d="M6.545 6.545V0H0M6.545 0 0 6.545"
        stroke="currentColor"
        strokeWidth="1.5"
        transform="translate(1.8 2.2) rotate(45 3.25 3.25)"
      />
    </svg>
  );
}

export default function CustomFooter() {
  return (
    <footer className="border-t border-[#b0b0af] bg-[#f7f6f3] text-[#050505] dark:border-[#536970] dark:bg-[#050505] dark:text-[#f7f6f3]">
      <div className="mx-auto flex max-w-7xl flex-col gap-14 px-6 py-16 lg:px-12">
        <div className="grid gap-12 lg:grid-cols-[1fr_2fr]">
          <div className="space-y-5">
            <a
              aria-label="Erato Labs"
              className="inline-flex"
              href={NEW_WEBSITE_URL}
            >
              <EratoLabsLogo className="h-9 w-auto" />
            </a>
            <p className="font-sans text-base leading-[22.4px] text-black/60 dark:text-[#f7f6f3]/60">
              AI that fits in
            </p>
          </div>

          <div className="grid gap-10 sm:grid-cols-3 lg:gap-[60px]">
            {footerColumns.map((column) => (
              <div className="space-y-5" key={column.title}>
                <h3 className="font-mono text-sm font-medium leading-[21px] text-black/60 dark:text-[#f7f6f3]/60">
                  {column.title}
                </h3>
                <ul className="space-y-3 font-sans text-base leading-[1.5]">
                  {column.links.map(([label, href]) => (
                    <li key={label}>
                      <a
                        className="transition-colors hover:text-[#10425d] dark:hover:text-white"
                        href={href}
                      >
                        {label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <div className="space-y-5">
              <h3 className="font-mono text-sm font-medium leading-[21px] text-black/60 dark:text-[#f7f6f3]/60">
                Stayup-to-date
              </h3>
              <div className="flex flex-col items-start gap-2 font-sans text-base font-medium tracking-[0.32px] text-[#10425d] dark:text-[#f7f6f3]">
                {socialLinks.map(([label, href]) => (
                  <a
                    className="inline-flex items-center gap-2 rounded-lg py-2 pr-3 transition-colors hover:text-[#0b2f42] dark:hover:text-white"
                    href={href}
                    key={label}
                    rel="noopener"
                    target="_blank"
                  >
                    {label}
                    <ExternalArrow />
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6 border-t border-[#b0b0af] pt-10 sm:flex-row sm:items-center sm:justify-between dark:border-[#536970]">
          <div className="flex flex-col gap-3 font-sans text-base leading-[1.5] text-[#050505]/60 sm:flex-row sm:gap-6 dark:text-[#f7f6f3]/60">
            {legalLinks.map(([label, href]) => (
              <a
                className="underline transition-colors hover:text-[#10425d] dark:hover:text-white"
                href={href}
                key={label}
              >
                {label}
              </a>
            ))}
          </div>
          <p className="font-sans text-sm leading-[21px] text-[#050505]/50 dark:text-[#f7f6f3]/50">
            Erato Labs GmbH
          </p>
        </div>
      </div>
    </footer>
  );
}
