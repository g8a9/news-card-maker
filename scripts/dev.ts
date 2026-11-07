// `npm run dev`: starts the proxy (wrangler dev on :8787) and the web app (Vite on :5173) together.
import { type ChildProcess, spawn } from 'node:child_process';

const run = (workspace: string): ChildProcess =>
  spawn('npm', ['run', 'dev', '-w', workspace], {
    stdio: 'inherit',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });

const children = [run('proxy'), run('web')];

const stop = () => {
  for (const child of children) child.kill('SIGTERM');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

for (const child of children) {
  child.on('exit', (code) => {
    process.exitCode ||= code ?? 0;
    stop();
  });
}
