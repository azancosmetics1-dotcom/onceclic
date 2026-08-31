import React from 'react';

interface BadgeProps {
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand';
  children: React.ReactNode;
  size?: 'sm' | 'md';
}

export const Badge: React.FC<BadgeProps> = ({ variant = 'neutral', children, size = 'sm' }) => {
  const sizeStyles = size === 'sm' ? 'px-2.5 py-0.5 text-xs' : 'px-3 py-1 text-sm';

  const variantStyles = {
    success: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
    warning: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
    danger: 'bg-rose-500/10 text-rose-400 border border-rose-500/20',
    info: 'bg-sky-500/10 text-sky-400 border border-sky-500/20',
    brand: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
    neutral: 'bg-slate-800 text-slate-300 border border-slate-700',
  }[variant];

  return (
    <span
      className={`inline-flex items-center font-medium rounded-full ${sizeStyles} ${variantStyles}`}
    >
      {children}
    </span>
  );
};
