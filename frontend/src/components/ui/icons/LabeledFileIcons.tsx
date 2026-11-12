import { EmptyPage, Package } from "iconoir-react";

import type { SVGProps } from "react";

export interface LabeledFileIconProps extends SVGProps<SVGSVGElement> {
  /** Short text displayed inside the outline, for example a file extension. */
  label?: string;
}

function LabeledFileIcon({
  outline: Outline,
  label,
  width = 24,
  height = 24,
  strokeWidth = 1.5,
  ...props
}: LabeledFileIconProps & { outline: typeof EmptyPage }) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <Outline width={24} height={24} strokeWidth={strokeWidth} aria-hidden />
      {label && (
        <text
          x={12}
          y={Outline === EmptyPage ? 18 : 16}
          textAnchor="middle"
          fill="currentColor"
          stroke="none"
          className="font-sans"
          fontWeight={700}
          fontSize={Math.min(5.5, 30 / label.length)}
        >
          {label}
        </text>
      )}
    </svg>
  );
}

export const FileIcon = (props: LabeledFileIconProps) => (
  <LabeledFileIcon outline={EmptyPage} {...props} />
);

export const PackageIcon = (props: LabeledFileIconProps) => (
  <LabeledFileIcon outline={Package} {...props} />
);
