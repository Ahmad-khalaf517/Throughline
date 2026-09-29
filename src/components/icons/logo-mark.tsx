import Image from 'next/image';
import { cn } from '@/lib/utils';

interface LogoMarkProps {
  className?: string;
  showWordmark?: boolean;
}

/** The same vector artwork is exported for favicon, email, and promotion. */
export function LogoMark({ className, showWordmark = true }: LogoMarkProps) {
  return (
    <Image
      src={showWordmark ? '/brand/logo-horizontal.svg' : '/brand/logo-mark.svg'}
      width={showWordmark ? 470 : 96}
      height={showWordmark ? 64 : 32}
      alt="Throughline"
      loading="eager"
      className={cn('h-7 w-auto', className)}
    />
  );
}
