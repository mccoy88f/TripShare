import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Send, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { PlanOp } from '@tripshare/shared/trip-format';
import { Button } from '@/components/ui/button';
import { useAiStatus, useAiTask } from '@/lib/ai';
import { shortDate } from '@/lib/format';
import { usePlanOps } from '@/lib/plan';
import { useTRPC } from '@/lib/trpc';
import type { TripDetail } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Descrizione breve di una modifica proposta dall'assistente. */
function describeOp(op: PlanOp, t: TFunction): string {
  switch (op.type) {
    case 'upsertActivity':
      return `${op.activity.id ? '✏️' : '➕'} ${op.activity.title} · ${shortDate(op.date)}${op.activity.time ? ` ${op.activity.time}` : ''}`;
    case 'deleteActivity':
      return `🗑️ ${t('ai.chat.ops.deleteActivity')}`;
    case 'moveActivity':
      return `↔️ ${t('ai.chat.ops.moveActivity')} → ${shortDate(op.date)}`;
    case 'upsertDay':
      return `📅 ${op.day.title} · ${shortDate(op.day.date)}`;
    case 'deleteDay':
      return `🗑️ ${t('ai.chat.ops.deleteDay')} · ${shortDate(op.date)}`;
    case 'ensureDays':
      return `📅 ${t('ai.chat.ops.ensureDays')} ${shortDate(op.start)} → ${shortDate(op.end)}`;
    case 'upsertPlace':
      return `📍 ${op.place.name}`;
    case 'upsertBooking':
      return `🎫 ${op.booking.title}`;
    case 'upsertBudgetItem':
      return `💶 ${op.item.title}`;
    case 'upsertPackingItem':
      return `🎒 ${op.item.item}`;
    case 'upsertAlternative':
      return `🔀 ${op.alternative.title}`;
    case 'applyAlternative':
      return `🔀 ${t('ai.chat.ops.applyAlternative')}`;
    case 'setTips':
      return `💡 ${t('ai.chat.ops.setTips', { count: op.tips.length })}`;
    default:
      return `• ${t(`ai.chat.ops.${op.type}`, { defaultValue: op.type })}`;
  }
}

export function AssistantTab({ trip }: { trip: TripDetail }) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const status = useAiStatus();
  const { run, running } = useAiTask();
  const { apply, pending: applying } = usePlanOps(trip.id);
  const historyKey = trpc.ai.chat.history.queryKey({ tripId: trip.id });
  const { data: history } = useQuery(trpc.ai.chat.history.queryOptions({ tripId: trip.id }));
  const markApplied = useMutation(trpc.ai.chat.markApplied.mutationOptions());
  const clear = useMutation(
    trpc.ai.chat.clear.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: historyKey }),
    }),
  );
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const canEdit = trip.role !== 'viewer';

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [history?.length, sent]);

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || running) return;
    setMessage('');
    setSent(msg);
    await run(trip.id, { kind: 'chat', message: msg });
    await queryClient.invalidateQueries({ queryKey: historyKey });
    setSent(null);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(message);
  };

  if (status.data && !status.data.available) {
    return (
      <p className="rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
        ✨ {t('ai.notAvailable')}
      </p>
    );
  }

  const messages = history ?? [];
  const suggestions = [t('ai.chat.s1'), t('ai.chat.s2'), t('ai.chat.s3'), t('ai.chat.s4')];

  return (
    <div className="grid grid-cols-1 gap-4 pb-24">
      {messages.length === 0 && !sent && (
        <div className="grid place-items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
          <Sparkles className="size-8 text-accent" />
          <p className="max-w-md text-sm text-muted-foreground">{t('ai.chat.intro')}</p>
          <div className="flex flex-wrap justify-center gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void send(s)}
                className="rounded-full border bg-card px-3 py-1.5 text-sm transition hover:bg-muted"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {messages.map((m) => {
        const actions = (m.actions ?? []) as PlanOp[];
        const mine = m.role === 'user';
        return (
          <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm break-words whitespace-pre-wrap',
                mine
                  ? 'rounded-br-md bg-primary text-primary-foreground'
                  : 'rounded-bl-md border bg-card',
              )}
            >
              {m.content}
              {actions.length > 0 && (
                <div className="mt-3 grid grid-cols-1 gap-2 rounded-xl bg-muted/60 p-3 text-foreground">
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {t('ai.chat.proposed', { count: actions.length })}
                  </p>
                  <ul className="grid grid-cols-1 gap-1 text-[13px]">
                    {actions.map((op, i) => (
                      <li key={i}>{describeOp(op, t)}</li>
                    ))}
                  </ul>
                  {m.appliedAt ? (
                    <p className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
                      <Check className="size-4" />
                      {t('ai.chat.applied')}
                    </p>
                  ) : (
                    canEdit && (
                      <Button
                        size="sm"
                        className="justify-self-start"
                        disabled={applying}
                        onClick={async () => {
                          await apply(actions);
                          await markApplied.mutateAsync({ tripId: trip.id, messageId: m.id });
                          await queryClient.invalidateQueries({ queryKey: historyKey });
                        }}
                      >
                        {applying ? <Loader2 className="animate-spin" /> : <Check />}
                        {t('ai.chat.apply')}
                      </Button>
                    )
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
      {sent && (
        <>
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm whitespace-pre-wrap text-primary-foreground">
              {sent}
            </div>
          </div>
          <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('ai.chat.thinking')}
          </div>
        </>
      )}
      <div ref={bottom} />

      <form
        onSubmit={onSubmit}
        className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 mx-auto flex max-w-4xl items-end gap-2 px-4 lg:bottom-6 lg:px-8"
      >
        <div className="flex flex-1 items-end gap-2 rounded-3xl border bg-card p-1.5 shadow-lg">
          {messages.length > 0 && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-9 shrink-0 text-muted-foreground"
              aria-label={t('ai.chat.clear')}
              title={t('ai.chat.clear')}
              onClick={() =>
                confirm(t('ai.chat.confirmClear')) && clear.mutate({ tripId: trip.id })
              }
            >
              <Trash2 />
            </Button>
          )}
          <textarea
            rows={1}
            maxLength={3000}
            value={message}
            placeholder={t('ai.chat.placeholder')}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(message);
              }
            }}
            className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] outline-none"
            aria-label={t('ai.chat.placeholder')}
          />
          <Button
            type="submit"
            size="icon"
            className="size-9 shrink-0 rounded-full"
            disabled={running || !message.trim()}
            aria-label={t('ai.chat.send')}
          >
            {running ? <Loader2 className="animate-spin" /> : <Send />}
          </Button>
        </div>
      </form>
    </div>
  );
}
