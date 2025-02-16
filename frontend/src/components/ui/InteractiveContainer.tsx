import clsx from "clsx";

interface InteractiveContainerProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean; // Optional prop to control hover/focus states
}

export const InteractiveContainer = ({
  children,
  className,
  interactive = true,
  ...props
}: InteractiveContainerProps) => {
  return (
    <button
      className={clsx(
        "w-full",
        interactive &&
          "hover:bg-theme-bg-accent focus:outline-none focus:ring-2",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
};
