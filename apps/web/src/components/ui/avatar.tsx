import { cn, colorFromString, initials } from '@/lib/utils';

export interface AvatarUser {
  name: string;
  image?: string | null;
  avatarEmoji?: string | null;
  avatarColor?: string | null;
}

const sizes = {
  sm: 'size-8 text-sm',
  md: 'size-10 text-base',
  lg: 'size-16 text-2xl',
  xl: 'size-24 text-5xl',
} as const;

/** Avatar dell'utente: foto, oppure emoji su colore, oppure iniziali su un colore ricavato dal nome. */
export function UserAvatar({
  user,
  size = 'md',
  className,
}: {
  user: AvatarUser;
  size?: keyof typeof sizes;
  className?: string;
}) {
  const base = cn(
    'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold ring-2 ring-card',
    sizes[size],
    className,
  );
  if (user.image)
    return <img src={user.image} alt={user.name} className={cn(base, 'object-cover')} />;
  const background = user.avatarColor ?? colorFromString(user.name);
  if (user.avatarEmoji) {
    return (
      <span className={base} style={{ background }} aria-label={user.name} role="img">
        <span className="leading-none">{user.avatarEmoji}</span>
      </span>
    );
  }
  return (
    <span
      className={cn(base, user.avatarColor ? 'text-slate-800' : 'text-white')}
      style={{ background }}
      aria-label={user.name}
      role="img"
    >
      {initials(user.name) || '?'}
    </span>
  );
}
