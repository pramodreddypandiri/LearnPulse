// ══════════════════════════════════════════════════════════════════════
// Button — Reusable Button Component
// src/components/ui/Button.tsx
//
// PURPOSE:
//   A flexible button with three visual variants used throughout the app.
//   Centralizing button styles here ensures visual consistency and makes
//   global style changes trivial (change once, updates everywhere).
//
// VARIANTS:
//   - 'primary'   → Main CTA (solid indigo) — used for "Analyze My Learning"
//   - 'secondary' → Secondary actions (outlined) — used for "Reset"
//   - 'ghost'     → Minimal style — used for "Copy" buttons
//
// USAGE:
//   <Button onClick={handleAnalyze} isLoading={state.stage !== 'idle'}>
//     Analyze My Learning
//   </Button>
//
// AFFECT ON THE SYSTEM:
//   - Used by: HistoryInput, PostPreview, CopyButton, main page
//   - Exported from: src/components/ui/index.ts
// ══════════════════════════════════════════════════════════════════════

import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style variant */
  variant?: 'primary' | 'secondary' | 'ghost';
  /** Shows a spinner and disables the button while true */
  isLoading?: boolean;
  /** Size of the button */
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Button component with loading state, variants, and disabled handling.
 *
 * Automatically disabled when isLoading=true — no need to set disabled manually.
 * The button's width/layout is controlled by the parent (not set here).
 */
export function Button({
  children,
  variant = 'primary',
  isLoading = false,
  size = 'md',
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  // Base styles shared by all variants
  const base = 'inline-flex items-center justify-center font-medium rounded-lg transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';

  // Size classes
  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-5 py-2.5 text-sm',
    lg: 'px-6 py-3 text-base',
  };

  // Variant-specific styles
  const variants = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700 focus:ring-indigo-500 shadow-sm',
    secondary: 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus:ring-indigo-500',
    ghost: 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 focus:ring-gray-300',
  };

  return (
    <button
      {...props}
      disabled={disabled || isLoading}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {isLoading && (
        // Inline spinner shown while loading
        <svg
          className="animate-spin -ml-1 mr-2 h-4 w-4"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </button>
  );
}
