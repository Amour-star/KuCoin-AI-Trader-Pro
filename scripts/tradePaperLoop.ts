import { spawn } from 'node:child_process';

const loopMs = Number(process.env.BOT_LOOP_MS || 15000);

const runOnce = () => {
  const child = spawn(process.execPath, ['--experimental-strip-types', 'scripts/tradeOnce.ts'], {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', code => {
    if (code && code !== 0) {
      console.error(`trade:once exited with ${code}`);
    }
  });
};

runOnce();
setInterval(runOnce, loopMs);
