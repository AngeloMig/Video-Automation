import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { serviceDb } from "@/db/client";
import { isWorkerOnline } from "@/server/context";

/** For uptime monitors. Reports states only, with no configuration values. */
export async function GET() {
  try {
    await serviceDb().execute(sql`select 1`);
    const worker = await isWorkerOnline();
    return NextResponse.json({ status: "ok", database: "up", worker: worker ? "up" : "down" });
  } catch {
    return NextResponse.json({ status: "error", database: "down" }, { status: 503 });
  }
}
