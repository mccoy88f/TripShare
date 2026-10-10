import { Loader2, Send, Sparkles } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { PlanOp } from '@tripshare/shared/trip-format';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useAiStatus, useAiTask } from '@/lib/ai';
import { money, shortDate } from '@/lib/format';
import { usePlan, usePlanOps } from '@/lib/plan';
import { useTRPC } from '@/lib/trpc';
import { textareaClass } from './plan/fields';
import { describeOp } from './assistant-tab';
import { ProposalDialog } from './proposal-dialog';

export type AskTargetType =
  'activity' | 'place' | 'booking' | 'day' | 'budget' | 'packing' | 'tips';
export interface AskTarget {
  type: AskTargetType;
  id: string;
}

interface RefineResult {
  summary: string;
  actions: PlanOp[];
}

/**
 * Icona ✨ nelle schede Dettaglio: apre la richiesta all'AI per cambiare quell'elemento
 * (luogo, mezzo, orari, organizzazione della giornata…). La proposta si rivede prima di
 * applicarla e subito dopo si può annullare.
 */
export function AskAiButton({
  tripId,
  target,
  name,
  onDone,
}: {
  tripId: string;
  target: AskTarget;
  name: string;
  /** Chiamata dopo che la proposta è stata applicata (di solito chiude la scheda). */
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const ai = useAiStatus();
  const [open, setOpen] = useState(false);
  if (!ai.data?.available) return null;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="text-accent"
        onClick={() => setOpen(true)}
        aria-label={t('refine.ask')}
        title={t('refine.ask')}
      >
        <Sparkles />
      </Button>
      {open && (
        <AskAiDialog
          tripId={tripId}
          target={target}
          name={name}
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            onDone?.();
          }}
        />
      )}
    </>
  );
}

function AskAiDialog({
  tripId,
  target,
  name,
  onClose,
  onDone,
}: {
  tripId: string;
  target: AskTarget;
  name: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { run, running } = useAiTask();
  const { apply, pending } = usePlanOps(tripId);
  const { data: planData } = usePlan(tripId);
  const undo = useMutation(trpc.plan.undo.mutationOptions());
  const [instruction, setInstruction] = useState('');
  const [proposal, setProposal] = useState<RefineResult | null>(null);
  const plan = planData?.plan;
  const suggestions = [1, 2, 3].map((n) => t(`refine.suggestions.${target.type}.s${n}`));

  const ask = async (text: string) => {
    const instr = text.trim();
    if (instr.length < 3 || running) return;
    const result = await run<RefineResult>(tripId, { kind: 'refine', target, instruction: instr });
    if (result) setProposal(result);
  };

  const placeNames = Object.fromEntries((plan?.places ?? []).map((p) => [p.id, p.name]));
  /** Com'era l'elemento prima della modifica proposta. */
  const before = (op: PlanOp): string | null => {
    if (!plan) return null;
    const find = (id?: string) =>
      plan.days
        .flatMap((d) => d.activities.map((a) => ({ a, date: d.date })))
        .find((x) => x.a.id === id);
    const act = (x?: { a: { time?: string; title: string }; date: string }) =>
      x ? `${x.a.title} · ${shortDate(x.date)}${x.a.time ? ` ${x.a.time}` : ''}` : null;
    switch (op.type) {
      case 'upsertActivity':
        return act(find(op.activity.id));
      case 'moveActivity':
      case 'deleteActivity':
        return act(find(op.id));
      case 'upsertPlace': {
        const p = plan.places.find((x) => x.id === op.place.id);
        return p ? `${p.name}${p.address ? ` · ${p.address}` : ''}` : null;
      }
      case 'upsertBooking': {
        const b = plan.bookings.find((x) => x.id === op.booking.id);
        return b ? `${b.title} · ${shortDate(b.start.date)}` : null;
      }
      case 'upsertBudgetItem': {
        const b = plan.budget.find((x) => x.id === op.item.id);
        return b
          ? `${b.title}${b.amount ? ` · ${money(Math.round(b.amount.amount * 100), b.amount.currency)}` : ''}`
          : null;
      }
      case 'upsertDay': {
        const d = plan.days.find((x) => x.date === op.day.date);
        return d ? `${d.title} · ${shortDate(d.date)}` : null;
      }
      default:
        return null;
    }
  };

  if (proposal) {
    return (
      <ProposalDialog
        ops={proposal.actions}
        title={t('refine.reviewTitle')}
        hint={proposal.summary}
        describe={(op, tr) => describeOp(op, tr, placeNames)}
        before={before}
        applyLabel={(count) => t('refine.apply', { count })}
        applying={pending || undo.isPending}
        onClose={onClose}
        onApply={async (ops) => {
          const res = await apply(ops, { snapshot: name.slice(0, 60) });
          const snapshotId = res?.snapshotId;
          toast.success(t('refine.applied'), {
            duration: 15_000,
            action: snapshotId
              ? {
                  label: t('refine.undo'),
                  onClick: async () => {
                    try {
                      await undo.mutateAsync({ tripId, snapshotId });
                      await Promise.all([
                        queryClient.invalidateQueries({
                          queryKey: trpc.plan.get.queryKey({ tripId }),
                        }),
                        queryClient.invalidateQueries({
                          queryKey: trpc.trips.get.queryKey({ id: tripId }),
                        }),
                      ]);
                      toast.success(t('refine.undone'));
                    } catch (err) {
                      toast.error(
                        err instanceof Error && err.message === 'PLAN_CHANGED'
                          ? t('refine.cannotUndo')
                          : t('common.error'),
                      );
                    }
                  },
                }
              : undefined,
          });
          onDone();
        }}
      />
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !running && onClose()}>
      <DialogContent title={t('refine.title')} description={name}>
        <div className="grid grid-cols-1 gap-3 pt-2">
          <textarea
            autoFocus
            rows={3}
            maxLength={1000}
            className={textareaClass}
            value={instruction}
            disabled={running}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder={t('refine.placeholder')}
            aria-label={t('refine.placeholder')}
          />
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                disabled={running}
                onClick={() => void ask(s)}
                className="rounded-full border bg-card px-3 py-1.5 text-sm transition hover:bg-muted disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
          {running && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t('refine.thinking')}
            </p>
          )}
          <div className="mt-1 flex items-center gap-2">
            <div className="flex-1" />
            <Button type="button" variant="ghost" disabled={running} onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              size="lg"
              disabled={running || instruction.trim().length < 3}
              onClick={() => void ask(instruction)}
            >
              {running ? <Loader2 className="animate-spin" /> : <Send />}
              {t('refine.send')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
