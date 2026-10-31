// Builds (unless --no-build) and serves the app on 127.0.0.1:3100 against Supabase Local only.
// Every value in local-env.json overrides .env.local, which points at the real Cloud project.
//   node e2e/serve-local.mjs            build + start
//   node e2e/serve-local.mjs --no-build start the last build
import { spawnSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const local = JSON.parse(readFileSync(new URL('./local-env.json', import.meta.url), 'utf8'));
const env = { ...process.env, ...local };
const opts = { env, stdio: 'inherit', shell: true };

if (!process.argv.includes('--no-build')) {
  const build = spawnSync('pnpm exec next build', opts);
  if (build.status !== 0) process.exit(build.status ?? 1);
}
spawn('pnpm exec next start -H 127.0.0.1 -p 3100', opts).on('exit', (code) => process.exit(code ?? 0));
