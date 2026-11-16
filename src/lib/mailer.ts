import "server-only";

type Mail = { to: string; subject: string; html: string; text: string };

/**
 * Envia e-mail transacional via Resend (HTTP). Sem RESEND_API_KEY, não envia
 * e retorna false — o chamador deve oferecer outra forma (ex.: copiar o link).
 */
export async function sendMail(mail: Mail): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return false;

  try {
    const baseUrl = process.env.RESEND_API_URL ?? "https://api.resend.com";
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text }),
    });
    if (!res.ok) {
      console.error("[mailer] falha ao enviar:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("[mailer] erro de rede:", err);
    return false;
  }
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
