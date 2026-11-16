/** Validação de CPF/CNPJ (dígitos verificadores). Recebe só dígitos. */

function allSameDigits(d: string) {
  return /^(\d)\1+$/.test(d);
}

export function isValidCpf(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || allSameDigits(cpf)) return false;
  const digits = cpf.split("").map(Number);
  for (const len of [9, 10]) {
    const sum = digits.slice(0, len).reduce((acc, n, i) => acc + n * (len + 1 - i), 0);
    const check = ((sum * 10) % 11) % 10;
    if (check !== digits[len]) return false;
  }
  return true;
}

export function isValidCnpj(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj) || allSameDigits(cnpj)) return false;
  const digits = cnpj.split("").map(Number);
  const weights = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (const len of [12, 13]) {
    const w = weights.slice(weights.length - len);
    const sum = digits.slice(0, len).reduce((acc, n, i) => acc + n * w[i], 0);
    const rest = sum % 11;
    const check = rest < 2 ? 0 : 11 - rest;
    if (check !== digits[len]) return false;
  }
  return true;
}

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function isValidCpfOrCnpj(value: string): boolean {
  const d = onlyDigits(value);
  return d.length === 11 ? isValidCpf(d) : isValidCnpj(d);
}
