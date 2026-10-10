import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, Loader2, Lock, Pin, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { UserAvatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DIALOG_FOOTER } from '@/components/dialog-footer';
import { CloseButton, EditButton } from '@/components/edit-button';
import { useDetailMode } from '@/lib/detail-mode';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useOnAdd } from '@/lib/fab';
import { useTRPC } from '@/lib/trpc';
import type { TripDetail } from '@/lib/types';
import { cn } from '@/lib/utils';
import { textareaClass } from './plan/fields';
import { confirmDialog } from '@/components/confirm';
import { searchId } from '@/lib/search-focus';

type Visibility = 'public' | 'private';
interface Draft {
  id?: string;
  title: string;
  content: string;
  visibility: Visibility;
  pinned: boolean;
}
const EMPTY: Draft = { title: '', content: '', visibility: 'public', pinned: false };

/**
 * Note del viaggio: ognuno scrive le sue, visibili a tutti o solo a sé. Il "+" in basso crea
 * una nota; toccando una propria nota la si modifica.
 */
export function NotesTab({ trip }: { trip: TripDetail }) {
  const { t, i18n } = useTranslation();
  const trpc = useTRPC();
  const { data: notes } = useQuery(trpc.notes.list.queryOptions({ tripId: trip.id }));
  const [editing, setEditing] = useState<Draft | null>(null);
  useOnAdd('notes', () => setEditing(EMPTY));

  const member = (id: string) => trip.members.find((m) => m.id === id);
  const when = (d: string | Date) =>
    new Date(d).toLocaleString(i18n.resolvedLanguage, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <div className="grid grid-cols-1 gap-5 pb-8">
      {!notes ? (
        <Loader2 className="mx-auto mt-6 animate-spin text-muted-foreground" />
      ) : notes.length === 0 ? (
        <div className="grid place-items-center rounded-xl border border-dashed px-6 py-12 text-center">
          <span className="text-5xl">📝</span>
          <p className="mt-3 max-w-sm text-sm text-muted-foreground">{t('notes.empty')}</p>
          <Button className="mt-4" onClick={() => setEditing(EMPTY)}>
            {t('notes.add')}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {notes.map((n) => {
            const author = member(n.memberId);
            const mine = n.memberId === trip.myMemberId;
            return (
              <Card
                key={n.id}
                {...searchId(`note:${n.id}`)}
                onClick={() =>
                  mine &&
                  setEditing({
                    id: n.id,
                    title: n.title ?? '',
                    content: n.content,
                    visibility: n.visibility as Visibility,
                    pinned: n.pinned,
                  })
                }
                className={cn(
                  'flex flex-col gap-2 p-4',
                  n.pinned && 'border-primary/40',
                  mine && 'cursor-pointer transition hover:bg-muted/40',
                )}
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    {n.title && <p className="font-semibold">{n.title}</p>}
                  </div>
                  {n.pinned && <Pin className="size-4 shrink-0 text-primary" />}
                  {n.visibility === 'private' && (
                    <span
                      className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
                      title={t('notes.privateHint')}
                    >
                      <Lock className="size-3.5" />
                      {t('notes.private')}
                    </span>
                  )}
                </div>
                <p className="text-sm break-words whitespace-pre-wrap">{n.content}</p>
                <div className="mt-auto flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                  {author && <UserAvatar user={author} size="sm" className="size-6 text-[10px]" />}
                  <span className="min-w-0 flex-1 truncate">
                    {mine ? t('expense.you') : (author?.name ?? '?')} · {when(n.updatedAt)}
                  </span>
                  {!mine && n.visibility === 'public' && trip.role === 'owner' && (
                    <DeleteNote tripId={trip.id} id={n.id} />
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {editing && <NoteDialog trip={trip} draft={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function useRefreshNotes(tripId: string) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: trpc.notes.list.queryKey({ tripId }) });
}

/** Il proprietario può eliminare le note pubbliche degli altri. */
function DeleteNote({ tripId, id }: { tripId: string; id: string }) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const refresh = useRefreshNotes(tripId);
  const remove = useMutation(trpc.notes.delete.mutationOptions({ onSuccess: refresh }));
  return (
    <Button
      size="icon"
      variant="ghost"
      className="size-8"
      aria-label={t('expense.delete')}
      onClick={async (e) => {
        e.stopPropagation();
        if (await confirmDialog(t('notes.confirmDelete'))) remove.mutate({ tripId, id });
      }}
    >
      <Trash2 />
    </Button>
  );
}

function NoteDialog({
  trip,
  draft: initial,
  onClose,
}: {
  trip: TripDetail;
  draft: Draft;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const refresh = useRefreshNotes(trip.id);
  const [draft, setDraft] = useState(initial);
  const detail = useDetailMode(!!initial.id, initial.id);
  useEffect(() => {
    setDraft(initial);
  }, [initial]);
  const onError = () => toast.error(t('common.error'));
  const create = useMutation(trpc.notes.create.mutationOptions({ onSuccess: refresh, onError }));
  const update = useMutation(trpc.notes.update.mutationOptions({ onSuccess: refresh, onError }));
  const remove = useMutation(trpc.notes.delete.mutationOptions({ onSuccess: refresh, onError }));
  const pending = create.isPending || update.isPending || remove.isPending;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const input = {
      tripId: trip.id,
      title: draft.title.trim() || null,
      content: draft.content.trim(),
      visibility: draft.visibility,
      pinned: draft.pinned,
    };
    if (draft.id) await update.mutateAsync({ ...input, id: draft.id });
    else await create.mutateAsync(input);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={
          detail.readOnly ? t('common.detail') : draft.id ? t('notes.editTitle') : t('notes.add')
        }
      >
        <form onSubmit={submit} className="grid grid-cols-1 gap-3 pt-2">
          <fieldset disabled={detail.readOnly} className="contents">
            <Input
              placeholder={t('notes.titlePlaceholder')}
              maxLength={160}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              aria-label={t('notes.title')}
            />
            <textarea
              id="note-new"
              autoFocus={!draft.id}
              className={cn(textareaClass, 'min-h-36')}
              placeholder={t('notes.placeholder')}
              required
              maxLength={10000}
              value={draft.content}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              aria-label={t('notes.content')}
            />
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-full bg-muted p-1">
                {(['public', 'private'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={draft.visibility === v}
                    onClick={() => setDraft({ ...draft, visibility: v })}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition [&_svg]:size-4',
                      draft.visibility === v ? 'bg-card shadow-sm' : 'text-muted-foreground',
                    )}
                  >
                    {v === 'public' ? <Globe /> : <Lock />}
                    {t(`notes.${v}`)}
                  </button>
                ))}
              </div>
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-[var(--primary)]"
                  checked={draft.pinned}
                  onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })}
                />
                {t('notes.pin')}
              </label>
            </div>
          </fieldset>
          <div className={DIALOG_FOOTER}>
            {draft.id && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                aria-label={t('expense.delete')}
                disabled={pending}
                onClick={async () => {
                  if (!(await confirmDialog(t('notes.confirmDelete')))) return;
                  await remove.mutateAsync({ tripId: trip.id, id: draft.id! });
                  onClose();
                }}
              >
                <Trash2 />
                <span className="hidden sm:inline">{t('expense.delete')}</span>
              </Button>
            )}
            {detail.readOnly && <EditButton onClick={detail.startEdit} />}
            <div className="flex-1" />
            {detail.readOnly ? (
              <CloseButton />
            ) : (
              <Button type="submit" size="lg" disabled={pending || !draft.content.trim()}>
                {pending && <Loader2 className="animate-spin" />}
                {draft.id ? t('common.save') : t('notes.add')}
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
