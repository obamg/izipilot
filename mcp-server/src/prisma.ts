import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __mcpPrisma: PrismaClient | undefined;
}

export const prisma =
  global.__mcpPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__mcpPrisma = prisma;
}
