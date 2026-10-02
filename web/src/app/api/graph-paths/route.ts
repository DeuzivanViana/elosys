import { NextResponse } from "next/server";
import { getGraphPaths } from "@/lib/queries";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { newId?: unknown; existingIds?: unknown }
    | null;
  const newId = typeof body?.newId === "string" ? body.newId : "";
  const existingIds = Array.isArray(body?.existingIds)
    ? body.existingIds.filter((v): v is string => typeof v === "string")
    : [];
  return NextResponse.json(getGraphPaths(newId, existingIds));
}
