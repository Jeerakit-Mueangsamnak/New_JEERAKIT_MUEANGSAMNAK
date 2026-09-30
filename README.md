# rental-pos

ระบบ POS สำหรับงานเช่าและขาย พัฒนาด้วย Next.js 15, Supabase, Zustand และ Tailwind CSS

## Prerequisites

- Node.js 20
- pnpm

## Setup

ติดตั้ง dependencies:

pnpm workspace:setup

สร้างไฟล์ environment จากตัวอย่าง:

Copy-Item .env.example .env.local

จากนั้นกำหนดค่าใน .env.local:

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=

SUPABASE_SECRET_KEY ใช้เฉพาะฝั่ง server และห้ามนำไปใช้ใน client-side code

## Development

pnpm dev

หรือรันเฉพาะ localhost:

pnpm dev:local

## Scripts

- pnpm dev = รัน Next.js development server
- pnpm dev:local = รันที่ 127.0.0.1:3000
- pnpm build = สร้าง production build
- pnpm start = รัน production server
- pnpm test = รัน Vitest
- pnpm test:watch = รัน Vitest แบบ watch
- pnpm lint = ตรวจ ESLint
- pnpm typecheck = ตรวจ TypeScript
- pnpm quality = ตรวจ typecheck แบบ strict และ lint
- pnpm verify = รัน typecheck, tests, lint และ build

## Project Structure

app/
components/
features/
lib/
supabase/
tests/
docs/

กฎและข้อกำหนดหลักของโปรเจกต์:
docs/PROJECT_RULES_MASTER_CURRENT.md
