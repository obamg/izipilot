import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

declare global {
  // eslint-disable-next-line no-var
  var __mcpPrisma: PrismaClient | undefined;
}

export const prisma =
  global.__mcpPrisma ??
  new PrismaClient({
    // Prisma 7 requires a driver adapter for SQL databases.
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    log: process.env.NODE_ENV === "production" ? ["error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__mcpPrisma = prisma;
}
