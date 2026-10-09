import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Loader2,
  MessageSquarePlus,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  EXPENSE_CATEGORIES,
  isCurrencyCode,
  toMinor,
  type CurrencyCode,
  type ExpenseCategory,
} from '@tripshare/shared';
import type { PlanOp } from '@tripshare/shared/trip-format';
import { Markdown } from '@/components/markdown';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { useAiStatus, useAiTask } from '@/lib/ai';
import { money, shortDate } from '@/lib/format';
import { usePlanOps } from '@/lib/plan';
import { useTRPC } from '@/lib/trpc';
import type { TripDetail } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ExpenseDialog, type ExpensePreset } from './expense-dialog';
import { useOnAdd } from '@/lib/fab';
import { useKeyboard } from '@/lib/keyboard';
import { ProposalDialog } from './proposal-dialog';
import { hasPendingAsk, takePendingAsk } from '@/lib/assistant-ask';
import { confirmDialog } from '@/components/confirm';

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

interface ExpenseProposal {
  title: string;
  amount: number;
  currency: string;
  category: ExpenseCategory;
  emoji?: string;
  date?: string;
  paidBy?: string;
  splitAmong: string[];
  status: 'paid' | 'planned';
  notes?: string;
}

/** Spesa proposta → valori iniziali del dialog (i nomi diventano partecipanti del viaggio). */
function presetOf(e: ExpenseProposal, trip: TripDetail): ExpensePreset {
  const active = trip.members.filter((m) => !m.removed);
  const norm = (x: string) => x.trim().toLowerCase();
  const byName = (name: string) =>
    active.find((m) => norm(m.name) === norm(name)) ??
    active.find((m) => norm(m.name).split(' ')[0] === norm(name).split(' ')[0]);
  const currency = isCurrencyCode(e.currency) ? e.currency : (trip.currency as CurrencyCode);
  const members = e.splitAmong.map(byName).filter((m) => !!m);
  return {
    title: e.title,
    emoji: e.emoji ?? null,
    category: e.category,
    amount: toMinor(e.amount, currency),
    currency,
    date: e.date,
    notes: e.notes,
    status: e.status,
    payerId: e.paidBy ? byName(e.paidBy)?.id : undefined,
    memberIds: members.map((m) => m.id),
  };
}

