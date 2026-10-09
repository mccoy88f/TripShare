import { Queue } from 'bullmq';
import type { Locale } from '@tripshare/shared';
import type { Env } from '../env.js';
import { renderEmail, type EmailTemplate } from './templates.js';
import { createTransport } from './transport.js';

export interface EmailJob {
  to: string;
  locale: Locale;
  template: EmailTemplate;
}

/** Invia un'email: in produzione la mette in coda per il worker, nei test la cattura. */
export interface EmailSender {
  send(job: EmailJob): Promise<void>;
}

export const EMAIL_QUEUE = 'email';

export function createQueuedEmailSender(queue: Queue<EmailJob>): EmailSender {
  return {
    async send(job) {
      await queue.add('send', job, {
        attempts: 6,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
        removeOnFail: { age: 30 * 24 * 3600 },
      });
    },
  };
}

/** Invio immediato, senza coda: usato dal worker e dall'email di prova del pannello. */
export function createDirectEmailSender(env: Env) {
  const transport = createTransport(env);
  return {
    transport,
    async send(job: EmailJob) {
      const rendered = renderEmail(job.template, job.locale, env.APP_NAME);
      await transport.sendMail({ from: env.smtp.from, to: job.to, ...rendered });
    },
  };
}

export { renderEmail, type EmailTemplate };
