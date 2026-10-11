import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  KeyRound,
  Loader2,
  Plus,
  Save,
  Send,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ModelPicker } from '@/components/model-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';

type Provider = 'openrouter' | 'gemini' | 'groq' | 'llm7' | 'nvidia';
type Catalog = React.ComponentProps<typeof ModelPicker>['models'];

interface Item {
  id: string;
  name: string;
  provider: Provider;
  model: string;
  backupModel: string;
  enabled: boolean;
  /** Anteprima della chiave già salvata (assente per le nuove). */
  keyPreview?: string;
  /** Chiave nuova (aggiunta o sostituita); vuota = si tiene quella salvata. */
  newKey: string;
  saved: boolean;
  /** Modelli letti al momento della verifica, per le configurazioni non ancora salvate. */
  catalog?: Catalog;
}

const PROVIDER_NAME: Record<Provider, string> = {
  openrouter: 'OpenRouter',
  gemini: 'Google Gemini',
  groq: 'Groq',
  llm7: 'LLM7',
  nvidia: 'NVIDIA NIM',
};
/** Modello proposto all'inizio, se il provider lo elenca (altrimenti il primo dell'elenco). */
const PREFERRED_MODEL: Record<Provider, string> = {
  openrouter: 'openrouter/auto',
  gemini: 'gemini-flash-latest',
  groq: 'llama-3.3-70b-versatile',
  llm7: 'gpt-4.1-nano-2025-04-14',
  nvidia: 'meta/llama-3.3-70b-instruct',
};
/** LLM7 funziona anche senza chiave: si invia questo segnaposto. */
const LLM7_NO_KEY = 'unused';

interface TestResult {
  ok: boolean;
  ms: number;
  model: string;
  text: string;
}

/**
 * Configurazioni AI centrali in una tabella: in alto si aggiunge un provider verificandone la
 * chiave, poi si scelgono modello e riserva e si prova ogni modello con una richiesta vera. Le
 * righe si provano in ordine: se una fallisce (chiave, credito, limiti, rete) si passa alla
 * successiva.
 */
