
# rental-pos

ระบบ POS สำหรับงานเช่าและขาย พัฒนาด้วย Next.js 15, Supabase, Zustand และ Tailwind CSS

## Prerequisites

- Node.js 20
- pnpm

## Setup

ติดตั้ง dependencies:

```bash
pnpm workspace:setup
```

สร้างไฟล์ environment จากตัวอย่าง (PowerShell):

```powershell
Copy-Item .env.example .env.local
```

กำหนดค่าใน `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
```

**ความปลอดภัย:** `SUPABASE_SECRET_KEY` ใช้เฉพาะฝั่ง Server เท่านั้น ห้ามนำไปใช้ใน Client-side Code

## Development

รัน Development Server:

```bash
pnpm dev
```

รันเฉพาะ localhost:

```bash
pnpm dev:local
```

## Scripts

| คำสั่ง | หน้าที่ |
|---|---|
| `pnpm dev` | รัน Next.js Development Server |
| `pnpm dev:local` | รันที่ 127.0.0.1:3000 |
| `pnpm build` | สร้าง Production Build |
| `pnpm start` | รัน Production Server |
| `pnpm test` | รัน Vitest |
| `pnpm test:watch` | รัน Vitest แบบ Watch |
| `pnpm lint` | ตรวจ ESLint |
| `pnpm typecheck` | ตรวจ TypeScript |
| `pnpm quality` | ตรวจ Typecheck แบบ Strict และ Lint |
| `pnpm verify` | รัน Typecheck, Tests, Lint และ Build |

## Project Structure

```text
app/
components/
features/
lib/
supabase/
tests/
docs/
```