export function AssistantTab({ trip }: { trip: TripDetail }) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const status = useAiStatus();
  const { run, running } = useAiTask();
  const { apply, pending: applying } = usePlanOps(trip.id);
  const keyboard = useKeyboard();
  const conversationsKey = trpc.ai.chat.conversations.queryKey({ tripId: trip.id });
  const { data: conversations } = useQuery(
    trpc.ai.chat.conversations.queryOptions({ tripId: trip.id }),
  );
  // undefined = ancora da scegliere (si apre la più recente), null = nuova chat.
  const [conversationId, setConversationId] = useState<string | null | undefined>(
    // Se arriva una domanda dalla ricerca si parte subito da una chat nuova.
    hasPendingAsk() ? null : undefined,
  );
  useEffect(() => {
    if (conversationId === undefined && conversations)
      setConversationId(conversations[0]?.id ?? null);
  }, [conversations, conversationId]);
  const { data: history } = useQuery({
    ...trpc.ai.chat.history.queryOptions({ tripId: trip.id, conversationId: conversationId ?? '' }),
    enabled: !!conversationId,
  });
  const markApplied = useMutation(trpc.ai.chat.markApplied.mutationOptions());
  const removeChat = useMutation(
    trpc.ai.chat.remove.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: conversationsKey });
        setConversationId(undefined);
      },
    }),
  );
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [expense, setExpense] = useState<ExpensePreset | null>(null);
  /** Modifiche proposte in revisione prima di essere applicate. */
  const [reviewing, setReviewing] = useState<{ messageId: string; ops: PlanOp[] } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useOnAdd('assistant', () => input.current?.focus());
  const canEdit = trip.role !== 'viewer';

  // Corpo tra graffe: in Chrome recente scrollIntoView restituisce una Promise, che React
  // scambierebbe per la funzione di pulizia dell'effetto.
  const scrollToEnd = () => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  };
  useEffect(() => {
    scrollToEnd();
  }, [history?.length, sent, conversationId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Con la tastiera aperta l'ultimo messaggio resta visibile sopra la casella di testo.
  useEffect(() => {
    if (keyboard.open) scrollToEnd();
  }, [keyboard.open, keyboard.inset]);

  /** La casella cresce con il testo (fino a circa 6 righe). */
  const autosize = () => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };
  useEffect(() => {
    autosize();
  }, [message]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || running) return;
    setMessage('');
    setSent(msg);
    let target = conversationId ?? null;
    await run(
      trip.id,
      { kind: 'chat', message: msg, ...(target ? { conversationId: target } : {}) },
      {
        onStarted: ({ conversationId: started }) => {
          if (started && started !== target) {
            target = started;
            setConversationId(started);
          }
          void queryClient.invalidateQueries({ queryKey: conversationsKey });
        },
      },
    );
    if (target)
      await queryClient.invalidateQueries({
        queryKey: trpc.ai.chat.history.queryKey({ tripId: trip.id, conversationId: target }),
      });
    await queryClient.invalidateQueries({ queryKey: conversationsKey });
    setSent(null);
  };

  useEffect(() => {
    const ask = takePendingAsk();
    if (ask) void send(ask);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  const messages = conversationId ? (history ?? []) : [];
  const suggestions = [t('ai.chat.s1'), t('ai.chat.s2'), t('ai.chat.s3'), t('ai.chat.s4')];

  return (
    <div className="grid grid-cols-1 gap-4 pb-40">
      {conversations && conversations.length > 0 && (
        <div className="flex items-center gap-2">
          <Select
            className="h-10 min-w-0 flex-1 text-sm"
            value={conversationId ?? ''}
            onChange={(e) => setConversationId(e.target.value || null)}
            aria-label={t('ai.chat.conversations')}
          >
            {conversationId === null && <option value="">✨ {t('ai.chat.newChat')}</option>}
            {conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} · {shortDate(String(c.updatedAt).slice(0, 10))}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            variant="outline"
            className="h-10 shrink-0"
            disabled={conversationId === null || running}
            aria-label={t('ai.chat.newChat')}
            title={t('ai.chat.newChat')}
            onClick={() => {
              setConversationId(null);
              input.current?.focus();
            }}
          >
            <MessageSquarePlus />
            <span className="hidden sm:inline">{t('ai.chat.newChat')}</span>
          </Button>
          {conversationId && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-10 shrink-0 text-muted-foreground"
              aria-label={t('ai.chat.clear')}
              title={t('ai.chat.clear')}
              onClick={async () =>
                (await confirmDialog(t('ai.chat.confirmClear'))) &&
                removeChat.mutate({ tripId: trip.id, conversationId })
              }
            >
              <Trash2 />
            </Button>
          )}
        </div>
      )}
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
        const expenses = (m.expenses ?? []) as ExpenseProposal[];
        const mine = m.role === 'user';
        return (
          <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm break-words',
                mine
                  ? 'rounded-br-md bg-primary whitespace-pre-wrap text-primary-foreground'
                  : 'rounded-bl-md border bg-card',
              )}
            >
              {mine ? m.content : <Markdown>{m.content}</Markdown>}
              {expenses.length > 0 && (
                <div className="mt-3 grid grid-cols-1 gap-2 text-foreground">
                  {expenses.map((e, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 rounded-xl bg-muted/60 px-3 py-2.5 whitespace-normal"
                    >
                      <span className="text-xl">
                        {e.emoji ?? EXPENSE_CATEGORIES[e.category]?.emoji ?? '📦'}
                      </span>
                      <span className="min-w-0 flex-1 text-[13px]">
                        <span className="block truncate font-semibold">{e.title}</span>
                        <span className="block text-muted-foreground">
                          {money(
                            toMinor(e.amount, isCurrencyCode(e.currency) ? e.currency : 'EUR'),
                            e.currency,
                          )}
                          {e.paidBy && ` · ${e.paidBy}`}
                          {e.status === 'planned' && ` · ⏳ ${t('expense.planned')}`}
                        </span>
                      </span>
                      {canEdit && (
                        <Button size="sm" onClick={() => setExpense(presetOf(e, trip))}>
                          <Plus />
                          {t('ai.chat.addExpense')}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
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
                        onClick={() => setReviewing({ messageId: m.id, ops: actions })}
                      >
                        <Pencil />
                        {t('ai.chat.review')}
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
      {reviewing && (
        <ProposalDialog
          ops={reviewing.ops}
          describe={describeOp}
          applying={applying}
          onClose={() => setReviewing(null)}
          onApply={async (ops) => {
            await apply(ops);
            await markApplied.mutateAsync({ tripId: trip.id, messageId: reviewing.messageId });
            await queryClient.invalidateQueries({
              queryKey: trpc.ai.chat.history.queryKey({
                tripId: trip.id,
                conversationId: conversationId ?? '',
              }),
            });
            setReviewing(null);
          }}
        />
      )}
      {expense && (
        <ExpenseDialog
          trip={trip}
          preset={expense}
          open
          onOpenChange={(o) => !o && setExpense(null)}
        />
      )}

      <form
        onSubmit={onSubmit}
        style={keyboard.open ? { bottom: keyboard.inset + 8 } : undefined}
        className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 mx-auto flex max-w-4xl items-end gap-2 px-4 lg:bottom-6 lg:px-8"
      >
        <div className="flex flex-1 items-end gap-2 rounded-3xl border bg-card p-1.5 shadow-lg">
          <textarea
            id="assistant-input"
            ref={input}
            rows={1}
            onFocus={() => setTimeout(scrollToEnd, 300)}
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
