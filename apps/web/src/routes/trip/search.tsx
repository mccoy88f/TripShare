import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { EXPENSE_CATEGORIES, categoryLabel, type Locale } from '@tripshare/shared';
import { normalizeText } from '@tripshare/shared/trip-format';
import { Card } from '@/components/ui/card';
import { longDate, money, shortDate } from '@/lib/format';
import { BOOKING_EMOJI, usePlan } from '@/lib/plan';
import { useTRPC } from '@/lib/trpc';
import type { TripDetail } from '@/lib/types';
import { myTickets, useTickets } from './plan/tickets';

export type SearchTab = 'plan' | 'expenses' | 'bookings' | 'places' | 'packing' | 'notes';
export type SearchKind =
  'activity' | 'place' | 'booking' | 'ticket' | 'expense' | 'budget' | 'packing' | 'tip' | 'note';

export interface SearchResult {
  /** Identificatore dell'elemento da evidenziare (data-search-id). */
  key: string;
  kind: SearchKind;
  emoji: string;
  title: string;
  subtitle?: string;
  tab: SearchTab;
  view?: 'list' | 'budget';
  /** Giorno del programma da aprire per le attività. */
  date?: string;
  haystack: string;
}

const KIND_ORDER: SearchKind[] = [
  'activity',
  'place',
  'booking',
  'ticket',
  'expense',
  'budget',
  'packing',
  'tip',
  'note',
];
const PER_GROUP = 8;

