import { Check, Loader2, Pencil } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { PlanOp } from '@tripshare/shared/trip-format';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** Campi modificabili di una proposta: etichetta principale e, dove serve, data e ora. */
function mainText(op: PlanOp): string | null {
  switch (op.type) {
    case 'upsertActivity':
      return op.activity.title;
    case 'upsertPlace':
      return op.place.name;
    case 'upsertBooking':
      return op.booking.title;
    case 'upsertBudgetItem':
      return op.item.title;
    case 'upsertPackingItem':
      return op.item.item;
    case 'upsertDay':
      return op.day.title;
    default:
      return null;
  }
}

function withMainText(op: PlanOp, text: string): PlanOp {
  const next = structuredClone(op);
  switch (next.type) {
    case 'upsertActivity':
      next.activity.title = text;
      break;
    case 'upsertPlace':
      next.place.name = text;
      break;
    case 'upsertBooking':
      next.booking.title = text;
      break;
    case 'upsertBudgetItem':
      next.item.title = text;
      break;
    case 'upsertPackingItem':
      next.item.item = text;
      break;
    case 'upsertDay':
      next.day.title = text;
      break;
  }
  return next;
}

/** Le voci selezionate si portano dietro i luoghi e le prenotazioni che citano. */
function withDependencies(all: PlanOp[], chosen: boolean[]): PlanOp[] {
  const ops = all.filter((_, i) => chosen[i]);
  const placeIds = new Set<string>();
  const bookingIds = new Set<string>();
  for (const op of ops) {
    if (op.type === 'upsertActivity') {
      op.activity.placeIds?.forEach((id) => placeIds.add(id));
      if (op.activity.bookingId) bookingIds.add(op.activity.bookingId);
    }
    if (op.type === 'upsertBooking' && op.booking.placeId) placeIds.add(op.booking.placeId);
  }
  const extra = all.filter(
    (op, i) =>
      !chosen[i] &&
      ((op.type === 'upsertPlace' && op.place.id && placeIds.has(op.place.id)) ||
        (op.type === 'upsertBooking' && op.booking.id && bookingIds.has(op.booking.id))),
  );
  // I luoghi e le prenotazioni vanno applicati prima delle attività che li usano.
  return [...extra, ...ops];
}

export function ProposalDialog({
  ops,
  describe,
  applying,
  onClose,
  onApply,
}: {
  ops: PlanOp[];
  describe: (op: PlanOp, t: TFunction) => string;
  applying: boolean;
  onClose: () => void;
  onApply: (ops: PlanOp[]) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(ops);
  const [chosen, setChosen] = useState(() => ops.map(() => true));
  const [editing, setEditing] = useState<number | null>(null);
  const count = chosen.filter(Boolean).length;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={t('ai.chat.reviewTitle')} description={t('ai.chat.reviewHint')}>
        <div className="grid grid-cols-1 gap-1 pt-2">
          {draft.map((op, i) => {
            const text = mainText(op);
            return (
              <div key={i} className="rounded-lg px-1 py-1.5">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-5 shrink-0 accent-[var(--primary)]"
                    checked={chosen[i]}
                    aria-label={describe(op, t)}
                    onChange={(e) =>
                      setChosen(chosen.map((v, j) => (j === i ? e.target.checked : v)))
                    }
                  />
                  <span className={cn('min-w-0 flex-1 text-sm', !chosen[i] && 'opacity-50')}>
                    {describe(op, t)}
                  </span>
                  {text !== null && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="-my-1 size-8 shrink-0 text-muted-foreground"
                      aria-label={t('ai.chat.editProposal')}
                      onClick={() => setEditing(editing === i ? null : i)}
                    >
                      <Pencil />
                    </Button>
                  )}
                </div>
                {editing === i && text !== null && (
                  <div className="mt-2 grid grid-cols-1 gap-2 pl-8">
                    <Input
                      autoFocus
                      value={text}
                      maxLength={160}
                      onChange={(e) =>
                        setDraft(
                          draft.map((o, j) => (j === i ? withMainText(o, e.target.value) : o)),
                        )
                      }
                    />
                    {op.type === 'upsertActivity' && (
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          type="date"
                          value={op.date}
                          onChange={(e) =>
                            setDraft(
                              draft.map((o, j) =>
                                j === i && o.type === 'upsertActivity'
                                  ? { ...o, date: e.target.value }
                                  : o,
                              ),
                            )
                          }
                        />
                        <Input
                          type="time"
                          value={op.activity.time ?? ''}
                          onChange={(e) =>
                            setDraft(
                              draft.map((o, j) =>
                                j === i && o.type === 'upsertActivity'
                                  ? {
                                      ...o,
                                      activity: {
                                        ...o.activity,
                                        time: e.target.value || undefined,
                                      },
                                    }
                                  : o,
                              ),
                            )
                          }
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <Button
            className="mt-3 justify-self-end"
            disabled={applying || count === 0}
            onClick={() => onApply(withDependencies(draft, chosen))}
          >
            {applying ? <Loader2 className="animate-spin" /> : <Check />}
            {t('ai.chat.applySelected', { count })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
