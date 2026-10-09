import { Camera, ImageIcon, Loader2, Smile, Trash2 } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CURRENCIES, CURRENCY_CODES, type CurrencyCode } from '@tripshare/shared';
import { COVER_GRADIENTS, DEFAULT_COVER, TripCover } from '@/components/trip-cover';
import { Button } from '@/components/ui/button';
import {
  UnsplashPicker,
  useUnsplashEnabled,
  type UnsplashPick,
} from '@/components/unsplash-picker';
import { EmojiPicker } from '@/components/ui/emoji-picker';
import { Field, Input, Select } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface TripFormValues {
  title: string;
  emoji: string | null;
  destination: string;
  description: string;
  startDate: string;
  endDate: string;
  currency: CurrencyCode;
  coverColor: string;
}

export function TripForm({
  initial,
  coverImage,
  currencyLocked,
  submitLabel,
  pending,
  onSubmit,
  onRemoveCover,
}: {
  initial: TripFormValues;
  coverImage?: string | null;
  currencyLocked?: boolean;
  submitLabel: string;
  pending?: boolean;
  /** `unsplash`: foto scelta su Unsplash, da impostare dopo il salvataggio. */
  onSubmit: (values: TripFormValues, coverFile: File | null, unsplash: UnsplashPick | null) => void;
  onRemoveCover?: () => void;
}) {
  const { t } = useTranslation();
  const [v, setV] = useState(initial);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [unsplash, setUnsplash] = useState<UnsplashPick | null>(null);
  const [searching, setSearching] = useState(false);
  const unsplashEnabled = useUnsplashEnabled();
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const set = <K extends keyof TripFormValues>(k: K, value: TripFormValues[K]) =>
    setV((prev) => ({ ...prev, [k]: value }));
  const shownImage = preview ?? coverImage ?? null;
  const datesInvalid = !!v.startDate && !!v.endDate && v.endDate < v.startDate;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (datesInvalid) return;
    onSubmit({ ...v, title: v.title.trim() }, file, unsplash);
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-6">
      <div>
        <TripCover
          coverImage={shownImage}
          coverColor={v.coverColor}
          className="h-44 rounded-xl sm:h-56"
        >
          <div className="flex h-full flex-col justify-end p-5">
            <p className="text-3xl font-bold drop-shadow-sm">
              {v.emoji ? `${v.emoji} ` : ''}
              {v.title || t('trip.form.titlePlaceholder')}
            </p>
            {v.destination && <p className="text-white/85">{v.destination}</p>}
          </div>
          <div className="absolute top-3 right-3 flex gap-2">
            <Button
              type="button"
              size="sm"
              className="bg-white/90 text-slate-900 hover:bg-white"
              onClick={() => fileInput.current?.click()}
            >
              <Camera />
              {shownImage ? t('trip.form.changePhoto') : t('trip.form.addPhoto')}
            </Button>
            {unsplashEnabled && (
              <Button
                type="button"
                size="sm"
                className="bg-white/90 text-slate-900 hover:bg-white"
                onClick={() => setSearching(true)}
              >
                <ImageIcon />
                {t('unsplash.button')}
              </Button>
            )}
            {shownImage && (
              <Button
                type="button"
                size="icon"
                className="size-9 bg-white/90 text-slate-900 hover:bg-white"
                aria-label={t('trip.form.removePhoto')}
                onClick={() => {
                  if (preview) {
                    setPreview(null);
                    setFile(null);
                    setUnsplash(null);
                  } else onRemoveCover?.();
                }}
              >
                <Trash2 />
              </Button>
            )}
          </div>
        </TripCover>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setFile(f);
            setUnsplash(null);
            setPreview(URL.createObjectURL(f));
            e.target.value = '';
          }}
        />
        {unsplash && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            {t('unsplash.photoBy')} {unsplash.author} · Unsplash
          </p>
        )}
        {searching && (
          <UnsplashPicker
            open
            initialQuery={v.destination || v.title}
            onOpenChange={setSearching}
            onPick={(photo) => {
              setUnsplash(photo);
              setFile(null);
              setPreview(photo.thumb);
            }}
          />
        )}
        {!shownImage && (
          <div
            className="mt-3 flex flex-wrap gap-2"
            role="radiogroup"
            aria-label={t('trip.form.color')}
          >
            {Object.entries(COVER_GRADIENTS).map(([key, bg]) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={v.coverColor === key}
                onClick={() => set('coverColor', key)}
                className={cn(
                  'size-9 rounded-full ring-offset-2 ring-offset-background transition hover:scale-110',
                  v.coverColor === key && 'ring-2 ring-primary',
                )}
                style={{ background: bg }}
              />
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[auto_1fr]">
        <Field label="Emoji">
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full rounded-md text-xl sm:w-16"
              >
                {v.emoji ?? <Smile className="text-muted-foreground" />}
              </Button>
            </PopoverTrigger>
            <PopoverContent>
              <EmojiPicker
                onSelect={(emoji) => {
                  set('emoji', emoji);
                  setPickerOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
        </Field>
        <Field label={t('trip.form.title')} htmlFor="trip-title">
          <Input
            id="trip-title"
            required
            maxLength={120}
            placeholder={t('trip.form.titlePlaceholder')}
            value={v.title}
            onChange={(e) => set('title', e.target.value)}
          />
        </Field>
      </div>
      <Field label={t('trip.form.destination')} htmlFor="trip-dest">
        <Input
          id="trip-dest"
          maxLength={120}
          placeholder={t('trip.form.destinationPlaceholder')}
          value={v.destination}
          onChange={(e) => set('destination', e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label={t('trip.form.start')} htmlFor="trip-start">
          <Input
            id="trip-start"
            type="date"
            value={v.startDate}
            onChange={(e) => set('startDate', e.target.value)}
          />
        </Field>
        <Field
          label={t('trip.form.end')}
          htmlFor="trip-end"
          error={datesInvalid ? t('trip.form.endBeforeStart') : undefined}
        >
          <Input
            id="trip-end"
            type="date"
            min={v.startDate || undefined}
            value={v.endDate}
            onChange={(e) => set('endDate', e.target.value)}
          />
        </Field>
        <Field
          label={t('trip.form.currency')}
          htmlFor="trip-cur"
          hint={currencyLocked ? t('trip.form.currencyLocked') : t('trip.form.currencyHint')}
        >
          <Select
            id="trip-cur"
            disabled={currencyLocked}
            value={v.currency}
            onChange={(e) => set('currency', e.target.value as CurrencyCode)}
          >
            {CURRENCY_CODES.map((c) => (
              <option key={c} value={c}>
                {c} · {CURRENCIES[c].symbol}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t('trip.form.description')} htmlFor="trip-desc">
        <textarea
          id="trip-desc"
          rows={3}
          maxLength={1000}
          className="w-full rounded-md border border-input bg-card px-3.5 py-2.5 text-[15px] outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/20"
          value={v.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </Field>
      <Button
        type="submit"
        size="lg"
        variant="accent"
        disabled={pending || datesInvalid || !v.title.trim()}
        className="justify-self-end"
      >
        {pending && <Loader2 className="animate-spin" />}
        {submitLabel}
      </Button>
    </form>
  );
}

export const emptyTripForm = (currency: CurrencyCode): TripFormValues => ({
  title: '',
  emoji: null,
  destination: '',
  description: '',
  startDate: '',
  endDate: '',
  currency,
  coverColor: DEFAULT_COVER,
});

/** Converte i valori del modulo nell'input dell'API. */
export function toTripInput(v: TripFormValues) {
  return {
    title: v.title,
    emoji: v.emoji,
    destination: v.destination.trim() || null,
    description: v.description.trim() || null,
    startDate: v.startDate || null,
    endDate: v.endDate || null,
    currency: v.currency,
    coverColor: v.coverColor,
  };
}
