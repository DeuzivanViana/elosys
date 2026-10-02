export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatCpfCnpj(digits: string | null): string {
  if (!digits) return "não disponível";
  return digits.length === 14 ? formatCnpj(digits) : formatCpf(digits);
}

export function formatCpf(cpf: string | null): string {
  if (!cpf || cpf.length !== 11) return "não disponível";
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

export function formatCnpj(cnpj: string): string {
  if (cnpj.length !== 14) return cnpj;
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
}

export function entityHref(digits: string | null): string | null {
  if (!digits) return null;
  if (digits.length === 14) return `/cnpj/${digits}`;
  if (digits.length === 11) return `/cpf/${digits}`;
  return null;
}

const PLATFORM_LABEL: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X (Twitter)",
  youtube: "YouTube",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  kwai: "Kwai",
  website: "Site",
  other: "Outro",
};

export function platformLabel(platform: string): string {
  return PLATFORM_LABEL[platform] ?? platform;
}

const RESULT_TONE: Record<string, "green" | "red" | "neutral"> = {
  ELEITO: "green",
  "ELEITO POR MÉDIA": "green",
  "ELEITO POR QP": "green",
  "NÃO ELEITO": "red",
  SUPLENTE: "neutral",
};

export function resultTone(result: string | null): "green" | "red" | "neutral" {
  if (!result) return "neutral";
  return RESULT_TONE[result.toUpperCase()] ?? "neutral";
}

const EXPENSE_CATEGORY_LABEL: Record<string, string> = {
  CANETA: "Canetas",
  LAPIS: "Lápis",
  LAPISEIRA: "Lapiseiras",
  BORRACHA: "Borrachas",
  APONTADOR: "Apontadores",
  ADESIVO: "Adesivos",
  CRACHA: "Crachás",
  ETIQUETA: "Etiquetas",
  CLIPS: "Clipes",
  GRAMPO: "Grampos",
  GRAMPEADOR: "Grampeadores",
  REGUA: "Réguas",
  "BLOCO DE ANOTA": "Blocos de anotação",
  ENVELOPE: "Envelopes",
  "MARCADOR DE TEXTO": "Marcadores de texto",
  PRANCHETA: "Pranchetas",
  PERFURADOR: "Perfuradores",
  ELASTICO: "Elásticos",
};

export function expenseCategoryLabel(category: string): string {
  return EXPENSE_CATEGORY_LABEL[category] ?? category;
}

export function formatPct(pct: number): string {
  return `${pct.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}
