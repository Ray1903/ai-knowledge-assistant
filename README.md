# AI Knowledge Assistant — README (MVP)

Asistente mínimo para **subir TXT/CSV**, hacer **preguntas con RAG** y, si el archivo es **CSV de ML**, generar un **perfil rápido** (tipos, nulos, stats, target y tarea) para dar recomendaciones básicas.

**Stack:** Next.js (TS) · Prisma · PostgreSQL (Docker, puerto 5433) · OpenAI.

---

## Deployment local (rápido)

### 1) Instalar dependencias

```bash
npm install
```

### 2) Variables de entorno (`.env` en la raíz)

```env
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/assistant?schema=public"
OPENAI_API_KEY=sk-xxx
OPENAI_MODEL=gpt-4o-mini
```

### 3) Base de datos en contenedor (`docker-compose.yml`)

```yaml
version: "3.9"
services:
  db:
    image: pgvector/pgvector:pg16
    container_name: rag_pg
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: assistant
    ports:
      - "5433:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

Levantar la DB:

```bash
docker compose up -d
```

### 4) Prisma

```bash
npx prisma generate
npx prisma migrate dev --name init
```

### 5) Ejecutar

```bash
npm run dev
# abre: http://localhost:3000
```

**Notas breves:** usa **5433** para no chocar con un Postgres local en 5432. Si Prisma marca credenciales, revisa `DATABASE_URL` y que el contenedor esté arriba.
