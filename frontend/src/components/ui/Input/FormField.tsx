import clsx from "clsx";

import type React from "react";

export interface FormFieldProps {
  /**
   * Label text for the form field
   */
  label: string;
  /**
   * Whether the field is required
   * @default false
   */
  required?: boolean;
  /**
   * Error message to display
   */
  error?: string;
  /**
   * Help text to display below the field
   */
  helpText?: string;
  /**
   * Optional action element to display inline after the label (e.g., InfoTooltip)
   */
  labelAction?: React.ReactNode;
  /**
   * The input or textarea element
   */
  children: React.ReactNode;
  /**
   * ID for associating label with input
   * Should match the input's id prop
   */
  htmlFor?: string;
  /**
   * Additional CSS classes for the wrapper
   */
  className?: string;
}

/**
 * FormField component that wraps form inputs with label and error display
 *
 * Provides consistent spacing, typography, and accessibility for form fields.
 * Use this to wrap Input, Textarea, or other form controls.
 *
 * @example
 * ```tsx
 * <FormField
 *   label="Email"
 *   required
 *   error={errors.email}
 *   htmlFor="email-input"
 * >
 *   <Input
 *     id="email-input"
 *     type="email"
 *     value={email}
 *     onChange={(e) => setEmail(e.target.value)}
 *   />
 * </FormField>
 * ```
 */
export const FormField: React.FC<FormFieldProps> = ({
  label,
  required = false,
  error,
  helpText,
  labelAction,
  children,
  htmlFor,
  className,
}) => {
  return (
    <div className={clsx("w-full", className)}>
      <label
        htmlFor={htmlFor}
        className="mb-2 flex items-center justify-between text-base font-semibold text-theme-fg-primary"
      >
        <span className="inline-flex items-center gap-1.5">
          <span>
            {label}
            {required && (
              <span className="ml-1 text-theme-error-fg" role="presentation">
                *
              </span>
            )}
          </span>
        </span>
        {labelAction && (
          <span className="flex items-center gap-2">{labelAction}</span>
        )}
      </label>
      {children}
      {helpText && !error && (
        <p className="mt-2 text-sm text-theme-fg-secondary">{helpText}</p>
      )}
    </div>
  );
};

// eslint-disable-next-line lingui/no-unlocalized-strings
FormField.displayName = "FormField";
