import { cn } from '@/lib/utils';

interface LogoMarkProps {
  className?: string;
  showWordmark?: boolean;
}

/**
 * Recreates the Throughline Stitch logo mark exactly: two lineage nodes
 * joined by a dashed dependency line, plus a directional cascade arrow.
 */
export function LogoMark({ className, showWordmark = true }: LogoMarkProps) {
  return (
    <svg
      viewBox={showWordmark ? '0 0 160 36' : '0 0 36 36'}
      className={cn('h-6 w-auto', className)}
      role="img"
      aria-label="Throughline"
    >
      <g transform="translate(2, 6)">
        <circle cx="6" cy="12" r="3.5" fill="var(--color-primary-container)" />
        <line
          x1="9.5"
          y1="12"
          x2="26.5"
          y2="12"
          stroke="var(--color-on-surface)"
          strokeWidth="1.75"
          strokeDasharray="2 2"
        />
        <circle cx="30" cy="12" r="3.5" fill="var(--color-on-surface)" />
        <path
          d="M 12 6 L 18 12 L 12 18"
          stroke="var(--color-primary-container)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          opacity="0.8"
        />
      </g>
      {showWordmark && (
        <text
          x="44"
          y="23"
          className="font-mono-code"
          fontSize="15"
          fontWeight="700"
          letterSpacing="-0.02em"
          fill="var(--color-on-surface)"
        >
          THROUGHLINE
        </text>
      )}
    </svg>
  );
}
