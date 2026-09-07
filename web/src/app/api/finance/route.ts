import { NextResponse } from "next/server";
import { getFinancePage, type FinanceQuery, type FinanceSort } from "@/lib/queries";

const SORTS: FinanceSort[] = ["amount", "paid", "year", "date", "name"];

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
  const params: FinanceQuery = {
    scope,
    dir: dir as FinanceQuery["dir"],
    id,
    page: Number(sp.get("page")) || 1,
    q: sp.get("q") ?? "",
    sort: SORTS.includes(sortParam as FinanceSort) ? (sortParam as FinanceSort) : "amount",
    order: sp.get("order") === "asc" ? "asc" : "desc",
  };
  return NextResponse.json(getFinancePage(params));
}
