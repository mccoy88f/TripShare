import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, RefreshCw, Send, X, XCircle } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useMe } from '@/components/layouts/app-layout';
import { ModelInfo, ModelPicker } from '@/components/model-picker';
import { UserAvatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';

type SettingsMap = Record<
  string,
  { secret: false; value: unknown } | { secret: true; set: boolean; preview: string | null }
>;

function useSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const query = useQuery(trpc.admin.settings.list.queryOptions());
  const mutation = useMutation(
    trpc.admin.settings.update.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.admin.settings.list.queryKey() });
        toast.success(t('common.saved'));
      },
      onError: (err) => toast.error(err.message || t('common.error')),
    }),
  );
  const settings = query.data as SettingsMap | undefined;
  const value = <T,>(key: string): T | undefined => {
    const s = settings?.[key];
    return s && !s.secret ? (s.value as T) : undefined;
  };
  return {
    settings,
    value,
    save: (key: string, v: unknown) => mutation.mutate({ key, value: v }),
    saving: mutation.isPending,
  };
}

export function AdminPage() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  if (me && me.role !== 'superadmin') {
    return <p className="mt-10 text-center text-muted-foreground">{t('admin.forbidden')}</p>;
  }
  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">🛡️ {t('admin.title')}</h1>
      <Tabs defaultValue="overview" className="mt-6">
        <TabsList>
          {(['overview', 'settings', 'ai', 'users', 'audit'] as const).map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {t(`admin.tabs.${tab}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview">
          <Overview />
        </TabsContent>
        <TabsContent value="settings">
          <GeneralSettings />
        </TabsContent>
        <TabsContent value="ai">
          <AiSettings />
        </TabsContent>
        <TabsContent value="users">
          <Users />
        </TabsContent>
        <TabsContent value="audit">
          <Audit />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatusRow({
  label,
  status,
}: {
  label: string;
  status: { ok: boolean; error?: string; ms: number };
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 py-2">
      {status.ok ? (
        <CheckCircle2 className="size-5 text-success" />
      ) : (
        <XCircle className="size-5 text-destructive" />
      )}
      <span className="flex-1 font-medium">{label}</span>
      {status.ok ? (
        <span className="tabular text-sm text-muted-foreground">{status.ms} ms</span>
      ) : (
        <span className="max-w-[60%] truncate text-sm text-destructive" title={status.error}>
          {t('admin.down')}: {status.error}
        </span>
      )}
    </div>
  );
}

function Overview() {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const { data } = useQuery(
    trpc.admin.system.status.queryOptions(undefined, { refetchInterval: 30_000 }),
  );
  const [to, setTo] = useState('');
  const testEmail = useMutation(
    trpc.admin.system.sendTestEmail.mutationOptions({
      onSuccess: (res) => toast.success(t('admin.testEmailSent', { to: res.to })),
      onError: (err) => toast.error(err.message),
    }),
  );
  if (!data) return <Loader2 className="mx-auto mt-10 animate-spin text-muted-foreground" />;
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t('admin.status')}</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <StatusRow label={t('admin.database')} status={data.services.database} />
          <StatusRow label={t('admin.redis')} status={data.services.redis} />
          <StatusRow label={t('admin.smtp')} status={data.services.smtp} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('admin.usersCount')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="tabular text-5xl font-bold">{data.users}</p>
          {data.emailQueue && (
            <div className="mt-6">
              <p className="text-sm font-medium">{t('admin.emailQueue')}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {Object.entries(data.emailQueue).map(([k, v]) => (
                  <Badge key={k} variant={k === 'failed' && v > 0 ? 'destructive' : 'outline'}>
                    {v} {t(`admin.queue.${k}`)}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          <p className="mt-6 text-xs text-muted-foreground">v{data.version}</p>
        </CardContent>
      </Card>
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>{t('admin.smtpConfig')}</CardTitle>
          <CardDescription>{t('admin.smtpEnvNote')}</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">Host</dt>
            <dd className="font-mono">
              {data.smtp.host}:{data.smtp.port} {data.smtp.secure ? '(TLS)' : '(STARTTLS)'}
            </dd>
            <dt className="text-muted-foreground">User</dt>
            <dd className="font-mono">{data.smtp.user ?? '—'}</dd>
            <dt className="text-muted-foreground">{t('admin.smtpFrom')}</dt>
            <dd className="font-mono break-all">
              {data.smtp.from}{' '}
              {data.smtp.fromIsDefault && (
                <span className="font-sans text-muted-foreground">
                  ({t('admin.smtpFromDefault')})
                </span>
              )}
            </dd>
          </dl>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              testEmail.mutate({ to: to.trim() || undefined });
            }}
          >
            <Field label={t('admin.testEmailTo')} htmlFor="test-to" className="min-w-60 flex-1">
              <Input
                id="test-to"
                type="email"
                placeholder="admin@…"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </Field>
            <Button type="submit" variant="outline" disabled={testEmail.isPending}>
              {testEmail.isPending ? <Loader2 className="animate-spin" /> : <Send />}
              {t('admin.testEmail')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function SaveRow({
  children,
  onSave,
  disabled,
}: {
  children: ReactNode;
  onSave: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-60 flex-1">{children}</div>
      <Button type="button" variant="secondary" onClick={onSave} disabled={disabled}>
        {t('common.save')}
      </Button>
    </div>
  );
}

function SecretField({
  label,
  settingKey,
  settings,
  save,
}: {
  label: string;
  settingKey: string;
  settings: SettingsMap;
  save: (k: string, v: unknown) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const s = settings[settingKey];
  const state = s?.secret ? s : { set: false, preview: null };
  return (
    <div className="grid grid-cols-1 gap-2">
      <SaveRow
        disabled={draft.trim().length < 10}
        onSave={() => {
          save(settingKey, draft.trim());
          setDraft('');
        }}
      >
        <Field
          label={label}
          htmlFor={settingKey}
          hint={
            state.set ? t('admin.apiKeySet', { preview: state.preview }) : t('admin.apiKeyNotSet')
          }
        >
          <Input
            id={settingKey}
            type="password"
            autoComplete="off"
            placeholder={state.set ? t('admin.apiKeyReplace') : ''}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </Field>
      </SaveRow>
      {state.set && (
        <Button
          type="button"
          variant="link"
          className="h-auto justify-self-start p-0 text-destructive"
          onClick={() => save(settingKey, null)}
        >
          {t('admin.remove')}
        </Button>
      )}
    </div>
  );
}

function GeneralSettings() {
  const { t } = useTranslation();
  const { settings, value, save } = useSettings();
  const [domains, setDomains] = useState('');
  const [appName, setAppName] = useState('');
  const [maxMb, setMaxMb] = useState('10');
  useEffect(() => {
    if (!settings) return;
    setDomains((value<string[]>('registration.allowedDomains') ?? []).join(', '));
    setAppName(value<string | null>('general.appName') ?? '');
    setMaxMb(String(value<number>('uploads.maxMb') ?? 10));
  }, [settings]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!settings) return <Loader2 className="mx-auto mt-10 animate-spin text-muted-foreground" />;

  return (
    <div className="grid grid-cols-1 gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('admin.registration')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-5">
          <Field label={t('admin.registrationMode')} htmlFor="reg-mode">
            <Select
              id="reg-mode"
              value={value<string>('registration.mode')}
              onChange={(e) => save('registration.mode', e.target.value)}
            >
              {(['open', 'invite_only', 'closed'] as const).map((m) => (
                <option key={m} value={m}>
                  {t(`admin.modes.${m}`)}
                </option>
              ))}
            </Select>
          </Field>
          <SaveRow
            onSave={() =>
              save(
                'registration.allowedDomains',
                domains
                  .split(',')
                  .map((d) => d.trim().toLowerCase())
                  .filter(Boolean),
              )
            }
          >
            <Field
              label={t('admin.allowedDomains')}
              htmlFor="domains"
              hint={t('admin.allowedDomainsHint')}
            >
              <Input
                id="domains"
                placeholder="example.com"
                value={domains}
                onChange={(e) => setDomains(e.target.value)}
              />
            </Field>
          </SaveRow>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>TripShare</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-5">
          <SaveRow onSave={() => save('general.appName', appName.trim() || null)}>
            <Field label={t('admin.appName')} htmlFor="app-name" hint={t('admin.appNameHint')}>
              <Input
                id="app-name"
                maxLength={60}
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
              />
            </Field>
          </SaveRow>
          <SaveRow onSave={() => save('uploads.maxMb', Number(maxMb))}>
            <Field label={t('admin.uploads')} htmlFor="max-mb">
              <Input
                id="max-mb"
                type="number"
                min={1}
                max={50}
                value={maxMb}
                onChange={(e) => setMaxMb(e.target.value)}
              />
            </Field>
          </SaveRow>
          <label className="flex items-center justify-between gap-4">
            <span className="font-medium">{t('admin.paypalEnabled')}</span>
            <Switch
              checked={value<boolean>('payments.paypalEnabled')}
              onCheckedChange={(v) => save('payments.paypalEnabled', v)}
            />
          </label>
          <SecretField
            label={t('admin.unsplash')}
            settingKey="unsplash.accessKey"
            settings={settings}
            save={save}
          />
          <SecretField
            label={t('admin.brave')}
            settingKey="brave.apiKey"
            settings={settings}
            save={save}
          />
        </CardContent>
      </Card>
    </div>
  );
}

const MODEL_KEYS = ['vision', 'planner', 'chat', 'web', 'light'] as const;
type ModelKey = (typeof MODEL_KEYS)[number];
type Models = Record<ModelKey, string> & { fallbacks: string[] };
/** Scopi che ricevono immagini in input (scontrini, screenshot). */
const IMAGE_PURPOSES: ModelKey[] = ['vision'];

type Provider = 'openrouter' | 'gemini';

function KeyStatus({ hasKey, provider }: { hasKey: boolean; provider: Provider }) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const checkOr = useMutation(trpc.admin.openrouter.checkKey.mutationOptions());
  const checkGemini = useMutation(trpc.admin.gemini.checkKey.mutationOptions());
  const test = useMutation(trpc.admin.aiTest.mutationOptions());
  if (!hasKey) return null;
  const check = provider === 'gemini' ? checkGemini : checkOr;
  const usd = (n: number | null) => (n === null ? '∞' : `$${n.toFixed(2)}`);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-muted/60 px-4 py-3 text-sm">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={check.isPending}
        onClick={() => check.mutate()}
      >
        {check.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
        {t('admin.checkKey')}
      </Button>
      {checkOr.data && provider === 'openrouter' && (
        <span className="text-success">
          {t('admin.keyOk', {
            usage: usd(checkOr.data.usage),
            limit: usd(checkOr.data.limit),
            remaining: usd(checkOr.data.limitRemaining),
          })}
          {checkOr.data.freeTier && ` · ${t('admin.freeTier')}`}
        </span>
      )}
      {checkGemini.data && provider === 'gemini' && (
        <span className="text-success">
          {t('admin.geminiKeyOk', { count: checkGemini.data.models })}
        </span>
      )}
      {check.error && (
        <span className="text-destructive">
          {t(`admin.openrouterErrors.${check.error.message}`, {
            defaultValue: check.error.message,
          })}
        </span>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={test.isPending}
        onClick={() => test.mutate({ provider })}
      >
        {test.isPending ? <Loader2 className="animate-spin" /> : <Send />}
        {t('admin.aiTest')}
      </Button>
      {test.data && (
        <span
          className={cn(
            'w-full text-xs break-words',
            test.data.ok ? 'text-success' : 'text-destructive',
          )}
        >
          {test.data.ok
            ? t('admin.aiTestOk', {
                model: test.data.model,
                ms: test.data.ms,
                content: test.data.content,
              })
            : t('admin.aiTestError', { model: test.data.model, error: test.data.error })}
        </span>
      )}
    </div>
  );
}

function AiSettings() {
  const { t } = useTranslation();
  const { settings, value, save } = useSettings();
  const [quota, setQuota] = useState('2');
  const [requests, setRequests] = useState('300');
  useEffect(() => {
    if (!settings) return;
    setQuota(String(value<number>('openrouter.monthlyQuotaUsd') ?? 2));
    setRequests(String(value<number>('ai.monthlyRequests') ?? 300));
  }, [settings]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!settings) return <Loader2 className="mx-auto mt-10 animate-spin text-muted-foreground" />;
  const hasKey = (key: string) => {
    const s = settings[key];
    return !!s?.secret && s.set;
  };
  const central = value<Provider>('ai.provider') ?? 'openrouter';

  return (
    <div className="grid grid-cols-1 gap-6">
      <Card>
        <CardHeader>
          <CardTitle>✨ {t('admin.aiGeneral')}</CardTitle>
          <CardDescription>{t('admin.aiGeneralHint')}</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-5">
          <Field label={t('admin.aiMode')} htmlFor="ai-mode">
            <Select
              id="ai-mode"
              value={value<string>('openrouter.mode')}
              onChange={(e) => save('openrouter.mode', e.target.value)}
            >
              {(['central', 'per_user', 'mixed'] as const).map((m) => (
                <option key={m} value={m}>
                  {t(`admin.aiModes.${m}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t('admin.centralProvider')}
            htmlFor="ai-provider"
            hint={t('admin.centralProviderHint')}
            error={!hasKey(`${central}.apiKey`) ? t('admin.centralProviderNoKey') : null}
          >
            <Select
              id="ai-provider"
              value={central}
              onChange={(e) => save('ai.provider', e.target.value)}
            >
              <option value="openrouter">OpenRouter</option>
              <option value="gemini">Google Gemini</option>
            </Select>
          </Field>
          <SaveRow onSave={() => save('ai.monthlyRequests', Number(requests))}>
            <Field
              label={t('admin.requestsQuota')}
              htmlFor="req-quota"
              hint={t('admin.requestsQuotaHint')}
            >
              <Input
                id="req-quota"
                type="number"
                min={0}
                step="10"
                value={requests}
                onChange={(e) => setRequests(e.target.value)}
              />
            </Field>
          </SaveRow>
          <SaveRow onSave={() => save('openrouter.monthlyQuotaUsd', Number(quota))}>
            <Field label={t('admin.quota')} htmlFor="quota">
              <Input
                id="quota"
                type="number"
                min={0}
                step="0.5"
                value={quota}
                onChange={(e) => setQuota(e.target.value)}
              />
            </Field>
          </SaveRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            OpenRouter
            {central === 'openrouter' && <Badge variant="success">{t('admin.centralBadge')}</Badge>}
          </CardTitle>
          <CardDescription>{t('admin.openrouterHint')}</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-5">
          <SecretField
            label={t('admin.apiKey')}
            settingKey="openrouter.apiKey"
            settings={settings}
            save={save}
          />
          <KeyStatus hasKey={hasKey('openrouter.apiKey')} provider="openrouter" />
          <label className="flex items-center justify-between gap-4">
            <span className="font-medium">{t('admin.denyDataCollection')}</span>
            <Switch
              checked={value<boolean>('openrouter.denyDataCollection')}
              onCheckedChange={(v) => save('openrouter.denyDataCollection', v)}
            />
          </label>
        </CardContent>
      </Card>
      <ModelsCard provider="openrouter" />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Google Gemini
            {central === 'gemini' && <Badge variant="success">{t('admin.centralBadge')}</Badge>}
          </CardTitle>
          <CardDescription>{t('admin.geminiHint')}</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-5">
          <SecretField
            label={t('admin.geminiKey')}
            settingKey="gemini.apiKey"
            settings={settings}
            save={save}
          />
          <KeyStatus hasKey={hasKey('gemini.apiKey')} provider="gemini" />
        </CardContent>
      </Card>
      {hasKey('gemini.apiKey') && <ModelsCard provider="gemini" />}

      <AiUsage />
    </div>
  );
}

