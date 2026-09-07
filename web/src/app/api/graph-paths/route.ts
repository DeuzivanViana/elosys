import { NextResponse } from "next/server";
import { getGraphPaths } from "@/lib/queries";

/** Given the node just added (`newId`) and everything already on the canvas
 * (`existingIds`), returns every link of distance <= 2 between them --
 * direct edges plus one-intermediary connector nodes. Only actual
 * connectors come back, never a whole neighbourhood; the frontend caps how
 * many to render (see graph-canvas.tsx). */
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
