/**
 * CSV no padrão do Excel brasileiro: separador ";", vírgula decimal e BOM
 * UTF-8 (sem o BOM o Excel quebra acentos).
 */
export type CsvCell = string | number | null | undefined;

function escapeCell(v: CsvCell): string {
  const s = v == null ? "" : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: CsvCell[][]): string {
  return "﻿" + [header, ...rows].map((r) => r.map(escapeCell).join(";")).join("\r\n") + "\r\n";
}

/** Centavos → "1234,56" (sem símbolo, para a planilha somar). */
export function centsCell(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

export function decimalCell(v: { toString(): string }): string {
  return v.toString().replace(".", ",");
}
