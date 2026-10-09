import { UserAvatar, type AvatarUser } from '@/components/ui/avatar';

export function AvatarStack({
  users,
  max = 5,
  size = 'sm',
}: {
  users: (AvatarUser & { id: string })[];
  max?: number;
  size?: 'sm' | 'md';
}) {
  const shown = users.slice(0, max);
  const extra = users.length - shown.length;
  return (
    <div className="flex -space-x-2">
      {shown.map((u) => (
        <UserAvatar key={u.id} user={u} size={size} />
      ))}
      {extra > 0 && (
        <span className="relative inline-flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold ring-2 ring-card">
          +{extra}
        </span>
      )}
    </div>
  );
}
