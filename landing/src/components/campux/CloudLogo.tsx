import { useId, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';

interface CloudLogoProps {
  className?: string;
  style?: CSSProperties;
}

/** Campux 品牌云朵标志 */
export function CloudLogo({ className, style }: CloudLogoProps) {
  const gradientId = useId();
  return (
    <svg
      viewBox="0 0 48 32"
      fill="none"
      aria-hidden="true"
      style={style}
      className={cn('h-7 w-auto', className)}
    >
      <g fill={`url(#${gradientId})`}>
        <circle cx="14" cy="20" r="8" />
        <circle cx="25" cy="14" r="10" />
        <circle cx="34" cy="19" r="7" />
        <rect x="14" y="20" width="20" height="8" rx="2.5" />
      </g>
      <defs>
        <linearGradient
          id={gradientId}
          x1="4"
          y1="2"
          x2="44"
          y2="30"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="hsl(196 92% 60%)" />
          <stop offset="1" stopColor="hsl(211 88% 46%)" />
        </linearGradient>
      </defs>
    </svg>
  );
}
