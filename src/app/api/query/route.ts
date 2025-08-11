import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { embed, cosine } from "@/lib/embeddings";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  const { question, topK = 8 } = await req.json();
  if (!question) return NextResponse.json({ error: "question is required" }, { status: 400 });

  const [qVec] = await embed([question]);

  const rows = await prisma.chunk.findMany({
    take: 1000,
    select: { content: true, embedding: true },
  });

  const scored = rows
    .map(r => ({ content: r.content, score: cosine(qVec, r.embedding as number[]) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  const context = scored.map((s, i) => `[#${i + 1} score=${s.score.toFixed(3)}]\n${s.content}`).join("\n\n");

  const system =
    "Eres un asistente conciso. Responde SOLO con información respaldada por el contexto. " +
    "Si no hay evidencia suficiente, di explícitamente que no está en los datos.";

  const user = `Pregunta: ${question}\n\nContexto:\n${context}`;

  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const answer = completion.choices[0]?.message?.content ?? "";
  return NextResponse.json({ answer, usedChunks: scored.length });
}
