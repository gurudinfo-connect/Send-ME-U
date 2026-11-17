import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../generated/prisma/client';
import { env } from '../config/env';

const url = new URL(env.DATABASE_URL);
const schema = url.searchParams.get('schema') || 'public';
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL, max: Number(process.env.DB_POOL_MAX || 10) }, { schema });
export const prisma = new PrismaClient({ adapter });
export { Prisma };
export type Tx = Prisma.TransactionClient;