/** Modelli per ogni compito, scelti dall'elenco del provider. */
function ModelsCard({ provider }: { provider: Provider }) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const { settings, value, save } = useSettings();
  const settingKey = `${provider}.models`;
  const [models, setModels] = useState<Models | null>(null);
  const [refresh, setRefresh] = useState(false);
  const orCatalog = useQuery({
    ...trpc.admin.openrouter.models.queryOptions({ refresh }),
    staleTime: 3600_000,
    retry: false,
    enabled: provider === 'openrouter',
  });
  const geminiCatalog = useQuery({
    ...trpc.admin.gemini.models.queryOptions({ refresh }),
    staleTime: 3600_000,
    retry: false,
    enabled: provider === 'gemini',
  });
  const catalog = provider === 'gemini' ? geminiCatalog : orCatalog;
  useEffect(() => {
    if (!settings) return;
    const m = value<Models>(settingKey);
    if (m) setModels(m);
  }, [settings]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!models) return null;

  const list = catalog.data?.models ?? [];
  const byId = new Map(list.map((m) => [m.id, m]));
  const warning = (k: ModelKey) => {
    const m = byId.get(models[k]);
    if (!m) return null;
    if (IMAGE_PURPOSES.includes(k) && !m.imageInput) return t('admin.needsImages');
    if (k === 'planner' && !m.structuredOutput) return t('admin.noStructured');
    return null;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid grid-cols-1 gap-1">
            <CardTitle>
              {t('admin.models')} · {provider === 'gemini' ? 'Gemini' : 'OpenRouter'}
            </CardTitle>
            <CardDescription>
              {provider === 'gemini' ? t('admin.geminiModelHint') : t('admin.modelHint')}
            </CardDescription>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={catalog.isFetching}
            onClick={() => (refresh ? void catalog.refetch() : setRefresh(true))}
          >
            {catalog.isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {t('admin.refreshModels')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-5">
        {catalog.isError && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {t('admin.modelsUnavailable')} ({catalog.error.message})
          </p>
        )}
        {catalog.data && (
          <p className="text-xs text-muted-foreground">
            {t('admin.modelsCount', {
              count: list.length,
              free: list.filter((m) => m.free).length,
              images: list.filter((m) => m.imageInput).length,
            })}
          </p>
        )}
        {MODEL_KEYS.map((k) => (
          <Field
            key={k}
            label={
              <span className="flex flex-wrap items-center gap-2">
                {t(`admin.modelNames.${k}`)}
                {IMAGE_PURPOSES.includes(k) ? (
                  <Badge variant="outline">🖼️ {t('admin.textAndImages')}</Badge>
                ) : (
                  <Badge variant="outline">📝 {t('admin.textOnly')}</Badge>
                )}
              </span>
            }
            hint={t(`admin.modelPurposes.${k}`)}
            error={warning(k)}
          >
            {catalog.isError ? (
              <Input
                className="font-mono text-sm"
                value={models[k]}
                onChange={(e) => setModels({ ...models, [k]: e.target.value })}
              />
            ) : (
              <ModelPicker
                models={list}
                value={models[k]}
                allowAuto={provider === 'openrouter'}
                requireImage={IMAGE_PURPOSES.includes(k)}
                onChange={(id) => setModels({ ...models, [k]: id })}
              />
            )}
          </Field>
        ))}
        <Field label={t('admin.fallbacks')} hint={t('admin.fallbacksHint')}>
          <div className="grid grid-cols-1 gap-2">
            {models.fallbacks.map((id) => (
              <div key={id} className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {byId.get(id)?.name ?? id}
                  </span>
                  {byId.get(id) && <ModelInfo model={byId.get(id)!} />}
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label={t('admin.remove')}
                  onClick={() =>
                    setModels({ ...models, fallbacks: models.fallbacks.filter((f) => f !== id) })
                  }
                >
                  <X />
                </Button>
              </div>
            ))}
            {models.fallbacks.length < 5 && !catalog.isError && (
              <ModelPicker
                models={list.filter((m) => !models.fallbacks.includes(m.id))}
                value={null}
                allowAuto={provider === 'openrouter'}
                placeholder={t('admin.addFallback')}
                onChange={(id) =>
                  !models.fallbacks.includes(id) &&
                  setModels({ ...models, fallbacks: [...models.fallbacks, id] })
                }
              />
            )}
          </div>
        </Field>
        <Button type="button" className="justify-self-end" onClick={() => save(settingKey, models)}>
          {t('common.save')}
        </Button>
      </CardContent>
    </Card>
  );
}

