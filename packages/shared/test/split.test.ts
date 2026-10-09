import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { allocate, computeBalances, computeShares, simplifyDebts } from '../src/split.js';

describe('allocate', () => {
  it('distributes the remainder deterministically', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(1000, [2, 1, 1])).toEqual([500, 250, 250]);
    expect(allocate(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
  });

  it('always sums to the total', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 12 }).filter((w) => w.some((x) => x > 0)),
        (total, weights) => {
          const parts = allocate(total, weights);
          expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
          parts.forEach((p, i) => {
            if (weights[i] === 0) expect(p).toBe(0);
          });
        },
      ),
    );
  });
});

describe('computeShares', () => {
  it('supports every split method', () => {
    expect(computeShares(1000, { method: 'equal', members: ['a', 'b', 'c'] })).toEqual({ a: 334, b: 333, c: 333 });
    expect(computeShares(1000, { method: 'shares', shares: { a: 2, b: 1, c: 1 } })).toEqual({ a: 500, b: 250, c: 250 });
    expect(computeShares(1000, { method: 'percent', percents: { a: 50, b: 50 } })).toEqual({ a: 500, b: 500 });
    expect(computeShares(1000, { method: 'exact', amounts: { a: 700, b: 300 } })).toEqual({ a: 700, b: 300 });
  });

  it('rejects inconsistent input', () => {
    expect(() => computeShares(1000, { method: 'percent', percents: { a: 60, b: 50 } })).toThrow();
    expect(() => computeShares(1000, { method: 'exact', amounts: { a: 1 } })).toThrow();
  });
});

describe('balances and simplification', () => {
  it('settles a simple trip', () => {
    const balances = computeBalances([
      { paid: { a: 3000 }, owed: computeShares(3000, { method: 'equal', members: ['a', 'b', 'c'] }) },
      { paid: { b: 600 }, owed: computeShares(600, { method: 'equal', members: ['a', 'b', 'c'] }) },
    ]);
    expect(balances).toEqual({ a: 1800, b: -600, c: -1200 });
    expect(simplifyDebts(balances)).toEqual([
      { from: 'c', to: 'a', amount: 1200 },
      { from: 'b', to: 'a', amount: 600 },
    ]);
  });

  it('balances always sum to zero and settlements clear them', () => {
    const member = fc.constantFrom('a', 'b', 'c', 'd', 'e');
    const expense = fc
      .record({
        payer: member,
        total: fc.integer({ min: 1, max: 500_000 }),
        members: fc.uniqueArray(member, { minLength: 1, maxLength: 5 }),
      })
      .map(({ payer, total, members }) => ({
        paid: { [payer]: total },
        owed: computeShares(total, { method: 'equal', members }),
      }));
    fc.assert(
      fc.property(fc.array(expense, { maxLength: 30 }), (expenses) => {
        const balances = computeBalances(expenses);
        expect(Object.values(balances).reduce((a, b) => a + b, 0)).toBe(0);
        const transfers = simplifyDebts(balances);
        const nonZero = Object.values(balances).filter((v) => v !== 0).length;
        expect(transfers.length).toBeLessThanOrEqual(Math.max(0, nonZero - 1));
        const after = computeBalances(expenses, transfers);
        expect(Object.values(after).every((v) => v === 0)).toBe(true);
      }),
    );
  });
});
