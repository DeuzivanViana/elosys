import { NextResponse } from "next/server";
import { searchEntities } from "@/lib/queries";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const results = searchEntities(q, 15);
  return NextResponse.json({ results });
}
