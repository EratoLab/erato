import React from 'react';
import clsx from 'clsx';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  children?: React.ReactNode;
}

export const Button = ({ 
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  className,
  ...props
}: ButtonProps) => {
  return (
    <button
      className={clsx(
        'flex items-center gap-2 rounded transition-colors',
        {
          'bg-gray-800 text-white hover:bg-gray-700': variant === 'primary',
          'bg-white hover:bg-gray-100 text-gray-700': variant === 'secondary',
        },
        {
          'p-2 text-sm': size === 'sm',
          'px-3 py-2': size === 'md',
          'px-4 py-3': size === 'lg',
        },
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className
      )}
      {...props}
    >
      {icon && <span className="w-4 h-4">{icon}</span>}
      {children}
    </button>
  );
}; 