export function AiProfiles() {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data } = useQuery(trpc.admin.aiProfiles.list.queryOptions());
  const [items, setItems] = useState<Item[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: trpc.admin.aiProfiles.list.queryKey() });

  useEffect(() => {
    if (!data || dirty) return;
    setItems(
      data.profiles.map((p) => ({
        id: p.id,
        name: p.name,
        provider: p.provider,
        model: p.model,
        backupModel: p.backupModel ?? '',
        enabled: p.enabled,
        keyPreview: p.keyPreview,
        newKey: '',
        saved: true,
      })),
    );
  }, [data, dirty]);

  const save = useMutation(
    trpc.admin.aiProfiles.save.mutationOptions({
      onSuccess: async () => {
        setDirty(false);
        await refresh();
        toast.success(t('common.saved'));
      },
      onError: (err) =>
        toast.error(
          t(`admin.profiles.errors.${err.message}`, {
            defaultValue: err.message || t('common.error'),
          }),
        ),
    }),
  );
  const importLegacy = useMutation(
    trpc.admin.aiProfiles.importLegacy.mutationOptions({ onSuccess: refresh }),
  );

  if (!items) return <Loader2 className="mx-auto mt-10 animate-spin text-muted-foreground" />;

  const update = (id: string, patch: Partial<Item>) => {
    setDirty(true);
    setItems((list) => list!.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  };
  const move = (index: number, by: -1 | 1) => {
    setDirty(true);
    setItems((list) => {
      const next = [...list!];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item!);
      return next;
    });
  };
  const invalid = items.some((i) => !i.name.trim() || !i.model.trim());

  return (
    <Card>
      <CardHeader>
        <CardTitle>🔀 {t('admin.profiles.title')}</CardTitle>
        <CardDescription>{t('admin.profiles.hint')}</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4">
        <AddProfile
          onAdd={(item) => {
            setDirty(true);
            setItems((list) => [...list!, item]);
          }}
        />
        {data?.legacy && items.length === 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-muted/60 px-4 py-3 text-sm">
            <span className="min-w-0 flex-1">
              {t('admin.profiles.legacy', { provider: PROVIDER_NAME[data.legacy.provider] })}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={importLegacy.isPending}
              onClick={() => importLegacy.mutate()}
            >
              {importLegacy.isPending && <Loader2 className="animate-spin" />}
              {t('admin.profiles.import')}
            </Button>
          </div>
        )}
        {items.length === 0 && !data?.legacy ? (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            {t('admin.profiles.empty')}
          </p>
        ) : (
          items.length > 0 && (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="w-28 px-2 py-2 font-medium">#</th>
                    <th className="px-2 py-2 font-medium">{t('admin.profiles.config')}</th>
                    <th className="w-44 px-2 py-2 font-medium">{t('admin.profiles.test')}</th>
                    <th className="w-24 px-2 py-2 text-center font-medium">
                      {t('admin.profiles.enabled')}
                    </th>
                  </tr>
                </thead>
                {items.map((item, index) => (
                  <ProfileRow
                    key={item.id}
                    item={item}
                    index={index}
                    last={index === items.length - 1}
                    onChange={(patch) => update(item.id, patch)}
                    onMove={(by) => move(index, by)}
                    onRemove={() => {
                      setDirty(true);
                      setItems((list) => list!.filter((i) => i.id !== item.id));
                    }}
                  />
                ))}
              </table>
            </div>
          )
        )}
        {dirty && (
          <div className="flex justify-end">
            <Button
              type="button"
              disabled={invalid || save.isPending}
              onClick={() =>
                save.mutate({
                  profiles: items.map((i) => ({
                    id: i.id,
                    name: i.name.trim(),
                    provider: i.provider,
                    model: i.model.trim(),
                    backupModel: i.backupModel.trim() || null,
                    enabled: i.enabled,
                    ...(i.newKey.trim() ? { apiKey: i.newKey.trim() } : {}),
                  })),
                })
              }
            >
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
              {t('common.save')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Scelta del provider e della chiave: la chiave si verifica prima di aggiungere la riga. */
function AddProfile({ onAdd }: { onAdd: (item: Item) => void }) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const [provider, setProvider] = useState<Provider>('openrouter');
  const [key, setKey] = useState('');
  const verify = useMutation(trpc.admin.aiProfiles.verify.mutationOptions());

  const add = async () => {
    const apiKey = key.trim() || (provider === 'llm7' ? LLM7_NO_KEY : '');
    const result = await verify.mutateAsync({ provider, apiKey }).catch(() => null);
    if (!result) return;
    const models = result.models;
    const preferred = models.find((m) => m.id === PREFERRED_MODEL[provider]) ?? models[0];
    onAdd({
      id: `p-${Math.random().toString(36).slice(2, 8)}`,
      name: PROVIDER_NAME[provider],
      provider,
      model: preferred?.id ?? PREFERRED_MODEL[provider],
      backupModel: '',
      enabled: true,
      newKey: apiKey,
      saved: false,
      catalog: models,
    });
    setKey('');
    verify.reset();
  };

  return (
    <div className="grid grid-cols-1 gap-2 rounded-xl bg-muted/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label={t('admin.profiles.provider')}
          className="w-44"
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value as Provider);
            verify.reset();
          }}
        >
          {(Object.keys(PROVIDER_NAME) as Provider[]).map((p) => (
            <option key={p} value={p}>
              {PROVIDER_NAME[p]}
            </option>
          ))}
        </Select>
        <Input
          aria-label={t('admin.profiles.key')}
          className="min-w-48 flex-1"
          type="password"
          autoComplete="off"
          placeholder={
            provider === 'llm7'
              ? t('admin.profiles.keyOptional')
              : t('admin.profiles.keyPlaceholder')
          }
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            verify.reset();
          }}
        />
        <Button
          type="button"
          disabled={(provider !== 'llm7' && key.trim().length < 10) || verify.isPending}
          onClick={add}
        >
          {verify.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
          {t('admin.profiles.verifyAdd')}
        </Button>
      </div>
      {(provider === 'llm7' || provider === 'nvidia') && (
        <p className="text-xs text-muted-foreground">{t('admin.profiles.listHint')}</p>
      )}
      {verify.error && (
        <p className="flex items-center gap-1.5 text-sm text-destructive">
          <XCircle className="size-4 shrink-0" />
          {t(`admin.profiles.errors.${verify.error.message}`, {
            defaultValue: verify.error.message,
          })}
        </p>
      )}
    </div>
  );
}

