import { NextResponse } from "next/server";
import { searchPeople } from "@/lib/queries";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const results = searchPeople(q, 25);
  return NextResponse.json({ results });
}
