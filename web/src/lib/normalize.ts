
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function isCpfShaped(query: string): boolean {
  return digitsOnly(query).length >= 6 && digitsOnly(query).length === query.replace(/[.\-\s]/g, "").length;
}
