import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { embed } from "@/lib/embeddings";
import { parse } from "csv-parse/sync";
import { analyzeAndStore } from "@/lib/analyze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function chunkText(text: string, maxChars = 800) {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) chunks.push(text.slice(i, i + maxChars));
  return chunks;
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "file is required" }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "text/plain";
  let content = "";

  let isCSV = false;
  if (mime.includes("csv") || file.name.toLowerCase().endsWith(".csv")) {
    isCSV = true;
    const rows: string[][] = parse(buf.toString("utf8"), { skip_empty_lines: true });
    content = rows.map(r => r.join(",")).join("\n");
  } else {
    content = buf.toString("utf8");
  }

  const chunks = chunkText(content);
  const embeddings = await embed(chunks);

  const doc = await prisma.document.create({
    data: {
      filename: file.name,
      mime,
      chunks: { create: chunks.map((c, i) => ({ content: c, embedding: embeddings[i] })) }
    },
    include: { chunks: true }
  });

  // Perfilado si es CSV
  let dataset: any = null;
  if (isCSV) {
    dataset = await analyzeAndStore(doc.id, buf);
  }

  return NextResponse.json({
    ok: true,
    documentId: doc.id,
    chunks: doc.chunks.length,
    dataset: dataset ? {
      id: dataset.id, rows: dataset.rows, cols: dataset.cols,
      inferredTask: dataset.inferredTask, target: dataset.target,
    } : null
  });
}
