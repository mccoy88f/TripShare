import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { user } from '@tripshare/db';
import { CURRENCY_CODES, LOCALES, normalizePaypalMe } from '@tripshare/shared';
import { TRPCError } from '@trpc/server';
import { authedProcedure, router } from '../trpc/init.js';

const ProfileUpdate = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  locale: z.enum(LOCALES).optional(),
  defaultCurrency: z.enum(CURRENCY_CODES).optional(),
  timezone: z.string().max(64).nullable().optional(),
  avatarEmoji: z.string().max(16).nullable().optional(),
  avatarColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .nullable()
    .optional(),
  paypalMe: z.string().max(80).nullable().optional(),
  theme: z.enum(['system', 'light', 'dark']).optional(),
});

export const meRouter = router({
  get: authedProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db.select().from(user).where(eq(user.id, ctx.user.id));
    if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      image: row.image,
      role: row.role,
      locale: row.locale,
      defaultCurrency: row.defaultCurrency,
      timezone: row.timezone,
      avatarEmoji: row.avatarEmoji,
      avatarColor: row.avatarColor,
      paypalMe: row.paypalMe,
      theme: row.theme,
    };
  }),

  update: authedProcedure.input(ProfileUpdate).mutation(async ({ ctx, input }) => {
    const patch: Partial<typeof user.$inferInsert> = { ...input, updatedAt: new Date() };
    if (input.paypalMe !== undefined && input.paypalMe !== null && input.paypalMe !== '') {
      const normalized = normalizePaypalMe(input.paypalMe);
      if (!normalized) throw new TRPCError({ code: 'BAD_REQUEST', message: 'INVALID_PAYPAL_ME' });
      patch.paypalMe = normalized;
    } else if (input.paypalMe === '') {
      patch.paypalMe = null;
    }
    await ctx.db.update(user).set(patch).where(eq(user.id, ctx.user.id));
    return { ok: true };
  }),
});
