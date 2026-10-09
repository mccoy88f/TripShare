import { useTranslation } from 'react-i18next';
import {
  CURRENCIES,
  CURRENCY_CODES,
  isCurrencyCode,
  toMinor,
  type CurrencyCode,
} from '@tripshare/shared';
import type { Money } from '@tripshare/shared/trip-format';
import { Field, Input, Select } from '@/components/ui/input';

export const textareaClass =
  'w-full rounded-md border border-input bg-card px-3.5 py-2.5 text-[15px] outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/20';

/** Elenco di righe di testo (avvisi, consigli): una per riga. */
export function LinesField({
  label,
  value,
  onChange,
  hint,
  id,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  hint?: string;
  id: string;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <textarea
        id={id}
        rows={Math.max(2, value.length + 1)}
        className={textareaClass}
        value={value.join('\n')}
        onChange={(e) => onChange(e.target.value.split('\n'))}
      />
    </Field>
  );
}

export const cleanLines = (lines: string[]) => lines.map((l) => l.trim()).filter(Boolean);

/** Link nel formato "Titolo | https://…", uno per riga. */
export function parseLinks(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [title, url] = line.includes('|')
        ? line.split('|').map((x) => x.trim())
        : [line.replace(/^https?:\/\//, '').split('/')[0]!, line];
      return { title: (title || url || '').slice(0, 120), url: url ?? '' };
    })
    .filter((l) => /^https?:\/\//.test(l.url));
}
export const formatLinks = (links: { title: string; url: string }[]) =>
  links.map((l) => `${l.title} | ${l.url}`).join('\n');

export interface MoneyDraft {
  amount: string;
  currency: CurrencyCode;
  basis: Money['basis'];
  approximate: boolean;
  note: string;
}

export const moneyDraft = (m: Money | undefined, currency: CurrencyCode): MoneyDraft => ({
  amount: m ? String(m.amount) : '',
  currency: (m?.currency as CurrencyCode) ?? currency,
  basis: m?.basis ?? 'total',
  approximate: m?.approximate ?? false,
  note: m?.note ?? '',
});

export function moneyFromDraft(d: MoneyDraft): Money | undefined {
  const amount = Number(d.amount.replace(',', '.'));
  if (d.amount.trim() === '' || !Number.isFinite(amount) || amount < 0) return undefined;
  return {
    amount,
    currency: d.currency,
    basis: d.basis,
    approximate: d.approximate,
    ...(d.note.trim() ? { note: d.note.trim() } : {}),
  };
}

export function MoneyFields({
  value,
  onChange,
  idPrefix,
  label,
}: {
  value: MoneyDraft;
  onChange: (v: MoneyDraft) => void;
  idPrefix: string;
  label: string;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="grid grid-cols-1 gap-2">
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-[1fr_auto_auto] gap-2">
        <Input
          id={`${idPrefix}-amount`}
          inputMode="decimal"
          placeholder="0"
          value={value.amount}
          onChange={(e) => onChange({ ...value, amount: e.target.value })}
          aria-label={t('expense.amount')}
        />
        <Select
          className="w-24"
          value={value.currency}
          onChange={(e) => onChange({ ...value, currency: e.target.value as CurrencyCode })}
          aria-label={t('expense.currency')}
        >
          {CURRENCY_CODES.map((c) => (
            <option key={c} value={c}>
              {c} {CURRENCIES[c].symbol !== c ? CURRENCIES[c].symbol : ''}
            </option>
          ))}
        </Select>
        <Select
          className="w-36"
          value={value.basis}
          onChange={(e) => onChange({ ...value, basis: e.target.value as Money['basis'] })}
          aria-label={t('plan.money.basis')}
        >
          {(['total', 'per_person', 'per_night', 'per_day', 'per_vehicle'] as const).map((b) => (
            <option key={b} value={b}>
              {t(`plan.money.bases.${b}`)}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-[var(--primary)]"
            checked={value.approximate}
            onChange={(e) => onChange({ ...value, approximate: e.target.checked })}
          />
          {t('plan.money.approximate')}
        </label>
        <Input
          className="h-9 min-w-40 flex-1 text-sm"
          placeholder={t('plan.money.notePlaceholder')}
          value={value.note}
          onChange={(e) => onChange({ ...value, note: e.target.value })}
        />
      </div>
    </fieldset>
  );
}

export function moneyLabel(
  m: Money | undefined,
  t: (k: string, o?: Record<string, unknown>) => string,
  format: (minor: number, cur: string) => string,
) {
  if (!m) return '';
  const value =
    m.amount === 0
      ? t('plan.money.free')
      : format(toMinor(m.amount, isCurrencyCode(m.currency) ? m.currency : 'EUR'), m.currency);
  const basis = m.basis !== 'total' ? ` ${t(`plan.money.short.${m.basis}`)}` : '';
  return `${m.approximate ? '~ ' : ''}${value}${basis}`;
}
