import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Usado só pela CLI (migrations). Com pooler (ex.: Neon), as migrations precisam da
    // conexão direta: DIRECT_DATABASE_URL. O app em si usa DATABASE_URL (src/lib/db.ts).
    url: process.env.DIRECT_DATABASE_URL || env("DATABASE_URL"),
  },
});
