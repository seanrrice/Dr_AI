#!/usr/bin/env node
/**
 * Starts the Gait Flask server (Gait/gait_api.py) on http://127.0.0.1:8000.
 * Vite proxies /api/gait to that port (see vite.config.js).
 *
 * cwd must be the Gait folder so gait_outputs resolves correctly.
 */
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const gaitDir = path.join(repoRoot, 'Gait');
const gaitApi = path.join(gaitDir, 'gait_api.py');
const isWin = process.platform === 'win32';

// Do NOT use DrAITranscription/venv here: it pins protobuf 6.x, which breaks MediaPipe.
//
// Prefer .venv_face FIRST: a partial Gait/venv may install a newer mediapipe wheel
// that only exposes `tasks` (no `mp.solutions`), which breaks gait_capture_realsense_advanced.py.
// Gait/venv is used only if .venv_face is missing.
const venvCandidates = isWin
  ? [
      path.join(repoRoot, '.venv_face', 'Scripts', 'python.exe'),
      path.join(gaitDir, 'venv', 'Scripts', 'python.exe'),
    ]
  : [
      path.join(repoRoot, '.venv_face', 'bin', 'python3'),
      path.join(gaitDir, 'venv', 'bin', 'python3'),
      path.join(gaitDir, 'venv', 'bin', 'python'),
    ];

let python;
let pythonArgs;
const found = venvCandidates.find((p) => existsSync(p));
if (found) {
  python = found;
  pythonArgs = ['-u', gaitApi];
} else if (isWin) {
  python = 'py';
  pythonArgs = ['-3.11', '-u', gaitApi];
} else {
  python = 'python3';
  pythonArgs = ['-u', gaitApi];
}

if (!existsSync(gaitApi)) {
  console.error('Gait server not found:', gaitApi);
  process.exit(1);
}

const child = spawn(python, pythonArgs, {
  cwd: gaitDir,
  stdio: 'inherit',
  shell: false,
  env: {
    ...process.env,
    PYTHONUNBUFFERED: '1',
  },
});

child.on('error', (err) => {
  console.error('Failed to start gait server:', err.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
