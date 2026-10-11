import { describe, expect, it } from 'vitest';
import { onAiDelta, pushAiEvent, waitForAiEvent } from './ai-events';

describe('eventi AI', () => {
  it('si sveglia subito quando il lavoro finisce, senza aspettare il tempo massimo', async () => {
    const started = Date.now();
    const waiting = waitForAiEvent('job-1', 5000);
    pushAiEvent({ jobId: 'job-1', phase: 'done' });
    await waiting;
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('non perde un evento arrivato prima di mettersi in attesa, e lo usa una volta sola', async () => {
    pushAiEvent({ jobId: 'job-2', phase: 'done' });
    await waitForAiEvent('job-2', 5000);
    const started = Date.now();
    await waitForAiEvent('job-2', 30);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });

  it('passa il testo della risposta solo a chi segue quel lavoro', () => {
    const seen: string[] = [];
    const stop = onAiDelta('job-3', (t) => seen.push(t));
    pushAiEvent({ jobId: 'job-3', phase: 'delta', text: 'Cia' });
    pushAiEvent({ jobId: 'altro', phase: 'delta', text: 'xx' });
    pushAiEvent({ jobId: 'job-3', phase: 'delta', text: 'Ciao' });
    stop();
    pushAiEvent({ jobId: 'job-3', phase: 'delta', text: 'Ciao!' });
    expect(seen).toEqual(['Cia', 'Ciao']);
  });
});
