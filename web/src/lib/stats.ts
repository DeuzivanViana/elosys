import { db } from "./db";

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
let cached: HomeStats | null = null;

export function getHomeStats(): HomeStats {
  if (cached) return cached;

  const c = (sql: string) => (db().prepare(sql).get() as { n: number }).n;
  const sum = (sql: string) => (db().prepare(sql).get() as { n: number }).n ?? 0;
  const years = db()
    .prepare("SELECT min(year) lo, max(year) hi FROM politician_history")
    .get() as { lo: number; hi: number };

  cached = {
    people: c("SELECT count(*) n FROM people"),
    candidacies: c("SELECT count(*) n FROM politician_history"),
    campaignOrgs: c("SELECT count(*) n FROM campaign_org"),
    socialMedia: c("SELECT count(*) n FROM social_media"),
    donationsTotalCents: sum("SELECT coalesce(sum(amount_cents),0) n FROM campaign_donation"),
    expensesTotalCents: sum("SELECT coalesce(sum(amount_cents),0) n FROM campaign_expense"),
    years: years.lo && years.hi ? `${years.lo}–${years.hi}` : "—",
  };
  return cached;
}
