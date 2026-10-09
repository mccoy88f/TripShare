import { bigserial, boolean, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './auth.js';

/**
 * Impostazioni dell'istanza modificabili dal pannello super admin.
 * Se `encrypted` è true, `value` contiene { iv, tag, data } cifrati con ENCRYPTION_KEY.
 */
export const appSetting = pgTable('app_setting', {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  encrypted: boolean().notNull().default(false),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedBy: text().references(() => user.id, { onDelete: 'set null' }),
});

/** Registro delle azioni amministrative e degli eventi di sicurezza. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    actorId: text().references(() => user.id, { onDelete: 'set null' }),
    action: text().notNull(),
    targetType: text(),
    targetId: text(),
    data: jsonb(),
    ip: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_created_at_idx').on(t.createdAt)],
);
