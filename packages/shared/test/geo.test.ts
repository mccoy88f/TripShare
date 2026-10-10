import { describe, expect, it } from 'vitest';
import { distributeNights, haversineKm, nightsBetween, orderStops } from '../src/geo.js';

const messina = { lat: 38.19, lon: 15.55 };
const palermo = { lat: 38.12, lon: 13.36 };
const roma = { lat: 41.9, lon: 12.5 };
const napoli = { lat: 40.85, lon: 14.27 };

describe('geo', () => {
  it('measures distances in km', () => {
    expect(haversineKm(messina, palermo)).toBeGreaterThan(180);
    expect(haversineKm(messina, palermo)).toBeLessThan(220);
    expect(haversineKm(roma, roma)).toBe(0);
  });

  it('visits Palermo before Rome when leaving from Messina', () => {
    // L'ordine inserito dall'utente (Roma, Palermo) è più lungo e viene corretto.
    const r = orderStops(messina, [
      { ...roma, label: 'Roma' },
      { ...palermo, label: 'Palermo' },
    ]);
    expect(r.order.map((s) => s.label)).toEqual(['Palermo', 'Roma']);
    expect(r.legsKm).toHaveLength(3);
    expect(r.totalKm).toBeCloseTo(r.legsKm.reduce((a, b) => a + b, 0));
  });

  it('keeps the entered order on ties and handles 0 or 1 stops', () => {
    expect(orderStops(messina, []).order).toEqual([]);
    const one = orderStops(messina, [{ ...roma, label: 'Roma' }]);
    expect(one.order).toHaveLength(1);
    expect(one.legsKm).toHaveLength(2);
  });

  it('ends in a different return point when given', () => {
    // Partenza Messina, rientro a Roma: Napoli e Palermo → Palermo, Napoli (poi Roma).
    const r = orderStops(
      messina,
      [
        { ...napoli, label: 'Napoli' },
        { ...palermo, label: 'Palermo' },
      ],
      roma,
    );
    expect(r.order.map((s) => s.label)).toEqual(['Palermo', 'Napoli']);
  });

  it('orders up to 8 stops and refuses more', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      lat: 40 + i * 0.3,
      lon: 10 + (i % 3),
      id: i,
    }));
    expect(orderStops({ lat: 40, lon: 10 }, many).order).toHaveLength(8);
    expect(() => orderStops({ lat: 40, lon: 10 }, [...many, { lat: 1, lon: 1, id: 9 }])).toThrow();
  });

  it('distributes nights with the leftovers to the first stops', () => {
    expect(distributeNights(7, 3)).toEqual([3, 2, 2]);
    expect(distributeNights(2, 3)).toEqual([1, 1, 0]);
    expect(distributeNights(5, 0)).toEqual([]);
    expect(nightsBetween('2026-10-12', '2026-10-16')).toBe(4);
    expect(nightsBetween('2026-10-16', '2026-10-12')).toBe(0);
  });
});
