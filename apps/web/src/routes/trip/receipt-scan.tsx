import { Camera, Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  allocate,
  isCurrencyCode,
  toMinor,
  type CurrencyCode,
  type ExpenseCategory,
} from '@tripshare/shared';
import { UserAvatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { uploadAiFile, useAiStatus, useAiTask } from '@/lib/ai';
import { money } from '@/lib/format';
import type { TripDetail, TripMemberT } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface ReceiptResult {
  title: string;
  merchant?: string;
  date?: string;
  total: number;
  currency: string;
  category: ExpenseCategory;
  emoji: string;
  items: { name: string; quantity?: number; amount: number }[];
  tax?: number;
  tip?: number;
  confidence: 'high' | 'medium' | 'low';
  notes?: string;
}

export interface ReceiptItem {
  name: string;
  amount: number;
  members: string[];
}

/** Pulsante "Leggi scontrino": foto o PDF → lettura con l'AI. */
export function ReceiptScanButton({
  trip,
  onResult,
}: {
  trip: TripDetail;
  onResult: (result: ReceiptResult, file: string) => void;
}) {
  const { t } = useTranslation();
  const status = useAiStatus();
  const { run, running } = useAiTask();
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  if (!status.data?.available) return null;
  const busy = uploading || running;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    let uploaded: { file: string; mime: string };
    try {
      uploaded = await uploadAiFile(trip.id, file);
    } catch (err) {
      toast.error(
        t(`tickets.errors.${(err as Error).message}`, { defaultValue: t('common.error') }),
      );
      return;
    } finally {
      setUploading(false);
    }
    const result = await run<ReceiptResult>(trip.id, {
      kind: 'receipt',
      file: uploaded.file,
      mime: uploaded.mime,
      tripCurrency: trip.currency as CurrencyCode,
    });
    if (result) {
      onResult(result, uploaded.file);
      if (result.confidence === 'low') toast.warning(t('ai.receipt.lowConfidence'));
      else toast.success(t('ai.receipt.read'));
    }
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <Button
        type="button"
        variant="outline"
        className="w-full border-dashed"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Camera />}
        {busy ? t('ai.receipt.reading') : t('ai.receipt.scan')}
      </Button>
    </>
  );
}

/** Righe dello scontrino in unità minori (con sconti negativi). */
export function receiptItems(result: ReceiptResult, members: string[]): ReceiptItem[] {
  const currency = isCurrencyCode(result.currency) ? result.currency : 'EUR';
  return result.items
    .map((i) => ({ name: i.name, amount: toMinor(i.amount, currency), members }))
    .filter((i) => i.amount !== 0);
}

/**
 * Divide il totale per voce: ogni riga va a chi l'ha presa; la differenza tra totale e righe
 * (servizio, mance, tasse non incluse) si ripartisce in proporzione.
 */
export function splitByItems(total: number, items: ReceiptItem[]): Record<string, number> | null {
  const owed: Record<string, number> = {};
  for (const item of items) {
    if (item.members.length === 0) return null;
    const parts = allocate(
      item.amount,
      item.members.map(() => 1),
    );
    item.members.forEach((m, i) => (owed[m] = (owed[m] ?? 0) + parts[i]!));
  }
  const ids = Object.keys(owed);
  const sum = ids.reduce((a, id) => a + owed[id]!, 0);
  if (ids.length === 0 || sum <= 0) return null;
  const rest = total - sum;
  if (rest !== 0) {
    const extra = allocate(
      rest,
      ids.map((id) => Math.max(owed[id]!, 0)),
    );
    ids.forEach((id, i) => (owed[id] = owed[id]! + extra[i]!));
  }
  return ids.some((id) => owed[id]! < 0) ? null : owed;
}

/** Assegnazione delle righe dello scontrino ai partecipanti. */
export function ItemSplit({
  items,
  members,
  currency,
  onChange,
}: {
  items: ReceiptItem[];
  members: TripMemberT[];
  currency: CurrencyCode;
  onChange: (items: ReceiptItem[]) => void;
}) {
  const { t } = useTranslation();
  const toggle = (index: number, id: string) =>
    onChange(
      items.map((item, i) =>
        i !== index
          ? item
          : {
              ...item,
              members: item.members.includes(id)
                ? item.members.filter((m) => m !== id)
                : [...item.members, id],
            },
      ),
    );
  return (
    <div className="grid grid-cols-1 gap-2">
      <p className="text-[13px] text-muted-foreground">{t('ai.receipt.itemsHint')}</p>
      <div className="divide-y rounded-xl border">
        {items.map((item, i) => (
          <div key={i} className="grid grid-cols-1 gap-1.5 px-3 py-2.5">
            <div className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
              <span className="tabular text-muted-foreground">{money(item.amount, currency)}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {members.map((m) => {
                const on = item.members.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggle(i, m.id)}
                    aria-pressed={on}
                    title={m.name}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border py-0.5 pr-2 pl-0.5 text-xs transition',
                      on ? 'border-primary bg-primary/10 text-primary' : 'opacity-50',
                    )}
                  >
                    <UserAvatar user={m} size="sm" className="size-5 text-[9px]" />
                    {m.name.split(' ')[0]}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
