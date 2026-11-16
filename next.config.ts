import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ERP: todas as telas são dinâmicas por usuário/organização, por isso
  // cacheComponents fica desligado (renderização por requisição).
  serverExternalPackages: ["@prisma/client", "pg"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
