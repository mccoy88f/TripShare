import { Link } from '@tanstack/react-router';
import { cn } from '@/lib/utils';

export function Logo({ className, to = '/' }: { className?: string; to?: string }) {
  return (
    <Link
      to={to}
      className={cn('inline-flex items-center gap-2 text-lg font-bold tracking-tight', className)}
    >
      <img src="/favicon.svg" alt="" className="size-8 rounded-[10px] shadow-sm" />
      <span>
        Trip
        <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
          Share
        </span>
      </span>
    </Link>
  );
}
