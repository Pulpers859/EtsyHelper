import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { cn } from '../lib/utils';

/**
 * Button — the app's primary call-to-action primitive.
 *
 * EtsyHelper's CTA identity is a pill with uppercase, wide-tracked, heavy text.
 * That exact class string was copy-pasted across dozens of buttons in the
 * views, which let spacing, weight, hover, and (critically) keyboard-focus
 * behaviour drift apart. This primitive centralizes the look so every CTA stays
 * on-brand and accessible. Lighter, sentence-case affordances should keep using
 * `MiniActionButton` in components/shell.tsx — this is only for CTAs.
 */

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md';

const baseClasses =
  'inline-flex items-center justify-center gap-2 rounded-full font-black uppercase tracking-[0.22em] transition ' +
  'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3.5 py-2 text-[11px]',
  md: 'px-5 py-3 text-xs',
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-slate-950 text-white hover:bg-slate-800 focus-visible:ring-slate-400',
  secondary:
    'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-950 focus-visible:ring-slate-300',
  danger: 'bg-rose-500 text-white hover:bg-rose-400 focus-visible:ring-rose-300',
  ghost: 'text-slate-600 hover:text-slate-950 focus-visible:ring-slate-300',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Optional icon rendered before the label (e.g. a lucide icon or spinner). */
  leadingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', leadingIcon, className, children, type, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cn(baseClasses, sizeClasses[size], variantClasses[variant], className)}
      {...props}
    >
      {leadingIcon}
      {children}
    </button>
  );
});
