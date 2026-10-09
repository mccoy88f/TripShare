import { cn } from '@/lib/utils';

/** Sfumature predefinite per le copertine senza foto. */
export const COVER_GRADIENTS: Record<string, string> = {
  '#0d9488': 'linear-gradient(135deg, #14b8a6, #0f766e 55%, #312e81)',
  '#6366f1': 'linear-gradient(135deg, #818cf8, #4f46e5 50%, #1e1b4b)',
  '#f97316': 'linear-gradient(135deg, #fdba74, #f97316 45%, #9f1239)',
  '#0ea5e9': 'linear-gradient(135deg, #7dd3fc, #0284c7 50%, #082f49)',
  '#22c55e': 'linear-gradient(135deg, #bef264, #16a34a 50%, #14532d)',
  '#e11d48': 'linear-gradient(135deg, #fda4af, #e11d48 50%, #4c0519)',
  '#a855f7': 'linear-gradient(135deg, #f0abfc, #a855f7 50%, #3b0764)',
  '#334155': 'linear-gradient(135deg, #94a3b8, #334155 55%, #020617)',
};
export const DEFAULT_COVER = '#0d9488';

export function coverBackground(coverImage?: string | null, coverColor?: string | null) {
  if (coverImage) return `center / cover no-repeat url("${coverImage}")`;
  return COVER_GRADIENTS[coverColor ?? DEFAULT_COVER] ?? COVER_GRADIENTS[DEFAULT_COVER]!;
}

export function TripCover({
  coverImage,
  coverColor,
  className,
  children,
}: {
  coverImage?: string | null;
  coverColor?: string | null;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn('relative overflow-hidden text-white', className)}
      style={{ background: coverBackground(coverImage, coverColor) }}
    >
      <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/15 to-transparent" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_10%,rgb(255_255_255/0.22),transparent_45%)]" />
      <div className="relative h-full">{children}</div>
    </div>
  );
}
