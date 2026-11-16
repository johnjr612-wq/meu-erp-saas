/** Roda uma vez na subida do servidor: valida a configuração antes de atender requisições. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { checkEnv } = await import("./lib/env");
  const { errors, warnings } = checkEnv();
  for (const w of warnings) console.warn(`[config] ${w}`);
  if (errors.length) {
    const msg = `[config] Configuração inválida:\n  - ${errors.join("\n  - ")}`;
    if (process.env.NODE_ENV === "production") throw new Error(msg);
    console.error(msg);
  }
}
