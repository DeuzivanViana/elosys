import { NextResponse } from "next/server";
import { getFinancePage, type FinanceQuery, type FinanceSort } from "@/lib/queries";

const SORTS: FinanceSort[] = ["amount", "paid", "year", "date", "name"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(v: string | null): string | undefined {
  return v && DATE_RE.test(v) ? v : undefined;
}

function parseCents(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

/** Paginated + name-searchable campaign finance for a profile page's
 * <FinanceTable>. `scope=candidate` + `dir=received|spent`, or
 * `scope=entity` + `dir=given|received`. */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const scope = sp.get("scope");
  const dir = sp.get("dir");
  const id = sp.get("id") ?? "";
  if ((scope !== "candidate" && scope !== "entity") || !id) {
    return NextResponse.json({ rows: [], total: 0, pageSize: 25 });
  }
  const validDir =
    scope === "candidate"
      ? dir === "received" || dir === "spent"
      : dir === "given" || dir === "received";
  if (!validDir) return NextResponse.json({ rows: [], total: 0, pageSize: 25 });

  const sortParam = sp.get("sort");
  const yearParam = Number(sp.get("year"));
  const params: FinanceQuery = {
    scope,
    dir: dir as FinanceQuery["dir"],
    id,
    page: Number(sp.get("page")) || 1,
    q: sp.get("q") ?? "",
    sort: SORTS.includes(sortParam as FinanceSort) ? (sortParam as FinanceSort) : "amount",
    order: sp.get("order") === "asc" ? "asc" : "desc",
    year: Number.isInteger(yearParam) && yearParam > 0 ? yearParam : undefined,
    dateFrom: parseDate(sp.get("dateFrom")),
    dateTo: parseDate(sp.get("dateTo")),
    amountMinCents: parseCents(sp.get("amountMin")),
    amountMaxCents: parseCents(sp.get("amountMax")),
    onlyPoliticianOwned: sp.get("onlyPoliticianOwned") === "1",
  };
  return NextResponse.json(getFinancePage(params));
}
