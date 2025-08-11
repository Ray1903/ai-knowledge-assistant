import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { text } = await req.json();
  if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });

  const note = await prisma.note.create({ data: { text } });
  return NextResponse.json({ ok: true, id: note.id, createdAt: note.createdAt });
}
