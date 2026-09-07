import { NextResponse } from "next/server";
import { getTopSuppliers } from "@/lib/queries";

export async function GET(request: Request) {
  const yearParam = new URL(request.url).searchParams.get("year");
  const year = yearParam && yearParam !== "all" ? Number(yearParam) : null;
  const suppliers = getTopSuppliers(year, 10);
  return NextResponse.json({ suppliers });
}
