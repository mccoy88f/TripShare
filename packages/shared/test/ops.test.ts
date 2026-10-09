import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyPlanOps,
  budgetContext,
  emptyPlan,
  normalizePlan,
  parseTripDocument,
  sortActivities,
  summarizeBudget,
  type TripDocument,
} from '../src/trip-format/index.js';

const example = (() => {
  const parsed = parseTripDocument(
    JSON.parse(readFileSync(new URL('../examples/scozia.trip.json', import.meta.url), 'utf8')),
  );
  if (!parsed.success) throw new Error('example invalid');
  return normalizePlan(parsed.data);
})();

describe('plan operations', () => {
  it('creates days from dates and adds sorted activities with generated ids', () => {
    const base = emptyPlan({
      title: 'Lisbona',
      currency: 'EUR',
      travelers: 2,
      language: 'it',
      startDate: '2026-11-01',
      endDate: '2026-11-03',
    });
    const doc = applyPlanOps(base, [
      { type: 'ensureDays', start: '2026-11-01', end: '2026-11-03' },
      {
        type: 'upsertActivity',
        date: '2026-11-01',
        activity: { time: '18:00', type: 'meal', title: 'Cena in Alfama' },
      },
      {
        type: 'upsertActivity',
        date: '2026-11-01',
        activity: { time: '09:30', type: 'visit', title: 'Torre di Belém' },
      },
      {
        type: 'upsertActivity',
        date: '2026-11-01',
        activity: { time: '09:30', type: 'visit', title: 'Torre di Belém' },
      },
    ]);
    expect(doc.days.map((d) => d.title)).toEqual(['Giorno 1', 'Giorno 2', 'Giorno 3']);
    expect(doc.days[0]!.activities.map((a) => a.id)).toEqual([
      'torre-di-belem',
      'torre-di-belem-2',
      'cena-in-alfama',
    ]);
  });

  it('updates and moves activities, keeping references consistent', () => {
    const doc = applyPlanOps(example, [
      {
        type: 'upsertActivity',
        date: '2026-10-14',
        activity: {
          id: 'd3-viaduct',
          time: '10:15',
          type: 'visit',
          title: 'Viadotto',
          placeIds: ['glenfinnan-viaduct'],
        },
      },
      { type: 'moveActivity', id: 'd3-lunch', date: '2026-10-15' },
    ]);
    const d3 = doc.days.find((d) => d.date === '2026-10-14')!;
    expect(d3.activities.find((a) => a.id === 'd3-viaduct')).toMatchObject({
      title: 'Viadotto',
      time: '10:15',
    });
    expect(d3.alternatives[0]!.replacesActivityIds).not.toContain('d3-lunch');
    expect(
      doc.days.find((d) => d.date === '2026-10-15')!.activities.some((a) => a.id === 'd3-lunch'),
    ).toBe(true);
  });

  it('removes references when deleting places and bookings', () => {
    const doc = applyPlanOps(example, [
      { type: 'deletePlace', id: 'urquhart-castle' },
      { type: 'deleteBooking', id: 'stay-waterfront' },
    ]);
    const all = doc.days.flatMap((d) => [
      ...d.activities,
      ...d.alternatives.flatMap((a) => a.activities),
    ]);
    expect(all.some((a) => a.placeIds.includes('urquhart-castle'))).toBe(false);
    expect(doc.days.some((d) => d.stayBookingId === 'stay-waterfront')).toBe(false);
    expect(doc.budget.find((b) => b.id === 'b-waterfront')!.bookingId).toBeUndefined();
  });

  it('applies an alternative and keeps the original plan as a new alternative', () => {
    const doc = applyPlanOps(example, [{ type: 'applyAlternative', id: 'd3-alt-steall' }]);
    const d3 = doc.days.find((d) => d.date === '2026-10-14')!;
    expect(d3.activities.map((a) => a.id)).toContain('d3-alt-hike');
    expect(d3.activities.map((a) => a.id)).not.toContain('d3-urquhart');
    expect(d3.alternatives).toHaveLength(1);
    expect(d3.alternatives[0]!.activities.map((a) => a.id)).toContain('d3-urquhart');
    // Si può tornare al piano originale.
    const back = applyPlanOps(doc, [{ type: 'applyAlternative', id: d3.alternatives[0]!.id }]);
    expect(back.days.find((d) => d.date === '2026-10-14')!.activities.map((a) => a.id)).toContain(
      'd3-urquhart',
    );
  });

  it('rejects operations that break the document', () => {
    expect(() =>
      applyPlanOps(example, [
        { type: 'upsertActivity', date: '2030-01-01', activity: { type: 'visit', title: 'X' } },
      ]),
    ).toThrow(/DAY_NOT_FOUND/);
    expect(() =>
      applyPlanOps(example, [
        {
          type: 'upsertActivity',
          date: '2026-10-12',
          activity: { type: 'visit', title: 'X', placeIds: ['nope'] },
        },
      ]),
    ).toThrow(/unknown place/);
  });

  it('sorts activities by time keeping untimed ones in place', () => {
    const a = (id: string, time?: string) => ({
      id,
      time,
      type: 'visit' as const,
      title: id,
      placeIds: [],
      warnings: [],
      tips: [],
      links: [],
    });
    expect(sortActivities([a('c', '12:00'), a('free'), a('b', '09:00')]).map((x) => x.id)).toEqual([
      'b',
      'c',
      'free',
    ]);
  });

  it('assigns ids to packing items', () => {
    expect(example.packing.every((p) => p.id)).toBe(true);
    expect(new Set(example.packing.map((p) => p.id)).size).toBe(example.packing.length);
  });
});

describe('budget', () => {
  it('converts and multiplies amounts in the trip currency', () => {
    const s = summarizeBudget(example as TripDocument, budgetContext(example));
    // Il castello di Edimburgo è escluso; le voci "pending" senza importo non contano.
    const line = (id: string) => s.lines.find((l) => l.item.id === id)!.total;
    expect(line('b-eta')).toBe(Math.round(20 * 4 * 1.16 * 100));
    expect(line('b-spires')).toBe(20300);
    expect(s.pendingWithoutAmount).toBe(2);
    expect(s.byCategory.lodging).toBe(20300 + 51000 + 26000);
    expect(s.total).toBe(s.byStatus.booked + s.byStatus.estimate);
    expect(s.missingRates).toEqual([]);
  });

  it('reports missing exchange rates', () => {
    const s = summarizeBudget(example, { ...budgetContext(example), rates: {} });
    expect(s.missingRates).toEqual(['GBP']);
  });
});
