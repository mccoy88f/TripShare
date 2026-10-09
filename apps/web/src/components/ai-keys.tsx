import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { useAiStatus } from '@/lib/ai';
import { useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';

type Provider = 'openrouter' | 'gemini';
const LINKS: Record<Provider, string> = {
  openrouter: 'https://openrouter.ai/settings/keys',
  gemini: 'https://aistudio.google.com/apikey',
};

/** Profilo: stato dell'AI e chiavi personali (se l'istanza le consente). */
export function AiKeysCard() {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data } = useAiStatus();
  const [drafts, setDrafts] = useState<Record<Provider, string>>({ openrouter: '', gemini: '' });
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.ai.status.queryKey() });
  const setKey = useMutation(
    trpc.ai.setKey.mutationOptions({
      onSuccess: async () => {
        await refresh();
        toast.success(t('common.saved'));
      },
      onError: (err) =>
        toast.error(t(`ai.errors.${err.message}`, { defaultValue: t('common.error') })),
    }),
  );
  const setPreferred = useMutation(trpc.ai.setPreferred.mutationOptions({ onSuccess: refresh }));
  if (!data) return null;
  const ownKeys = data.mode !== 'central';
  if (!ownKeys && !data.centralReady) return null;
  const { usage } = data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>✨ {t('profile.ai.title')}</CardTitle>
        <CardDescription>{t(`profile.ai.mode.${data.mode}`)}</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-5">
        {data.centralReady && (
          <p className="rounded-xl bg-muted/60 px-4 py-3 text-sm">
            {t('profile.ai.usage', {
              requests: usage.requests,
              limit: usage.quotaRequests || '∞',
            })}
          </p>
        )}
        {ownKeys &&
          (['openrouter', 'gemini'] as const).map((p) => {
            const current = data.keys[p];
            return (
              <div key={p} className="grid grid-cols-1 gap-2">
                <div className="flex flex-wrap items-end gap-2">
                  <Field
                    className="min-w-0 flex-1 basis-56"
                    label={p === 'gemini' ? 'Google Gemini' : 'OpenRouter'}
                    htmlFor={`key-${p}`}
                    hint={
                      current ? (
                        t('profile.ai.keySet', { preview: current })
                      ) : (
                        <a href={LINKS[p]} target="_blank" rel="noreferrer" className="underline">
                          {t('profile.ai.getKey')}
                        </a>
                      )
                    }
                  >
                    <Input
                      id={`key-${p}`}
                      type="password"
                      autoComplete="off"
                      placeholder={current ? t('admin.apiKeyReplace') : ''}
                      value={drafts[p]}
                      onChange={(e) => setDrafts({ ...drafts, [p]: e.target.value })}
                    />
                  </Field>
                  <Button
                    variant="secondary"
                    disabled={setKey.isPending || drafts[p].trim().length < 10}
                    onClick={async () => {
                      await setKey.mutateAsync({ provider: p, key: drafts[p].trim() });
                      setDrafts({ ...drafts, [p]: '' });
                    }}
                  >
                    {setKey.isPending && <Loader2 className="animate-spin" />}
                    {t('common.save')}
                  </Button>
                </div>
                {current && (
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <button
                      type="button"
                      onClick={() => setPreferred.mutate({ provider: p })}
                      className={cn(
                        'rounded-full border px-3 py-1 transition',
                        data.preferred === p
                          ? 'border-primary bg-primary/10 font-semibold text-primary'
                          : 'hover:bg-muted',
                      )}
                    >
                      {data.preferred === p ? `✓ ${t('profile.ai.inUse')}` : t('profile.ai.use')}
                    </button>
                    <button
                      type="button"
                      className="text-destructive hover:underline"
                      onClick={() => setKey.mutate({ provider: p, key: null })}
                    >
                      {t('admin.remove')}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
      </CardContent>
    </Card>
  );
}
