import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from '../env.js';

export function createTransport(env: Env): Transporter {
  return nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
    auth: env.smtp.auth,
    tls: { rejectUnauthorized: env.smtp.rejectUnauthorized },
  });
}
