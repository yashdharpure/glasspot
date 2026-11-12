'use client';

import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';

export type ButtonVariant = 'primary' | 'success' | 'danger' | 'ghost';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  loading?: boolean;
  loadingText?: string;
  confirmMessage?: string;
  children: ReactNode;
};

export default function Button({
  variant = 'primary',
  loading = false,
  loadingText = 'Saving...',
  confirmMessage,
  disabled,
  className = '',
  onClick,
  children,
  ...props
}: ButtonProps) {
  const { pending } = useFormStatus();
  const isLoading = loading || pending;

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (confirmMessage && !window.confirm(confirmMessage)) {
      event.preventDefault();
      return;
    }

    onClick?.(event);
  }

  return (
    <button
      {...props}
      className={`button button--${variant}${className ? ` ${className}` : ''}`}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      onClick={handleClick}
    >
      {isLoading ? (
        <>
          <span className="button__spinner" aria-hidden="true" />
          {loadingText}
        </>
      ) : children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = 'primary',
  target,
  rel,
  className = '',
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  target?: string;
  rel?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      target={target}
      rel={rel}
      className={`button button--${variant}${className ? ` ${className}` : ''}`}
    >
      {children}
    </Link>
  );
}
