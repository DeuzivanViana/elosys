import { NextResponse } from "next/server";
import { getPersonCategoryExpenseDetail, EXPENSE_CATEGORIES } from "@/lib/queries";

const ALL = "TODAS";

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const personId = Number(sp.get("personId"));
  if (!Number.isInteger(personId)) return NextResponse.json({ rows: [] });

  const categoriaParam = sp.get("categoria");
  const category =
    categoriaParam === ALL || categoriaParam == null ? undefined
    : EXPENSE_CATEGORIES.includes(categoriaParam) ? categoriaParam
    : undefined;

  const anoParam = sp.get("ano");
  const year = anoParam != null && anoParam !== ALL && Number.isInteger(Number(anoParam)) ? Number(anoParam) : undefined;

  return NextResponse.json({ rows: getPersonCategoryExpenseDetail(personId, category, year) });
}
