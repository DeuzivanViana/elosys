/**
 * Mirrors elosys/util.py's normalize_name() and digits_only() — the DB stores
 * people.canonical_name already uppercased/accent-stripped, so search input
 * has to go through the same transform to match.
 */

export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents
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
