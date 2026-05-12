import { PrismaClient } from "@campux/db";
import { loadConfig } from "@campux/config";

process.env.DATABASE_URL ??= loadConfig().databaseUrl;

export const prisma = new PrismaClient();
