import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST() {
  const s = await prisma.chatSession.create({ data: {} });
  return NextResponse.json({ sessionId: s.id });
}
