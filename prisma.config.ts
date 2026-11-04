// Prisma 7 CLI config (migrate, generate, seed). The CLI no longer reads .env
// by itself: dotenv loads it locally; in Docker the vars are already set.
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
