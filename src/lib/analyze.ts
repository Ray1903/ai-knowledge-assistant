import { parse } from "csv-parse/sync";
import { prisma } from "@/lib/db";
import * as ss from "simple-statistics";

type ColType = "numeric" | "categorical" | "datetime" | "text";

function inferType(values: (string | null)[]): ColType {
  let num = 0, dt = 0, cat = 0, txt = 0;
  const sample = values.slice(0, 500);
  for (const v of sample) {
    if (v == null || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) { num++; continue; }
    const t = Date.parse(v);
    if (Number.isFinite(t)) { dt++; continue; }
    if (v.length <= 30) { cat++; continue; }
    txt++;
  }
  const scores: Record<ColType, number> = {
    numeric: num, datetime: dt, categorical: cat, text: txt
  };
  return Object.entries(scores).sort((a,b)=>b[1]-a[1])[0][0] as ColType;
}

function toNumberArray(values: (string|null)[]) {
  return values
    .map(v => (v==null || v==="") ? null : Number(v))
    .filter((v): v is number => Number.isFinite(v as number));
}

function quantiles(x: number[]) {
  if (x.length < 3) return { p25: null, p50: null, p75: null };
  return {
    p25: ss.quantileSorted([...x].sort((a,b)=>a-b), 0.25),
    p50: ss.median(x),
    p75: ss.quantileSorted([...x].sort((a,b)=>a-b), 0.75),
  };
}

const TARGET_HINTS = ["target","label","y","objetivo","clase"];

export async function analyzeAndStore(documentId: string, csvBuffer: Buffer) {
  const rows: string[][] = parse(csvBuffer.toString("utf8"), {
    skip_empty_lines: true,
  });

  if (!rows.length) throw new Error("CSV vacío");
  const header = rows[0];
  const data = rows.slice(1);

  const cols = header.length;
  const rowsCount = data.length;

  // por columna, recolectar valores (como strings)
  const columnValues: (string|null)[][] = Array.from({ length: cols }, () => []);
  for (const r of data) {
    for (let c=0;c<cols;c++){
      columnValues[c].push((r[c] ?? "").trim());
    }
  }

  // inferir tipos y stats
  const profiles = [];
  let target: string | null = null;

  // heurística target
  for (const h of TARGET_HINTS) {
    const idx = header.findIndex(n => n.toLowerCase() === h);
    if (idx >= 0) { target = header[idx]; break; }
  }
  if (!target && header.length) target = header[header.length-1]; // fallback: última columna

  // calcular stats
  for (let c=0;c<cols;c++){
    const name = header[c];
    const values = columnValues[c].map(v => v === "" ? null : v);
    const missing = values.filter(v => v==null).length;
    const dtype = inferType(values);

    let distinct: number | undefined;
    let mean: number | undefined;
    let std: number | undefined;
    let min: number | undefined;
    let max: number | undefined;
    let p25: number | undefined;
    let p50: number | undefined;
    let p75: number | undefined;

    if (dtype === "numeric") {
      const nums = toNumberArray(values);
      if (nums.length) {
        mean = ss.mean(nums);
        std  = nums.length > 1 ? ss.standardDeviation(nums) : 0;
        min  = Math.min(...nums);
        max  = Math.max(...nums);
        const q = quantiles(nums);
        p25 = q.p25 ?? undefined;
        p50 = q.p50 ?? undefined;
        p75 = q.p75 ?? undefined;
      }
    } else if (dtype === "categorical") {
      const set = new Set(values.filter((v): v is string => v!=null));
      distinct = set.size;
    }

    profiles.push({
      name, dtype, missing, distinct,
      mean, std, min, max, p25, p50, p75
    });
  }

  // inferir tarea
  let inferredTask: "classification"|"regression"|"unknown" = "unknown";
  if (target) {
    const tIdx = header.indexOf(target);
    const tType = profiles[tIdx]?.dtype;
    if (tType === "numeric") inferredTask = "regression";
    else if (tType === "categorical") inferredTask = "classification";
  }

  // guardar en BD
  const ds = await prisma.datasetProfile.upsert({
    where: { documentId },
    update: {},
    create: {
      documentId: documentId,
      rows: rowsCount,
      cols,
      inferredTask,
      target,
      columns: {
        create: profiles.map(p => ({
          name: p.name,
          dtype: p.dtype,
          missing: p.missing,
          distinct: p.distinct ?? null,
          mean: p.mean ?? null,
          std: p.std ?? null,
          min: p.min ?? null,
          max: p.max ?? null,
          p25: p.p25 ?? null,
          p50: p.p50 ?? null,
          p75: p.p75 ?? null,
        }))
      }
    },
    include: { columns: true }
  });

  return ds;
}
