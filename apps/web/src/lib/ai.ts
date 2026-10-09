import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { inferRouterInputs } from '@trpc/server';
import type { AppRouter } from '@tripshare/api/router';
import { useTRPC } from './trpc';

export type AiInput = inferRouterInputs<AppRouter>['ai']['start']['input'];

/** Carica la foto o il PDF da far leggere all'AI (archivio privato del viaggio). */
export async function uploadAiFile(tripId: string, file: File) {
  const body = new FormData();
  body.append('file', file);
  const res = await fetch(`/api/trips/${tripId}/ai-files`, {
    method: 'POST',
    body,
    credentials: 'include',
  });
  const data = (await res.json().catch(() => ({}))) as {
    file?: string;
    mime?: string;
    error?: string;
  };
  if (!res.ok || !data.file) throw new Error(data.error ?? 'UPLOAD_FAILED');
  return { file: data.file, mime: data.mime! };
}

/** Stato dell'AI per l'utente (serve per mostrare o nascondere i pulsanti ✨). */
export function useAiStatus() {
  const trpc = useTRPC();
  return useQuery({ ...trpc.ai.status.queryOptions(), staleTime: 60_000 });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Avvia un lavoro AI e ne attende il risultato (il worker lo elabora in background).
 * Gli errori vengono mostrati con un toast tradotto e la promessa restituisce null.
 */
export function useAiTask() {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const start = useMutation(trpc.ai.start.mutationOptions());
  const [running, setRunning] = useState(false);

  const run = useCallback(
    async <T>(tripId: string | null, input: AiInput): Promise<T | null> => {
      setRunning(true);
      try {
        const { id } = await start.mutateAsync({ tripId, input });
        const deadline = Date.now() + 5 * 60_000;
        for (let delay = 800; Date.now() < deadline; delay = Math.min(delay * 1.3, 3000)) {
          const job = await queryClient.fetchQuery({
            ...trpc.ai.job.queryOptions({ id }),
            staleTime: 0,
          });
          if (job.status === 'done') {
            void queryClient.invalidateQueries({ queryKey: trpc.ai.status.queryKey() });
            return job.result as T;
          }
          if (job.status === 'error') throw new Error(job.error ?? 'AI_FAILED');
          await sleep(delay);
        }
        throw new Error('AI_TIMEOUT');
      } catch (err) {
        const code = (err instanceof Error ? err.message : 'AI_FAILED').split(':')[0]!;
        toast.error(t(`ai.errors.${code}`, { defaultValue: t('ai.errors.AI_FAILED') }));
        return null;
      } finally {
        setRunning(false);
      }
    },
    [start, queryClient, trpc, t],
  );

  return { run, running };
}
