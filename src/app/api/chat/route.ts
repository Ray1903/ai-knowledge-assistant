import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { prisma } from "@/lib/db";
import { embed, cosine } from "@/lib/embeddings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type Msg = { role: "user" | "assistant" | "system"; content: string };

export async function POST(req: NextRequest) {
  const { messages, topK = 8 } = (await req.json()) as {
    messages: Msg[];
    topK?: number;
  };

  if (!messages?.length) {
    return NextResponse.json({ error: "messages is required" }, { status: 400 });
  }

  // Último mensaje del usuario
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const question = lastUser?.content?.trim() || "";
  if (!question) {
    return NextResponse.json({ error: "last user message is empty" }, { status: 400 });
  }

  // Embedding de la pregunta y recuperación
  const [qVec] = await embed([question]);
  const rows = await prisma.chunk.findMany({
    take: 1000,
    select: { content: true, embedding: true },
  });

  const scored = rows
    .map((r) => ({ content: r.content, score: cosine(qVec, r.embedding as number[]) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  const topScore = scored[0]?.score ?? -1;
  // Umbral simple: ajusta si hace falta. 0.25–0.35 suele ir bien con text-embedding-3-small.
  const HAS_USEFUL_CONTEXT = topScore >= 0.30 && scored.length > 0;

  const context = scored
    .map((s, i) => `[#${i + 1} score=${s.score.toFixed(3)}]\n${s.content}`)
    .join("\n\n");

  // Historial corto para mantener coherencia
  const shortHistory = messages.filter((m) => m.role !== "system").slice(-6);

  let answer = "";

  if (HAS_USEFUL_CONTEXT) {
    // Modo RAG estricto pero amable: usa el contexto y responde natural.
    const system =
      "Eres un asistente útil y conciso. Usa el CONTEXTO dado para responder con precisión. " +
      "Si te preguntan explícitamente por lo que dicen los archivos y el contexto no alcanza, dilo con claridad. " +
      "Escribe de forma natural y conversacional.";

    const userWithContext: Msg = {
      role: "user",
      content:
        `CONTEXTO (trozos relevantes de archivos del usuario):\n${context}\n\n` +
        `PREGUNTA DEL USUARIO:\n${question}`,
    };

    const chat = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        { role: "system", content: system },
        ...shortHistory.slice(0, -1),
        userWithContext,
      ],
    });

    answer = chat.choices[0]?.message?.content ?? "";
  } else {
    // Modo charla general: conversa sin inventar hechos sobre los archivos.
    // Solo menciona la falta de evidencia si la pregunta pide explícitamente “según mis archivos / en el CSV / documento”.
    const system =
      "Eres un asistente conversacional, claro y amigable. Responde con conocimiento general cuando no haya " +
      "evidencia en los archivos del usuario. NO inventes detalles sobre archivos privados. " +
      "Solo menciona la falta de evidencia en los archivos si la pregunta del usuario lo solicita explícitamente " +
      "(por ejemplo: '¿qué dice mi CSV?'). Puedes hacer preguntas aclaratorias y proponer caminos.";

    const chat = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.6, // un poco más creativo para charla
      messages: [
        { role: "system", content: system },
        ...shortHistory, // aquí sí dejamos el historial tal cual
      ],
    });

    answer = chat.choices[0]?.message?.content ?? "";
  }

  return NextResponse.json({ message: { role: "assistant", content: answer } });
}
