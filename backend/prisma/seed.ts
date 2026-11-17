/**
 * Seeds the database.
 *  - ALWAYS: the first administrator from ADMIN_EMAIL / ADMIN_PASSWORD (idempotent; an existing admin's password is never overwritten).
 *  - ONLY with SEED_DEMO=true: a few demo accounts that follow each other and have one chat, for local development.
 * Production should never set SEED_DEMO. There is no fake content in the app itself.
 */
import { env } from '../src/config/env';
import { hashPassword } from '../src/lib/crypto';
import { prisma } from '../src/lib/db';

async function admin() {
  const email = env.ADMIN_EMAIL.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) { if (existing.role !== 'ADMIN') await prisma.user.update({ where: { id: existing.id }, data: { role: 'ADMIN' } }); console.log(`admin exists: ${email}`); return; }
  if (env.NODE_ENV === 'production' && env.ADMIN_PASSWORD === 'ChangeMe!12345') throw new Error('Set a real ADMIN_PASSWORD before seeding production');
  await prisma.user.create({ data: { email, username: 'admin', fullName: 'Administrator', role: 'ADMIN', passwordHash: await hashPassword(env.ADMIN_PASSWORD), emailVerifiedAt: new Date(), profile: { create: {} }, settings: { create: {} } } });
  console.log(`admin created: ${email}`);
}

async function demo() {
  const pw = await hashPassword('Demo!Pass12345');
  const people = [['asha', 'Asha Rao'], ['ben', 'Ben Kumar'], ['chloe', 'Chloe Singh']] as const;
  const users = [];
  for (const [username, fullName] of people) {
    users.push(await prisma.user.upsert({ where: { username }, update: {}, create: { username, fullName, email: `${username}@demo.sendmeu.app`, passwordHash: pw, emailVerifiedAt: new Date(), profile: { create: { bio: 'Demo account' } }, settings: { create: {} } } }));
  }
  for (const a of users) for (const b of users) if (a.id !== b.id) await prisma.follow.upsert({ where: { followerId_followeeId: { followerId: a.id, followeeId: b.id } }, update: {}, create: { followerId: a.id, followeeId: b.id } });
  const { ensureDirectConversation, sendMessage } = await import('../src/modules/chat');
  const cid = await ensureDirectConversation(users[0].id, users[1].id);
  if (!(await prisma.message.count({ where: { conversationId: cid } }))) await sendMessage({ conversationId: cid, senderId: users[0].id, type: 'TEXT', text: 'Welcome to Send Me/U 👋' } as any);
  console.log('demo users: asha, ben, chloe  (password Demo!Pass12345)');
}

(async () => {
  await admin();
  if (process.env.SEED_DEMO === 'true') await demo();
})().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
