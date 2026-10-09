import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { CheckCircle2, Loader2, Mail, MailCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CURRENCY_CODES,
  CURRENCIES,
  DEFAULT_CURRENCY,
  type CurrencyCode,
  type Locale,
} from '@tripshare/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { authClient, signIn, signUp } from '@/lib/auth-client';
import { authErrorMessage } from '@/lib/auth-errors';

function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  );
}

function SuccessBox({
  icon: Icon = MailCheck,
  title,
  text,
}: {
  icon?: typeof MailCheck;
  title?: string;
  text: string;
}) {
  return (
    <div className="grid justify-items-center gap-3 py-4 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-success/15 text-success">
        <Icon className="size-7" />
      </span>
      {title && <p className="text-lg font-semibold">{title}</p>}
      <p className="text-muted-foreground">{text}</p>
    </div>
  );
}

function guessCurrency(): CurrencyCode {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    const byRegion: Record<string, CurrencyCode> = {
      GB: 'GBP',
      US: 'USD',
      CH: 'CHF',
      CA: 'CAD',
      AU: 'AUD',
      JP: 'JPY',
      SE: 'SEK',
      NO: 'NOK',
      DK: 'DKK',
      PL: 'PLN',
      CZ: 'CZK',
    };
    return (region && byRegion[region]) || DEFAULT_CURRENCY;
  } catch {
    return DEFAULT_CURRENCY;
  }
}

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { redirect?: string };
  const [mode, setMode] = useState<'password' | 'magic'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [magicSent, setMagicSent] = useState(false);
  const [pending, setPending] = useState(false);
  const target = search.redirect?.startsWith('/') ? search.redirect : '/app';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    if (mode === 'password') {
      const { error } = await signIn.email({ email, password, callbackURL: target });
      setPending(false);
      if (error) return setError(authErrorMessage(t, error));
      await navigate({ to: target });
    } else {
      const { error } = await signIn.magicLink({ email, callbackURL: target });
      setPending(false);
      // Per non rivelare se l'indirizzo esiste, il messaggio è lo stesso in ogni caso.
      if (error && error.status !== 400 && error.status !== 404)
        return setError(authErrorMessage(t, error));
      setMagicSent(true);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">{t('auth.signInTitle')}</CardTitle>
        <CardDescription>{t('auth.signInSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        {magicSent ? (
          <SuccessBox text={t('auth.magicLinkSent')} />
        ) : (
          <form onSubmit={submit} className="grid gap-4">
            <Field label={t('auth.email')} htmlFor="email">
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            {mode === 'password' && (
              <Field
                label={
                  <span className="flex items-center justify-between">
                    {t('auth.password')}
                    <Link
                      to="/forgot-password"
                      className="text-sm font-normal text-primary hover:underline"
                    >
                      {t('auth.forgot')}
                    </Link>
                  </span>
                }
                htmlFor="password"
              >
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
            )}
            <ErrorBox message={error} />
            <Button type="submit" disabled={pending} className="mt-1">
              {pending && <Loader2 className="animate-spin" />}
              {mode === 'password' ? t('auth.signInButton') : t('auth.magicLink')}
            </Button>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              {t('common.or')}
              <span className="h-px flex-1 bg-border" />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setMode(mode === 'password' ? 'magic' : 'password')}
            >
              <Mail />
              {mode === 'password' ? t('auth.magicLink') : t('auth.usePassword')}
            </Button>
          </form>
        )}
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t('auth.noAccount')}{' '}
          <Link to="/signup" className="font-semibold text-primary hover:underline">
            {t('nav.signUp')}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

