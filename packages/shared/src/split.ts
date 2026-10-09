/**
 * Logica di divisione delle spese e di semplificazione dei debiti.
 * Tutti gli importi sono interi in unità minori della valuta del viaggio.
 */

export type MemberId = string;

/**
 * Distribuisce `total` in parti proporzionali ai `weights`, con il metodo dei resti più grandi.
 * La somma del risultato è sempre esattamente `total`. A parità di resto vince l'ordine di input,
 * così il risultato è deterministico.
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  if (!Number.isInteger(total)) throw new Error('total must be an integer');
  if (weights.length === 0) throw new Error('weights must not be empty');
  if (weights.some((w) => w < 0 || !Number.isFinite(w))) throw new Error('invalid weight');
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) throw new Error('weights must not all be zero');

  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const exact = weights.map((w) => (abs * w) / sum);
  const base = exact.map((x) => Math.floor(x));
  let remainder = abs - base.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    base[i]! += 1;
    remainder -= 1;
  }
  return base.map((x) => (x === 0 ? 0 : x * sign));
}

export type SplitInput =
  | { method: 'equal'; members: readonly MemberId[] }
  | { method: 'shares'; shares: Readonly<Record<MemberId, number>> }
  | { method: 'percent'; percents: Readonly<Record<MemberId, number>> }
  | { method: 'exact'; amounts: Readonly<Record<MemberId, number>> };

/** Calcola la quota di ciascun membro per una spesa di importo `total`. */
export function computeShares(total: number, split: SplitInput): Record<MemberId, number> {
  switch (split.method) {
    case 'equal': {
      if (split.members.length === 0) throw new Error('no members');
      const parts = allocate(
        total,
        split.members.map(() => 1),
      );
      return Object.fromEntries(split.members.map((m, i) => [m, parts[i]!]));
    }
    case 'shares': {
      const ids = Object.keys(split.shares);
      const parts = allocate(
        total,
        ids.map((id) => split.shares[id]!),
      );
      return Object.fromEntries(ids.map((m, i) => [m, parts[i]!]));
    }
    case 'percent': {
      const ids = Object.keys(split.percents);
      const sum = ids.reduce((a, id) => a + split.percents[id]!, 0);
      if (Math.abs(sum - 100) > 1e-6) throw new Error('percentages must sum to 100');
      const parts = allocate(
        total,
        ids.map((id) => split.percents[id]!),
      );
      return Object.fromEntries(ids.map((m, i) => [m, parts[i]!]));
    }
    case 'exact': {
      const sum = Object.values(split.amounts).reduce((a, b) => a + b, 0);
      if (sum !== total) throw new Error('exact amounts must sum to the total');
      return { ...split.amounts };
    }
  }
}

export interface LedgerExpense {
  /** Quanto ha pagato ciascuno. */
  paid: Readonly<Record<MemberId, number>>;
  /** Quanto spetta a ciascuno. */
  owed: Readonly<Record<MemberId, number>>;
}

export interface LedgerSettlement {
  from: MemberId;
  to: MemberId;
  amount: number;
}

/**
 * Saldo netto per membro: positivo = deve ricevere, negativo = deve dare.
 * La somma di tutti i saldi è sempre 0.
 */
export function computeBalances(
  expenses: readonly LedgerExpense[],
  settlements: readonly LedgerSettlement[] = [],
): Record<MemberId, number> {
  const balances: Record<MemberId, number> = {};
  const add = (id: MemberId, delta: number) => {
    balances[id] = (balances[id] ?? 0) + delta;
  };
  for (const e of expenses) {
    for (const [id, amount] of Object.entries(e.paid)) add(id, amount);
    for (const [id, amount] of Object.entries(e.owed)) add(id, -amount);
  }
  for (const s of settlements) {
    add(s.from, s.amount);
    add(s.to, -s.amount);
  }
  return balances;
}

/**
 * Propone i trasferimenti per azzerare i saldi con pochi movimenti: abbina ogni volta chi deve
 * di più con chi deve ricevere di più. Al massimo n-1 trasferimenti.
 */
export function simplifyDebts(balances: Readonly<Record<MemberId, number>>): LedgerSettlement[] {
  const creditors = Object.entries(balances)
    .filter(([, v]) => v > 0)
    .map(([id, v]) => ({ id, v }));
  const debtors = Object.entries(balances)
    .filter(([, v]) => v < 0)
    .map(([id, v]) => ({ id, v: -v }));
  const byAmount = (a: { id: string; v: number }, b: { id: string; v: number }) =>
    b.v - a.v || a.id.localeCompare(b.id);
  const result: LedgerSettlement[] = [];
  creditors.sort(byAmount);
  debtors.sort(byAmount);
  while (creditors.length > 0 && debtors.length > 0) {
    const c = creditors[0]!;
    const d = debtors[0]!;
    const amount = Math.min(c.v, d.v);
    result.push({ from: d.id, to: c.id, amount });
    c.v -= amount;
    d.v -= amount;
    if (c.v === 0) creditors.shift();
    if (d.v === 0) debtors.shift();
    creditors.sort(byAmount);
    debtors.sort(byAmount);
  }
  return result;
}
