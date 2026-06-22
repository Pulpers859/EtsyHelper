import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function runGit(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function getStagedFiles() {
  const output = runGit(['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function getStagedText(filePath) {
  try {
    return execFileSync('git', ['show', `:${filePath}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 1024 * 1024 * 10
    });
  } catch {
    return '';
  }
}

function looksBinary(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.woff', '.woff2'].includes(extension);
}

const blockedFilePatterns = [
  /^\.env(\.|$)/i,
  /(^|\/)Secrets\.xcconfig$/i,
  /\.(pem|p12|pfx|key)$/i
];

const allowedEnvExample = /^\.env\.example$/i;

const blockedContentPatterns = [
  { label: 'OpenAI-style secret key', regex: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { label: 'GitHub personal access token', regex: /\bghp_[A-Za-z0-9]{20,}\b/ },
  { label: 'GitHub fine-grained token', regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { label: 'Private key block', regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { label: 'Gemini API key assignment', regex: /^\s*(?:VITE_)?GEMINI_API_KEY\s*=\s*.+$/m },
  { label: 'Etsy client secret assignment', regex: /^\s*ETSY_CLIENT_SECRET\s*=\s*.+$/m },
  { label: 'Instagram client secret assignment', regex: /^\s*INSTAGRAM_CLIENT_SECRET\s*=\s*.+$/m },
  { label: 'App session secret assignment', regex: /^\s*(?:APP_SESSION_SECRET|ETSY_COOKIE_SECRET)\s*=\s*.+$/m }
];

// Single-branch model: normal work commits directly to `main`, so the branch
// gate has been removed. This hook now focuses solely on blocking secrets.
const stagedFiles = getStagedFiles();
const violations = [];

for (const filePath of stagedFiles) {
  if (!allowedEnvExample.test(filePath) && blockedFilePatterns.some((pattern) => pattern.test(filePath))) {
    violations.push(`${filePath}: staged secret/config file`);
    continue;
  }

  if (looksBinary(filePath)) {
    continue;
  }

  const absolutePath = path.join(repoRoot, filePath);
  if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).size > 1024 * 1024) {
    continue;
  }

  const content = getStagedText(filePath);
  for (const pattern of blockedContentPatterns) {
    if (pattern.regex.test(content)) {
      violations.push(`${filePath}: ${pattern.label}`);
    }
  }
}

if (violations.length > 0) {
  console.error('Pre-commit checks failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  console.error('Move live secrets to ignored local config files before committing.');
  process.exit(1);
}
