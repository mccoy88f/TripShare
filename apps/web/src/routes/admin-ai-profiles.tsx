import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Loader2, Plus, Save, Send, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ModelPicker } from '@/components/model-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';

type Provider = 'openrouter' | 'gemini' | 'groq';

interface Item {
  id: string;
  name: string;
  provider: Provider;
  model: string;
  backupModel: string;
  enabled: boolean;
  /** Anteprima della chiave già salvata (assente per le nuove). */
  keyPreview?: string;
  /** Nuova chiave digitata; vuota = si tiene quella salvata. */
  newKey: string;
  saved: boolean;
}

const DEFAULT_MODEL: Record<Provider, string> = {
  openrouter: 'openrouter/auto',
  gemini: 'gemini-flash-latest',
  groq: 'llama-3.3-70b-versatile',
};
const PROVIDER_NAME: Record<Provider, string> = {
  openrouter: 'OpenRouter',
  gemini: 'Google Gemini',
  groq: 'Groq',
};

/**
 * Configurazioni AI centrali: ognuna è un provider con la sua chiave, un modello e uno di
 * riserva. Si provano nell'ordine dell'elenco: se una fallisce (chiave, credito, limiti, rete)
 * si passa alla successiva.
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
  const add = (provider: Provider) => {
    setDirty(true);
    setItems((list) => [
      ...list!,
      {
        id: `p-${Math.random().toString(36).slice(2, 8)}`,
        name: PROVIDER_NAME[provider],
        provider,
        model: DEFAULT_MODEL[provider],
        backupModel: '',
        enabled: true,
        newKey: '',
        saved: false,
      },
    ]);
  };
  const invalid = items.some(
    (i) => !i.name.trim() || !i.model.trim() || (!i.saved && i.newKey.trim().length < 10),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>🔀 {t('admin.profiles.title')}</CardTitle>
        <CardDescription>{t('admin.profiles.hint')}</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4">
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
        {items.length === 0 && !data?.legacy && (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            {t('admin.profiles.empty')}
          </p>
        )}
        {items.map((item, index) => (
          <ProfileCard
            key={item.id}
            item={item}
            index={index}
            last={index === items.length - 1}
            canTest={item.saved && !dirty}
            onChange={(patch) => update(item.id, patch)}
            onMove={(by) => move(index, by)}
            onRemove={() => {
              setDirty(true);
              setItems((list) => list!.filter((i) => i.id !== item.id));
            }}
          />
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => add('openrouter')}>
            <Plus />
            OpenRouter
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => add('gemini')}>
            <Plus />
            Gemini
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => add('groq')}>
            <Plus />
            Groq
          </Button>
          <span className="flex-1" />
          {dirty && (
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
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ProfileCard({
  item,
  index,
  last,
  canTest,
  onChange,
  onMove,
  onRemove,
}: {
  item: Item;
  index: number;
  last: boolean;
  canTest: boolean;
  onChange: (patch: Partial<Item>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const catalog = useQuery({
    ...trpc.admin.aiProfiles.models.queryOptions({ id: item.id }),
    enabled: item.saved,
    staleTime: 3600_000,
    retry: false,
  });
  const test = useMutation(trpc.admin.aiProfiles.test.mutationOptions());
  const list = catalog.data?.models ?? [];
  const usable = item.saved && !catalog.isError && list.length > 0;

  return (
    <div
      className={cn('grid grid-cols-1 gap-3 rounded-xl border p-4', !item.enabled && 'opacity-60')}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="tabular">
          {index + 1}
        </Badge>
        <Badge variant="default">{PROVIDER_NAME[item.provider]}</Badge>
        <span className="flex-1" />
        <label className="inline-flex items-center gap-2 text-sm">
          {t('admin.profiles.enabled')}
          <Switch checked={item.enabled} onCheckedChange={(v) => onChange({ enabled: v })} />
        </label>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8"
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
          className="size-8"
          aria-label={t('admin.profiles.down')}
          disabled={last}
          onClick={() => onMove(1)}
        >
          <ArrowDown />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 text-destructive"
          aria-label={t('admin.remove')}
          onClick={onRemove}
        >
          <Trash2 />
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('admin.profiles.name')} htmlFor={`pn-${item.id}`}>
          <Input
            id={`pn-${item.id}`}
            maxLength={60}
            value={item.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </Field>
        <Field
          label={t('admin.profiles.key')}
          htmlFor={`pk-${item.id}`}
          hint={item.keyPreview ? t('admin.apiKeySet', { preview: item.keyPreview }) : undefined}
        >
          <Input
            id={`pk-${item.id}`}
            type="password"
            autoComplete="off"
            placeholder={item.keyPreview ? t('admin.apiKeyReplace') : ''}
            value={item.newKey}
            onChange={(e) => onChange({ newKey: e.target.value })}
          />
        </Field>
        <Field label={t('admin.profiles.model')} hint={t('admin.profiles.modelHint')}>
          {usable ? (
            <ModelPicker
              models={list}
              value={item.model}
              allowAuto={item.provider === 'openrouter'}
              onChange={(id) => onChange({ model: id })}
            />
          ) : (
            <Input
              className="font-mono text-sm"
              value={item.model}
              onChange={(e) => onChange({ model: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('admin.profiles.backup')} hint={t('admin.profiles.backupHint')}>
          {usable ? (
            <ModelPicker
              models={list}
              value={item.backupModel || null}
              allowAuto={item.provider === 'openrouter'}
              placeholder={t('admin.profiles.noBackup')}
              onChange={(id) => onChange({ backupModel: id })}
            />
          ) : (
            <Input
              className="font-mono text-sm"
              value={item.backupModel}
              placeholder={t('admin.profiles.noBackup')}
              onChange={(e) => onChange({ backupModel: e.target.value })}
            />
          )}
        </Field>
      </div>
      {item.backupModel && (
        <Button
          type="button"
          variant="link"
          className="h-auto justify-self-start p-0 text-xs text-muted-foreground"
          onClick={() => onChange({ backupModel: '' })}
        >
          {t('admin.profiles.removeBackup')}
        </Button>
      )}
      {item.saved && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canTest || test.isPending}
            title={canTest ? undefined : t('admin.profiles.saveFirst')}
            onClick={() => test.mutate({ id: item.id })}
          >
            {test.isPending ? <Loader2 className="animate-spin" /> : <Send />}
            {t('admin.aiTest')}
          </Button>
          {test.data && (
            <span
              className={cn(
                'min-w-0 flex-1 text-xs break-words',
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
      )}
    </div>
  );
}