export function SignupPage() {
  const { t, i18n } = useTranslation();
  const search = useSearch({ strict: false }) as { invite?: string; email?: string };
  const [form, setForm] = useState({
    name: '',
    email: search.email ?? '',
    password: '',
    currency: guessCurrency(),
  });
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    const { error } = await signUp.email({
      name: form.name.trim(),
      email: form.email.trim(),
      password: form.password,
      locale: (i18n.resolvedLanguage ?? 'it') as Locale,
      defaultCurrency: form.currency,
      // Dopo la conferma dell'email si torna all'invito, per entrare nel viaggio.
      callbackURL: search.invite ? `/invite/${search.invite}` : '/app?verified=1',
      fetchOptions: search.invite ? { headers: { 'x-invite-token': search.invite } } : undefined,
    });
    setPending(false);
    if (error) return setError(authErrorMessage(t, error));
    setSentTo(form.email.trim());
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">
          {sentTo ? t('auth.checkEmailTitle') : t('auth.signUpTitle')}
        </CardTitle>
        {!sentTo && <CardDescription>{t('auth.signUpSubtitle')}</CardDescription>}
      </CardHeader>
      <CardContent>
        {sentTo ? (
          <SuccessBox text={t('auth.checkEmailText', { email: sentTo })} />
        ) : (
          <form onSubmit={submit} className="grid gap-4">
            <Field label={t('auth.name')} htmlFor="name">
              <Input
                id="name"
                autoComplete="given-name"
                required
                maxLength={80}
                value={form.name}
                onChange={set('name')}
              />
            </Field>
            <Field label={t('auth.email')} htmlFor="email">
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={form.email}
                onChange={set('email')}
              />
            </Field>
            <Field label={t('auth.password')} htmlFor="password" hint={t('auth.passwordHint')}>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={form.password}
                onChange={set('password')}
              />
            </Field>
            <Field label={t('auth.defaultCurrency')} htmlFor="currency">
              <Select id="currency" value={form.currency} onChange={set('currency')}>
                {CURRENCY_CODES.map((c) => (
                  <option key={c} value={c}>
                    {c} · {CURRENCIES[c].symbol}
                  </option>
                ))}
              </Select>
            </Field>
            <ErrorBox message={error} />
            <Button type="submit" variant="accent" disabled={pending} className="mt-1">
              {pending && <Loader2 className="animate-spin" />}
              {t('auth.signUpButton')}
            </Button>
          </form>
        )}
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t('auth.haveAccount')}{' '}
          <Link
            to="/login"
            search={search.invite ? { redirect: `/invite/${search.invite}` } : {}}
            className="font-semibold text-primary hover:underline"
          >
            {t('nav.signIn')}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: `${location.origin}/reset-password`,
    });
    setPending(false);
    if (error && error.status === 429) return setError(authErrorMessage(t, error));
    setSent(true);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">{t('auth.forgotTitle')}</CardTitle>
        {!sent && <CardDescription>{t('auth.forgotSubtitle')}</CardDescription>}
      </CardHeader>
      <CardContent>
        {sent ? (
          <SuccessBox text={t('auth.forgotSent')} />
        ) : (
          <form onSubmit={submit} className="grid gap-4">
            <Field label={t('auth.email')} htmlFor="email">
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <ErrorBox message={error} />
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              {t('auth.forgotButton')}
            </Button>
          </form>
        )}
        <p className="mt-6 text-center text-sm">
          <Link to="/login" className="font-semibold text-primary hover:underline">
            {t('common.back')}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const search = useSearch({ strict: false }) as { token?: string; error?: string };
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(search.error ? t('auth.resetInvalid') : null);
  const [pending, setPending] = useState(false);
  const invalid = !search.token || !!search.error;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    const { error } = await authClient.resetPassword({
      newPassword: password,
      token: search.token!,
    });
    setPending(false);
    if (error)
      return setError(
        error.code === 'INVALID_TOKEN' ? t('auth.resetInvalid') : authErrorMessage(t, error),
      );
    setDone(true);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">{t('auth.resetTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        {done ? (
          <>
            <SuccessBox icon={CheckCircle2} text={t('auth.resetDone')} />
            <Button asChild className="w-full">
              <Link to="/login">{t('nav.signIn')}</Link>
            </Button>
          </>
        ) : invalid ? (
          <>
            <ErrorBox message={t('auth.resetInvalid')} />
            <Button asChild variant="outline" className="mt-4 w-full">
              <Link to="/forgot-password">{t('auth.forgotButton')}</Link>
            </Button>
          </>
        ) : (
          <form onSubmit={submit} className="grid gap-4">
            <Field label={t('auth.newPassword')} htmlFor="password" hint={t('auth.passwordHint')}>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <ErrorBox message={error} />
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              {t('auth.resetButton')}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
