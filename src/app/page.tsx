"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type Role = "user" | "assistant";
type ChatMsg = { id: string; role: Role; content: string; meta?: string };

type ApiChatResponse = {
  routed: "rag" | "analyst";
  message: { role: "assistant"; content: string };
};

export default function Page() {
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      id: crypto.randomUUID(),
      role: "assistant",
      content:
        "Hola, soy tu asistente. Sube un TXT/CSV y pregúntame. Usa `/note tu texto` para guardar una nota.",
    },
  ]);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [creatingSession, setCreatingSession] = useState(true);

  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  // 1) Crear sesión persistente al cargar
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/chat/session", { method: "POST" });
        const j = await res.json();
        setSessionId(j.sessionId);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: "No pude crear la sesión de chat. Reintenta recargando la página.",
          },
        ]);
      } finally {
        setCreatingSession(false);
      }
    })();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    if (!sessionId) {
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", content: "La sesión aún no está lista." },
      ]);
      return;
    }

    // Comando rápido: /note ...
    if (text.startsWith("/note ")) {
      const noteText = text.slice(6).trim();
      if (!noteText) return;
      setInput("");
      setLoading(true);
      try {
        const res = await fetch("/api/tools/save-note", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: noteText }),
        });
        const j = await res.json();
        const ok = (res.ok && j?.ok) || false;
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "user", content: text },
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: ok ? `Nota guardada: ${j.id}` : `Error al guardar nota: ${j?.error || "desconocido"}`,
          },
        ]);
      } catch (err: any) {
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "user", content: text },
          { id: crypto.randomUUID(), role: "assistant", content: `Error: ${String(err)}` },
        ]);
      } finally {
        setLoading(false);
      }
      return;
    }

    // Chat normal multi-agente (envía sessionId)
    const userMsg: ChatMsg = { id: crypto.randomUUID(), role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const payload = {
        sessionId,
        messages: [...messages, userMsg].map((m) => ({ role: m.role, content: m.content })),
      };

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const j: ApiChatResponse & { error?: string } = await res.json();
      const assistantText = j?.message?.content || j?.error || "(sin respuesta)";
      const meta = j?.routed ? `Agente: ${j.routed === "rag" ? "RAG" : "Analista"}` : undefined;

      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", content: assistantText, meta },
      ]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", content: `Error: ${String(err)}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  // 2) Upload: además de chunks, muestra el perfil del dataset si vino en la respuesta
  async function onSelectFile(file: File) {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    setLoading(true);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const j = await res.json();

      let msg = res.ok
        ? `Archivo "${file.name}" procesado (${j.chunks} chunks).`
        : `Error al subir: ${j.error}`;

      if (res.ok && j.dataset) {
        const ds = j.dataset as { rows: number; cols: number; inferredTask: string; target?: string | null };
        msg += `\nDataset perfilado → filas: ${ds.rows}, columnas: ${ds.cols}, tarea: ${ds.inferredTask}` +
               (ds.target ? `, target: ${ds.target}` : "");
      }

      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", content: msg, meta: "Ingesta/Perfilado" },
      ]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", content: `Error: ${String(err)}` },
      ]);
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <main className="h-screen grid grid-rows-[auto,1fr,auto] bg-neutral-950 text-neutral-100">
      {/* Topbar */}
      <header className="border-b border-neutral-800 px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold">AI Knowledge Assistant</h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-neutral-400">
            {creatingSession
              ? "Creando sesión…"
              : sessionId
              ? `Sesión: ${sessionId.slice(0, 8)}…`
              : "Sin sesión"}
          </span>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept=".txt,.csv,.md,.log,.json,.ts,.tsx,.js,.py"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onSelectFile(f);
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="rounded-2xl border border-neutral-700 px-3 py-1.5 hover:bg-neutral-800"
            disabled={creatingSession}
            title={creatingSession ? "Esperando sesión…" : "Subir archivo"}
          >
            Subir archivo
          </button>
        </div>
      </header>

      {/* Mensajes */}
      <div ref={listRef} className="overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((m) => (
          <Bubble key={m.id} role={m.role} content={m.content} meta={m.meta} />
        ))}
        {loading && <div className="text-xs text-neutral-400 px-2">Generando respuesta…</div>}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-neutral-800 px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escribe… (Enter envía, Shift+Enter salto). /note para notas."
            rows={1}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                (e.currentTarget.form as HTMLFormElement)?.requestSubmit();
              }
            }}
            className="flex-1 resize-none rounded-2xl border border-neutral-700 bg-neutral-900 px-4 py-2 focus:outline-none focus:ring-1 focus:ring-neutral-600"
          />
          <button
            type="submit"
            disabled={loading || !input.trim() || creatingSession}
            className="rounded-2xl border border-neutral-700 px-4 py-2 hover:bg-neutral-800 disabled:opacity-50"
            title={creatingSession ? "Esperando sesión…" : "Enviar"}
          >
            Enviar
          </button>
        </div>
      </form>
    </main>
  );
}

function Bubble({ role, content, meta }: { role: Role; content: string; meta?: string }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={[
          "max-w-[80%] rounded-2xl px-4 py-2 whitespace-pre-wrap leading-relaxed",
          isUser
            ? "bg-blue-600/20 border border-blue-400/30"
            : "bg-neutral-900 border border-neutral-700",
        ].join(" ")}
      >
        {!isUser && (
          <div className="text-xs text-neutral-400 mb-1">
            Asistente {meta ? `• ${meta}` : ""}
          </div>
        )}
        <div className="text-sm">{content}</div>
      </div>
    </div>
  );
}
