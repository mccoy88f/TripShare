import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Camera, Loader2, Shield, Smile, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  CURRENCIES,
  CURRENCY_CODES,
  LOCALES,
  normalizePaypalMe,
  type CurrencyCode,
  type Locale,
} from '@tripshare/shared';
import { AiKeysCard } from '@/components/ai-keys';
import { useMe } from '@/components/layouts/app-layout';
import { UserAvatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmojiPicker } from '@/components/ui/emoji-picker';
import { Field, Input, Select } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { applyTheme, type Theme } from '@/lib/theme';
import { useTRPC } from '@/lib/trpc';
import { uploadImage } from '@/lib/upload';
import { cn } from '@/lib/utils';
import { PushCard } from '@/components/push-card';

const COLORS = [
  '#fde68a',
  '#fecaca',
  '#fbcfe8',
  '#ddd6fe',
  '#bfdbfe',
  '#a5f3fc',
  '#bbf7d0',
  '#d9f99d',
  '#fed7aa',
  '#e2e8f0',
];
const LANGUAGE_NAMES: Record<Locale, string> = { it: 'Italiano', en: 'English' };

export function ProfilePage() {
  const { t, i18n } = useTranslation();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const [form, setForm] = useState({
    name: '',
    avatarEmoji: null as string | null,
    avatarColor: null as string | null,
    locale: 'it' as Locale,
    defaultCurrency: 'EUR' as CurrencyCode,
    theme: 'system' as Theme,
    paypalMe: '',
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const refreshMe = () => queryClient.invalidateQueries({ queryKey: trpc.me.get.queryKey() });
  const removePhoto = useMutation(trpc.me.removeAvatar.mutationOptions({ onSuccess: refreshMe }));
  const onPhoto = async (file: File) => {
    setUploading(true);
    try {
      await uploadImage('/api/me/avatar', file);
      await refreshMe();
      toast.success(t('common.saved'));
    } catch (err) {
      toast.error(
        err instanceof Error && err.message === 'FILE_TOO_LARGE'
          ? t('profile.photoTooLarge')
          : t('trip.form.photoError'),
      );
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    if (!me) return;
    setForm({
      name: me.name,
      avatarEmoji: me.avatarEmoji,
      avatarColor: me.avatarColor,
      locale: me.locale as Locale,
      defaultCurrency: me.defaultCurrency as CurrencyCode,
      theme: me.theme as Theme,
      paypalMe: me.paypalMe ?? '',
    });
  }, [me]);

  const save = useMutation(
    trpc.me.update.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.me.get.queryKey() });
        await i18n.changeLanguage(form.locale);
        applyTheme(form.theme);
        toast.success(t('common.saved'));
      },
      onError: () => toast.error(t('common.error')),
    }),
  );

  if (!me) return <Loader2 className="mx-auto mt-20 animate-spin text-muted-foreground" />;

  const paypalInvalid = form.paypalMe.trim() !== '' && !normalizePaypalMe(form.paypalMe);
  const preview = {
    name: form.name || me.name,
    image: me.image,
    avatarEmoji: form.avatarEmoji,
    avatarColor: form.avatarColor,
  };

  return (
    <div className="grid grid-cols-1 gap-6">
      <form
        className="grid grid-cols-1 gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (paypalInvalid) return;
          save.mutate({ ...form, name: form.name.trim(), paypalMe: form.paypalMe.trim() });
        }}
      >
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('profile.title')}</h1>
          <p className="mt-1 text-muted-foreground">{t('profile.subtitle')}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t('profile.avatar')}</CardTitle>
            <CardDescription>{t('profile.avatarHint')}</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-5">
            <div className="flex flex-wrap items-center gap-5">
              <UserAvatar user={preview} size="xl" className="shadow-lg" />
              <div className="grid grid-cols-1 gap-3">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={uploading}
                    onClick={() => photoInput.current?.click()}
                  >
                    {uploading ? <Loader2 className="animate-spin" /> : <Camera />}
                    {me.image ? t('profile.changePhoto') : t('profile.uploadPhoto')}
                  </Button>
                  {me.image && (
                    <Button type="button" variant="ghost" onClick={() => removePhoto.mutate()}>
                      <Trash2 />
                      {t('profile.removePhoto')}
                    </Button>
                  )}
                  <input
                    ref={photoInput}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void onPhoto(f);
                      e.target.value = '';
                    }}
                  />
                  <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button type="button" variant="outline">
                        <Smile />
                        {t('profile.chooseEmoji')}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent>
                      <EmojiPicker
                        onSelect={(emoji) => {
                          setForm({ ...form, avatarEmoji: emoji });
                          setPickerOpen(false);
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                  {form.avatarEmoji && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setForm({ ...form, avatarEmoji: null })}
                    >
                      {t('profile.removeEmoji')}
                    </Button>
                  )}
                </div>
                <div
                  className="flex flex-wrap gap-2"
                  role="radiogroup"
                  aria-label={t('profile.color')}
                >
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={form.avatarColor === c}
                      onClick={() => setForm({ ...form, avatarColor: c })}
                      className={cn(
                        'size-8 rounded-full ring-offset-2 ring-offset-card transition hover:scale-110',
                        form.avatarColor === c && 'ring-2 ring-primary',
                      )}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <Field label={t('auth.name')} htmlFor="name">
              <Input
                id="name"
                required
                maxLength={80}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('profile.preferences')}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label={t('common.language')} htmlFor="locale">
              <Select
                id="locale"
                value={form.locale}
                onChange={(e) => setForm({ ...form, locale: e.target.value as Locale })}
              >
                {LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {LANGUAGE_NAMES[l]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t('auth.defaultCurrency')}
              htmlFor="currency"
              hint={t('profile.currencyHint')}
            >
              <Select
                id="currency"
                value={form.defaultCurrency}
                onChange={(e) =>
                  setForm({ ...form, defaultCurrency: e.target.value as CurrencyCode })
                }
              >
                {CURRENCY_CODES.map((c) => (
                  <option key={c} value={c}>
                    {c} · {CURRENCIES[c].symbol}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('common.theme')} htmlFor="theme">
              <Select
                id="theme"
                value={form.theme}
                onChange={(e) => setForm({ ...form, theme: e.target.value as Theme })}
              >
                {(['system', 'light', 'dark'] as const).map((th) => (
                  <option key={th} value={th}>
                    {t(`common.themes.${th}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>💸 {t('profile.payments')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Field
              label={t('profile.paypalMe')}
              htmlFor="paypal"
              hint={t('profile.paypalHint')}
              error={paypalInvalid ? t('profile.paypalInvalid') : undefined}
            >
              <div className="flex items-center rounded-md border border-input bg-card focus-within:border-ring focus-within:ring-4 focus-within:ring-ring/20">
                <span className="pl-3.5 text-[15px] text-muted-foreground">paypal.me/</span>
                <input
                  id="paypal"
                  className="h-11 min-w-0 flex-1 bg-transparent pr-3.5 text-[15px] outline-none"
                  value={form.paypalMe}
                  aria-invalid={paypalInvalid}
                  onChange={(e) => setForm({ ...form, paypalMe: e.target.value })}
                />
              </div>
            </Field>
          </CardContent>
        </Card>

        <div className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] flex justify-end lg:static">
          <Button
            type="submit"
            size="lg"
            disabled={save.isPending || paypalInvalid}
            className="shadow-lg"
          >
            {save.isPending && <Loader2 className="animate-spin" />}
            {t('common.save')}
          </Button>
        </div>
      </form>
      <PushCard />
      <AiKeysCard />
      {me.role === 'superadmin' && (
        <Button asChild variant="outline" size="lg" className="w-full">
          <Link to="/app/admin">
            <Shield />
            {t('profile.goAdmin')}
          </Link>
        </Button>
      )}
    </div>
  );
}
