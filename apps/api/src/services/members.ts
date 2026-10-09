import { eq } from 'drizzle-orm';
import { tripMember, user, type Database } from '@tripshare/db';

/** Membri di un viaggio con i dati del profilo per chi ha un account (nome, foto, emoji). */
export async function listMembers(db: Database, tripId: string) {
  const rows = await db
    .select({
      member: tripMember,
      userName: user.name,
      image: user.image,
      userEmoji: user.avatarEmoji,
      userColor: user.avatarColor,
      paypalMe: user.paypalMe,
    })
    .from(tripMember)
    .leftJoin(user, eq(user.id, tripMember.userId))
    .where(eq(tripMember.tripId, tripId))
    .orderBy(tripMember.createdAt);
  return rows.map((r) => ({
    id: r.member.id,
    userId: r.member.userId,
    name: r.userName ?? r.member.name,
    image: r.image ?? null,
    avatarEmoji: r.member.userId ? (r.userEmoji ?? null) : r.member.avatarEmoji,
    avatarColor: r.member.userId ? (r.userColor ?? null) : r.member.avatarColor,
    paypalMe: r.paypalMe ?? null,
    role: r.member.role,
    placeholder: !r.member.userId,
    /** Invitato via email che non ha ancora accettato. */
    invitedEmail: r.member.userId ? null : r.member.invitedEmail,
    removed: !!r.member.removedAt,
  }));
}

export type TripMemberView = Awaited<ReturnType<typeof listMembers>>[number];