function ProfileRow({
  item,
  index,
  last,
  onChange,
  onMove,
  onRemove,
}: {
  item: Item;
  index: number;
  last: boolean;
  onChange: (patch: Partial<Item>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const [changingKey, setChangingKey] = useState(false);
  const [results, setResults] = useState<{ main?: TestResult; backup?: TestResult } | null>(null);
  const catalog = useQuery({
    ...trpc.admin.aiProfiles.models.queryOptions({ id: item.id }),
    enabled: item.saved && !item.catalog,
    staleTime: 3600_000,
    retry: false,
  });
  const test = useMutation(trpc.admin.aiProfiles.test.mutationOptions());
  const list = item.catalog ?? catalog.data?.models ?? [];
  const usable = list.length > 0;
  const auto = item.provider === 'openrouter';

  /** Prova il modello principale e poi la riserva, ognuno da solo. */
  const runTest = async () => {
    setResults({});
    const base = {
      id: item.saved ? item.id : undefined,
      provider: item.provider,
      ...(item.newKey.trim() ? { apiKey: item.newKey.trim() } : {}),
    };
    const one = async (model: string): Promise<TestResult> => {
      try {
        const r = await test.mutateAsync({ ...base, model });
        return r.ok
          ? { ok: true, ms: r.ms, model: r.model, text: r.content }
          : { ok: false, ms: r.ms, model: r.model, text: r.error };
      } catch (err) {
        return {
          ok: false,
          ms: 0,
          model,
          text: err instanceof Error ? err.message : t('common.error'),
        };
      }
    };
    const main = await one(item.model);
    setResults({ main });
    if (item.backupModel) setResults({ main, backup: await one(item.backupModel) });
  };

  const picker = (value: string | null, onPick: (id: string) => void, placeholder?: string) =>
    usable ? (
      <ModelPicker
        models={list}
        value={value}
        allowAuto={auto}
        placeholder={placeholder}
        compact
        onChange={onPick}
      />
    ) : (
      <Input
        className="h-8 px-2.5 font-mono text-xs"
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onPick(e.target.value)}
      />
    );

  return (
    <tbody className={cn('border-t', !item.enabled && 'opacity-60')}>
      <tr className="align-top">
        <td className="px-2 pt-2 pb-1">
          <div className="flex items-center gap-0.5">
            <Badge variant="outline" className="tabular mr-1">
              {index + 1}
            </Badge>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label={t('admin.profiles.up')}
              disabled={index === 0}
              onClick={() => onMove(-1)}
            >
              <ArrowUp />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label={t('admin.profiles.down')}
              disabled={last}
              onClick={() => onMove(1)}
            >
              <ArrowDown />
            </Button>
          </div>
        </td>
        <td className="px-2 pt-2 pb-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="default">{PROVIDER_NAME[item.provider]}</Badge>
            {!item.saved && <Badge variant="warning">{t('admin.profiles.unsaved')}</Badge>}
            <Input
              aria-label={t('admin.profiles.name')}
              className="h-7 w-40 px-2 text-xs"
              maxLength={60}
              value={item.name}
              onChange={(e) => onChange({ name: e.target.value })}
            />
            {changingKey ? (
              <Input
                aria-label={t('admin.profiles.key')}
                className="h-7 w-48 px-2 text-xs"
                type="password"
                autoComplete="off"
                autoFocus
                placeholder={t('admin.profiles.keyPlaceholder')}
                value={item.newKey}
                onChange={(e) => onChange({ newKey: e.target.value })}
              />
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <KeyRound className="size-3.5" />
                <span className="font-mono">{item.keyPreview ?? '••••'}</span>
                {item.saved && (
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => setChangingKey(true)}
                  >
                    {t('admin.profiles.changeKey')}
                  </button>
                )}
              </span>
            )}
          </div>
        </td>
        <td className="px-2 pt-2 pb-1">
          <div className="grid grid-cols-1 gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 justify-self-start px-2.5 text-xs"
              disabled={test.isPending || !item.model.trim()}
              onClick={runTest}
            >
              {test.isPending ? <Loader2 className="animate-spin" /> : <Send />}
              {t('admin.profiles.runTest')}
            </Button>
            {results?.main && <Result label={t('admin.profiles.mainShort')} r={results.main} />}
            {results?.backup && (
              <Result label={t('admin.profiles.backupShort')} r={results.backup} />
            )}
          </div>
        </td>
        <td className="px-2 pt-2 pb-1">
          <div className="flex items-center justify-center gap-1">
            <Switch checked={item.enabled} onCheckedChange={(v) => onChange({ enabled: v })} />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 text-destructive"
              aria-label={t('admin.remove')}
              title={t('admin.remove')}
              onClick={onRemove}
            >
              <Trash2 />
            </Button>
          </div>
        </td>
      </tr>
      <tr>
        <td />
        <td colSpan={3} className="px-2 pt-0 pb-2.5">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="grid grid-cols-1 gap-1 text-xs font-medium text-muted-foreground">
              {t('admin.profiles.model')}
              {picker(item.model, (id) => onChange({ model: id }))}
            </label>
            <div className="grid grid-cols-1 gap-1 text-xs font-medium text-muted-foreground">
              {t('admin.profiles.backup')}
              <div className="flex items-center gap-1">
                <div className="min-w-0 flex-1">
                  {picker(
                    item.backupModel || null,
                    (id) => onChange({ backupModel: id }),
                    t('admin.profiles.noBackup'),
                  )}
                </div>
                {item.backupModel && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0"
                    aria-label={t('admin.profiles.removeBackup')}
                    title={t('admin.profiles.removeBackup')}
                    onClick={() => onChange({ backupModel: '' })}
                  >
                    <X />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </td>
      </tr>
    </tbody>
  );
}

function Result({ label, r }: { label: string; r: TestResult }) {
  return (
    <span
      className={cn('flex items-start gap-1 text-xs', r.ok ? 'text-success' : 'text-destructive')}
      title={`${r.model}: ${r.text}`}
    >
      {r.ok ? (
        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
      ) : (
        <XCircle className="mt-0.5 size-3.5 shrink-0" />
      )}
      <span className="min-w-0 break-words">
        {label} · {r.ok ? `${r.ms} ms` : r.text.slice(0, 120)}
      </span>
    </span>
  );
}
