#!/usr/bin/env node
/**
 * Starts the DrAITranscription Flask server (app.py).
 * Uses the venv in DrAITranscription if present, otherwise system python.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const transcriptionDir = path.join(repoRoot, 'DrAITranscription');
const isWin = process.platform === 'win32';
const venvPython = path.join(
  transcriptionDir,
  isWin ? 'venv\\Scripts\\python.exe' : 'venv/bin/python'
);
const appPy = path.join(transcriptionDir, 'app.py');

const python = fs.existsSync(venvPython) ? venvPython : 'python';

const child = spawn(python, [appPy], {
  cwd: transcriptionDir,
  stdio: 'inherit',
  shell: isWin,
});

child.on('error', (err) => {
  console.error('Failed to start transcription server:', err.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