/** Uso dell'AI nel mese corrente. */
function AiUsage() {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const { data } = useQuery(trpc.admin.aiUsage.queryOptions());
  const errors = useQuery(trpc.admin.aiErrors.queryOptions());
  if (!data) return null;
  const total = data.reduce(
    (a, r) => ({
      requests: a.requests + r.requests,
      tokens: a.tokens + r.tokens,
      cost: a.cost + r.cost,
    }),
    { requests: 0, tokens: 0, cost: 0 },
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>📊 {t('admin.aiUsage')}</CardTitle>
        <CardDescription>
          {t('admin.aiUsageTotal', {
            requests: total.requests,
            tokens: total.tokens.toLocaleString(),
            cost: total.cost.toFixed(3),
          })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('admin.aiUsageEmpty')}</p>
        ) : (
          <div className="divide-y rounded-xl border">
            {data.map((r, i) => (
              <div
                key={i}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{r.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{r.email}</span>
                </span>
                <Badge variant="outline">
                  {r.provider === 'gemini' ? 'Gemini' : 'OpenRouter'} ·{' '}
                  {r.keySource === 'user' ? t('admin.ownKey') : t('admin.centralKey')}
                </Badge>
                <span className="tabular text-muted-foreground">
                  {t('admin.aiUsageRow', {
                    requests: r.requests,
                    errors: r.errors,
                    tokens: r.tokens.toLocaleString(),
                  })}
                  {r.cost > 0 && ` · $${r.cost.toFixed(3)}`}
                </span>
              </div>
            ))}
          </div>
        )}
        {errors.data && errors.data.length > 0 && (
          <div className="mt-5 grid grid-cols-1 gap-2">
            <p className="text-sm font-semibold">{t('admin.aiErrors')}</p>
            {errors.data.map((e) => (
              <div key={e.id} className="rounded-lg bg-destructive/10 px-3 py-2 text-xs">
                <span className="font-semibold">
                  {new Date(e.createdAt).toLocaleString()} · {e.kind} ·{' '}
                  {e.provider === 'gemini' ? 'Gemini' : 'OpenRouter'}
                  {e.model && ` · ${e.model}`}
                </span>
                <span className="block break-words text-destructive">{e.error}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Users() {
  const { t, i18n } = useTranslation();
  const trpc = useTRPC();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);
  const { data } = useQuery(
    trpc.admin.users.list.queryOptions({ search: debounced || undefined, limit: 50 }),
  );
  const fmt = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium' });
  return (
    <div className="grid grid-cols-1 gap-4">
      <Input
        placeholder={t('admin.search')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <Card className="divide-y">
        {data?.rows.map((u) => (
          <div key={u.id} className="flex items-center gap-3 p-4">
            <UserAvatar user={u} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{u.name}</p>
              <p className="truncate text-sm text-muted-foreground">{u.email}</p>
            </div>
            <div className="hidden flex-wrap justify-end gap-1.5 sm:flex">
              {u.role === 'superadmin' && <Badge>superadmin</Badge>}
              {u.banned && <Badge variant="destructive">{t('admin.banned')}</Badge>}
              <Badge variant={u.emailVerified ? 'success' : 'warning'}>
                {u.emailVerified ? t('admin.verified') : t('admin.notVerified')}
              </Badge>
              <Badge variant="outline" className="uppercase">
                {u.locale}
              </Badge>
            </div>
            <span className="hidden text-sm text-muted-foreground md:block">
              {fmt.format(new Date(u.createdAt))}
            </span>
          </div>
        ))}
        {!data && <Loader2 className="mx-auto my-8 animate-spin text-muted-foreground" />}
      </Card>
      {data && (
        <p className="text-sm text-muted-foreground">
          {t('admin.usersCount')}: {data.total}
        </p>
      )}
    </div>
  );
}

function Audit() {
  const { t, i18n } = useTranslation();
  const trpc = useTRPC();
  const { data } = useQuery(trpc.admin.system.audit.queryOptions({ limit: 100 }));
  const fmt = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
  if (!data) return <Loader2 className="mx-auto mt-10 animate-spin text-muted-foreground" />;
  if (data.length === 0) return <p className="text-muted-foreground">{t('admin.auditEmpty')}</p>;
  return (
    <Card className="divide-y">
      {data.map((row) => (
        <div key={row.id} className="grid grid-cols-1 gap-1 p-4 sm:grid-cols-[160px_1fr]">
          <span className="tabular text-sm text-muted-foreground">
            {fmt.format(new Date(row.createdAt))}
          </span>
          <div className="min-w-0">
            <p className="font-mono text-sm font-semibold">{row.action}</p>
            {row.data != null && (
              <p className="truncate font-mono text-xs text-muted-foreground">
                {JSON.stringify(row.data)}
              </p>
            )}
          </div>
        </div>
      ))}
    </Card>
  );
}