/** Cerca in tutto il viaggio: programma, luoghi, prenotazioni, spese, bagaglio, note e consigli. */
export function SearchPanel({
  trip,
  query,
  onPick,
}: {
  trip: TripDetail;
  query: string;
  onPick: (result: SearchResult) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? 'it') as Locale;
  const trpc = useTRPC();
  const { data: planData } = usePlan(trip.id);
  const { data: expenses } = useQuery(trpc.expenses.list.queryOptions({ tripId: trip.id }));
  const { data: notes } = useQuery(trpc.notes.list.queryOptions({ tripId: trip.id }));
  const { data: tickets } = useTickets(trip.id);

  const items = useMemo<SearchResult[]>(() => {
    const out: SearchResult[] = [];
    const plan = planData?.plan;
    const names = Object.fromEntries(trip.members.map((m) => [m.id, m.name]));
    const add = (r: Omit<SearchResult, 'haystack'>, ...texts: (string | undefined | null)[]) =>
      out.push({ ...r, haystack: normalizeText([r.title, r.subtitle, ...texts].join(' ')) });
    if (plan) {
      const placeName = (id: string) => plan.places.find((p) => p.id === id)?.name;
      for (const d of plan.days)
        for (const a of [...d.activities, ...d.alternatives.flatMap((x) => x.activities)])
          add(
            {
              key: `activity:${a.id}`,
              kind: 'activity',
              emoji: a.emoji ?? '🗓️',
              title: a.title,
              subtitle: `${shortDate(d.date)}${a.time ? ` · ${a.time}` : ''}`,
              tab: 'plan',
              date: d.date,
            },
            a.description,
            ...a.tips,
            ...a.warnings,
            ...a.placeIds.map(placeName),
          );
      for (const p of plan.places)
        add(
          {
            key: `place:${p.id}`,
            kind: 'place',
            emoji: '📍',
            title: p.name,
            subtitle: p.address ?? t(`plan.placeKinds.${p.kind}`),
            tab: 'places',
          },
          p.description,
          p.openingHours,
          ...p.tips,
        );
      for (const b of plan.bookings)
        add(
          {
            key: `booking:${b.id}`,
            kind: 'booking',
            emoji: BOOKING_EMOJI[b.type] ?? '🎫',
            title: b.title,
            subtitle: `${longDate(b.start.date)}${b.provider ? ` · ${b.provider}` : ''}`,
            tab: 'bookings',
          },
          b.provider,
          b.confirmationCode,
          b.flight?.number,
          b.notes,
        );
      for (const it of plan.budget)
        add(
          {
            key: `budget:${it.id}`,
            kind: 'budget',
            emoji: it.emoji ?? EXPENSE_CATEGORIES[it.category].emoji,
            title: it.title,
            subtitle: categoryLabel(it.category, locale),
            tab: 'expenses',
            view: 'budget',
          },
          it.notes,
        );
      for (const p of plan.packing)
        add(
          {
            key: `packing:${p.id!}`,
            kind: 'packing',
            emoji: '🎒',
            title: p.item,
            subtitle: p.reason,
            tab: 'packing',
          },
          p.reason,
        );
      plan.tips.forEach((tip, i) =>
        add(
          {
            key: `tip:${i}`,
            kind: 'tip',
            emoji: '💡',
            title: tip.title,
            subtitle: tip.text,
            tab: 'plan',
          },
          tip.text,
        ),
      );
      for (const tk of myTickets(tickets, trip.myMemberId)) {
        const booking = plan.bookings.find((b) => b.id === tk.bookingId);
        add(
          {
            key: `booking:${tk.bookingId}`,
            kind: 'ticket',
            emoji: '🎟️',
            title: tk.label || tk.fileName || t('tickets.title'),
            subtitle: booking?.title,
            tab: 'bookings',
          },
          tk.fileName,
          booking?.title,
        );
      }
    }
    for (const e of expenses ?? [])
      add(
        {
          key: `expense:${e.id}`,
          kind: 'expense',
          emoji:
            e.emoji ??
            EXPENSE_CATEGORIES[e.category as keyof typeof EXPENSE_CATEGORIES]?.emoji ??
            '🧾',
          title: e.title,
          subtitle: `${longDate(e.date)} · ${money(e.amount, e.currency)}`,
          tab: 'expenses',
          view: 'list',
        },
        e.notes,
        categoryLabel(e.category as never, locale),
        ...e.payers.map((p) => names[p.memberId]),
      );
    for (const n of notes ?? [])
      add(
        {
          key: `note:${n.id}`,
          kind: 'note',
          emoji: '📝',
          title: n.title || n.content.slice(0, 60),
          subtitle: n.title ? n.content.slice(0, 80) : undefined,
          tab: 'notes',
        },
        n.content,
      );
    return out;
  }, [planData, expenses, notes, tickets, trip.members, trip.myMemberId, locale, t]);

  const words = normalizeText(query).split(' ').filter(Boolean);
  if (words.length === 0)
    return (
      <p className="px-2 py-10 text-center text-sm text-muted-foreground">{t('search.hint')}</p>
    );

  const found = items.filter((r) => words.every((w) => r.haystack.includes(w)));
  if (found.length === 0)
    return (
      <p className="px-2 py-10 text-center text-sm text-muted-foreground">
        {t('search.empty', { query: query.trim() })}
      </p>
    );
  return (
    <div className="grid grid-cols-1 gap-5 pb-8">
      {KIND_ORDER.map((kind) => {
        const group = found.filter((r) => r.kind === kind);
        if (group.length === 0) return null;
        return (
          <section key={kind}>
            <h3 className="mb-2 px-1 text-sm font-semibold">
              {t(`search.groups.${kind}`)}{' '}
              <span className="font-normal text-muted-foreground">{group.length}</span>
            </h3>
            <Card className="divide-y">
              {group.slice(0, PER_GROUP).map((r) => (
                <button
                  key={`${r.kind}-${r.key}`}
                  type="button"
                  onClick={() => onPick(r)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/50"
                >
                  <span className="text-xl">{r.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{r.title}</span>
                    {r.subtitle && (
                      <span className="block truncate text-sm text-muted-foreground">
                        {r.subtitle}
                      </span>
                    )}
                  </span>
                </button>
              ))}
              {group.length > PER_GROUP && (
                <p className="px-4 py-2 text-xs text-muted-foreground">
                  {t('search.more', { count: group.length - PER_GROUP })}
                </p>
              )}
            </Card>
          </section>
        );
      })}
    </div>
  );
}
