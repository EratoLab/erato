import { useId, useState } from "react";

import { Button } from "./Button";
import { Collapse } from "./Collapse";
import { DisclosureChevron } from "./DisclosureChevron";

import type { ReactNode } from "react";

export interface DisclosureButtonProps {
  open: boolean;
  /** The id of the region the button shows and hides. */
  controls: string;
  onToggle: () => void;
  children: ReactNode;
}

export function DisclosureButton({
  open,
  controls,
  onToggle,
  children,
}: DisclosureButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      aria-expanded={open}
      aria-controls={controls}
      icon={<DisclosureChevron open={open} />}
      onClick={onToggle}
    >
      {children}
    </Button>
  );
}

export interface DisclosureProps {
  label: string;
  openLabel?: string;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
  "data-testid"?: string;
}

/** A labelled toggle whose body mounts only while open. */
export function Disclosure({
  label,
  openLabel = label,
  className,
  bodyClassName,
  children,
  "data-testid": dataTestId,
}: DisclosureProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={className} data-testid={dataTestId}>
      <DisclosureButton
        open={open}
        controls={id}
        onToggle={() => setOpen(!open)}
      >
        {open ? openLabel : label}
      </DisclosureButton>
      <Collapse isOpen={open}>
        <div id={id} className={bodyClassName}>
          {open && children}
        </div>
      </Collapse>
    </div>
  );
}
