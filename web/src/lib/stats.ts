import { db } from "./db";
import {
  getCircularDonationSummary,
  getSupplierPartnerSummary,
  getAiReviewSummary,
  getDiscourseSummary,
} from "./queries";

export type HomeStats = {
  people: number;
  candidacies: number;
  campaignOrgs: number;
  socialMedia: number;
  donationsTotalCents: number;
  expensesTotalCents: number;
  years: string;
};

// Elosys's .db is rewrite-only (see ADs/imutabilidade.md): it only changes
// when a crawler is re-run and this server process is restarted — never
// mid-process. So these full-table SUMs (over 5M+/9M+ rows) are safe to
// compute once per process and reuse, instead of on every home page visit.
// Keyed by year (0 = "todos os anos") so the ?ano= filter on the home page
// doesn't redo the full-table scan more than once per year either.
const cache = new Map<number, HomeStats>();

export function getHomeStats(year?: number): HomeStats {
  const key = year ?? 0;
  const hit = cache.get(key);
  if (hit) return hit;

  const yearFilter = year != null ? " WHERE year = ?" : "";
  const args = year != null ? [year] : [];
  const c = (sql: string) => (db().prepare(sql).get(...args) as { n: number }).n;
  const sum = (sql: string) => (db().prepare(sql).get(...args) as { n: number }).n ?? 0;
  const years = db()
    .prepare("SELECT min(year) lo, max(year) hi FROM politician_history")
    .get() as { lo: number; hi: number };

  const result: HomeStats = {
    people:
      year != null
        ? c("SELECT count(DISTINCT person_id) n FROM politician_history WHERE year = ?")
        : c("SELECT count(*) n FROM people"),
    candidacies: c(`SELECT count(*) n FROM politician_history${yearFilter}`),
    campaignOrgs: c(`SELECT count(*) n FROM campaign_org${yearFilter}`),
    socialMedia: c(`SELECT count(*) n FROM social_media${yearFilter}`),
    donationsTotalCents: sum(`SELECT coalesce(sum(amount_cents),0) n FROM campaign_donation${yearFilter}`),
    expensesTotalCents: sum(`SELECT coalesce(sum(amount_cents),0) n FROM campaign_expense${yearFilter}`),
    years: year != null ? String(year) : years.lo && years.hi ? `${years.lo}–${years.hi}` : "—",
  };
  cache.set(key, result);
  return result;
}

export type SidebarCounts = {
  circularDonations: number;
  supplierPartner: number;
  aiReview: number;
  discourse: number;
};

// Same rewrite-only reasoning as getHomeStats: safe to cache per process.
let cachedCounts: SidebarCounts | null = null;

export function getSidebarCounts(): SidebarCounts {
  if (cachedCounts) return cachedCounts;
  cachedCounts = {
    circularDonations: getCircularDonationSummary().total,
    supplierPartner: getSupplierPartnerSummary().total,
    aiReview: getAiReviewSummary().total,
    discourse: getDiscourseSummary().total,
  };
  return cachedCounts;
}
