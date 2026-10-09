import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Plus, Sparkles, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { PackingItem } from '@tripshare/shared/trip-format';
import { UserAvatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { toast } from 'sonner';
import { useAiStatus, useAiTask } from '@/lib/ai';
import { usePlan, usePlanOps } from '@/lib/plan';
import { useTRPC } from '@/lib/trpc';
import type { TripDetail } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useOnAdd } from '@/lib/fab';

const GROUPS: PackingItem['group'][] = [
  'documents',
  'clothing',
  'electronics',
  'health',
  'gear',
  'food',
  'other',
];
const GROUP_EMOJI: Record<PackingItem['group'], string> = {
  documents: '🛂',
  clothing: '🧥',
  electronics: '🔌',
  health: '💊',
  gear: '🎒',
  food: '🥪',
  other: '📦',
};

export function PackingTab({ trip }: { trip: TripDetail }) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data } = usePlan(trip.id);
  const { apply, pending } = usePlanOps(trip.id);
  const [item, setItem] = useState('');
  useOnAdd('packing', () => {
    const el = document.getElementById('packing-new');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.focus();
  });
  const [group, setGroup] = useState<PackingItem['group']>('clothing');
  const [perPerson, setPerPerson] = useState(false);
  const ai = useAiStatus();
  const { run, running } = useAiTask();
  const [suggested, setSuggested] = useState<{ items: PackingItem[]; selected: boolean[] } | null>(
    null,
  );
  const toggle = useMutation(
    trpc.plan.togglePacking.mutationOptions({
      // Aggiornamento ottimistico: la spunta appare subito.
      onMutate: async ({ itemId, checked }) => {
        const key = trpc.plan.get.queryKey({ tripId: trip.id });
        await queryClient.cancelQueries({ queryKey: key });
        const previous = queryClient.getQueryData(key);
        queryClient.setQueryData(key, (old) => {
          if (!old) return old;
          const current = old.checks[itemId] ?? [];
          const next = checked
            ? [...new Set([...current, trip.myMemberId])]
            : current.filter((m) => m !== trip.myMemberId);
          return { ...old, checks: { ...old.checks, [itemId]: next } };
        });
        return { previous };
      },
      onError: (_e, _v, ctx) =>
        ctx?.previous &&
        queryClient.setQueryData(trpc.plan.get.queryKey({ tripId: trip.id }), ctx.previous),
      onSettled: () =>
        queryClient.invalidateQueries({ queryKey: trpc.plan.get.queryKey({ tripId: trip.id }) }),
    }),
  );
  if (!data) return <Loader2 className="mx-auto mt-10 animate-spin text-muted-foreground" />;
  const { plan, checks } = data;
  const members = trip.members.filter((m) => !m.removed);
  const canEdit = trip.role !== 'viewer';

  const isDone = (p: PackingItem) => {
    const c = checks[p.id!] ?? [];
    return p.perPerson ? c.includes(trip.myMemberId) : c.length > 0;
  };
  const done = plan.packing.filter(isDone).length;

  const suggest = async () => {
    const r = await run<{ items: PackingItem[] }>(trip.id, { kind: 'packing' });
    if (!r) return;
    const existing = new Set(plan.packing.map((p) => p.item.toLowerCase()));
    const items = r.items.filter((i) => !existing.has(i.item.toLowerCase()));
    if (items.length === 0) toast.info(t('ai.packing.nothing'));
    else setSuggested({ items, selected: items.map(() => true) });
  };

  const addSuggested = async () => {
    if (!suggested) return;
    const ops = suggested.items
      .filter((_, i) => suggested.selected[i])
      .map(({ id: _id, ...item }) => {
        void _id;
        return { type: 'upsertPackingItem' as const, item };
      });
    if (ops.length) await apply(ops);
    setSuggested(null);
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    await apply([{ type: 'upsertPackingItem', item: { item: item.trim(), group, perPerson } }]);
    setItem('');
  };

  return (
    <div className="grid grid-cols-1 gap-5 pb-8">
      {plan.packing.length > 0 && (
        <div className="grid grid-cols-1 gap-2">
          <div className="flex justify-between text-sm">
            <span className="font-medium">
              {t('packing.progress', { done, total: plan.packing.length })}
            </span>
            <span className="tabular text-muted-foreground">
              {Math.round((done / plan.packing.length) * 100)}%
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-gradient-to-r from-primary to-accent transition-all"
              style={{ width: `${(done / plan.packing.length) * 100}%` }}
            />
          </div>
        </div>
      )}

      {canEdit && (
        <form onSubmit={add} className="flex flex-wrap items-center gap-2">
          <Input
            id="packing-new"
            className="min-w-48 flex-1"
            required
            maxLength={160}
            placeholder={t('packing.placeholder')}
            value={item}
            onChange={(e) => setItem(e.target.value)}
          />
          <Select
            className="w-40"
            value={group}
            onChange={(e) => setGroup(e.target.value as PackingItem['group'])}
            aria-label={t('packing.group')}
          >
            {GROUPS.map((g) => (
              <option key={g} value={g}>
                {GROUP_EMOJI[g]} {t(`packing.groups.${g}`)}
              </option>
            ))}
          </Select>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-[var(--primary)]"
              checked={perPerson}
              onChange={(e) => setPerPerson(e.target.checked)}
            />
            {t('packing.perPerson')}
          </label>
          <Button type="submit" disabled={pending || !item.trim()}>
            <Plus />
            {t('members.add')}
          </Button>
        </form>
      )}

      {canEdit && ai.data?.available && (
        <Button
          variant="outline"
          className="justify-self-start"
          disabled={running}
          onClick={suggest}
        >
          {running ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {running ? t('ai.packing.thinking') : t('ai.packing.suggest')}
        </Button>
      )}

      {plan.packing.length === 0 && (
        <p className="rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
          {t('packing.empty')}
        </p>
      )}

      {GROUPS.map((g) => {
        const items = plan.packing.filter((p) => p.group === g);
        if (items.length === 0) return null;
        return (
          <section key={g}>
            <h3 className="mb-2 px-1 text-sm font-semibold">
              {GROUP_EMOJI[g]} {t(`packing.groups.${g}`)}
            </h3>
            <Card className="divide-y">
              {items.map((p) => {
                const checkedBy = checks[p.id!] ?? [];
                const mine = checkedBy.includes(trip.myMemberId);
                const doneItem = isDone(p);
                return (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                    <button
                      type="button"
                      onClick={() =>
                        toggle.mutate({
                          tripId: trip.id,
                          itemId: p.id!,
                          checked: p.perPerson ? !mine : !doneItem,
                        })
                      }
                      className={cn(
                        'flex size-6 shrink-0 items-center justify-center rounded-md border-2 transition',
                        doneItem
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-input hover:border-primary',
                      )}
                      aria-pressed={doneItem}
                      aria-label={p.item}
                    >
                      {doneItem && <Check className="size-4" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          'font-medium',
                          doneItem && 'text-muted-foreground line-through',
                        )}
                      >
                        {p.item}
                      </p>
                      {p.reason && <p className="text-xs text-muted-foreground">{p.reason}</p>}
                    </div>
                    {p.perPerson && (
                      <div className="flex -space-x-1.5" title={t('packing.perPerson')}>
                        {members.map((m) => (
                          <UserAvatar
                            key={m.id}
                            user={m}
                            size="sm"
                            className={cn(
                              'size-6 text-[10px]',
                              !checkedBy.includes(m.id) && 'opacity-30 grayscale',
                            )}
                          />
                        ))}
                      </div>
                    )}
                    {canEdit && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8 text-muted-foreground"
                        aria-label={t('expense.delete')}
                        onClick={() => apply([{ type: 'deletePackingItem', id: p.id! }])}
                      >
                        <X />
                      </Button>
                    )}
                  </div>
                );
              })}
            </Card>
          </section>
        );
      })}
      {suggested && (
        <Dialog open onOpenChange={(o) => !o && setSuggested(null)}>
          <DialogContent title={`✨ ${t('ai.packing.title')}`}>
            <div className="grid grid-cols-1 gap-2 pt-2">
              {suggested.items.map((item, i) => (
                <label
                  key={i}
                  className="flex cursor-pointer items-start gap-3 rounded-lg px-1 py-1.5"
                >
                  <input
                    type="checkbox"
                    className="mt-1 size-5 accent-[var(--primary)]"
                    checked={suggested.selected[i] ?? false}
                    onChange={(e) =>
                      setSuggested({
                        ...suggested,
                        selected: suggested.selected.map((v, j) =>
                          j === i ? e.target.checked : v,
                        ),
                      })
                    }
                  />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="font-medium">
                      {GROUP_EMOJI[item.group]} {item.item}
                    </span>
                    {item.reason && (
                      <span className="block text-muted-foreground">{item.reason}</span>
                    )}
                  </span>
                </label>
              ))}
              <Button
                className="mt-2 justify-self-end"
                disabled={pending || !suggested.selected.some(Boolean)}
                onClick={addSuggested}
              >
                <Plus />
                {t('ai.packing.add', { count: suggested.selected.filter(Boolean).length })}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
