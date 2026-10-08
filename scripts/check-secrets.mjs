import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// Scan file contents, but print only filenames and rule names, never matches.
// Default: scan the exact staged blobs. --all also checks untracked source.
const all = process.argv.includes('--all');
const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
const files = [...new Set(git(all
  ? ['ls-files', '--cached', '--others', '--exclude-standard', '-z']
  : ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).split('\0').filter(Boolean))];
const env = existsSync('.env.local') ? parseEnv(readFileSync('.env.local', 'utf8')) : {};
const secrets = Object.entries(env).filter(([name, value]) =>
  /(?:KEY|SECRET|TOKEN|PASSWORD|PASSCODE)/i.test(name) && value.length >= 8,
);
const patterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['JWT token', /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{8,}/],
  ['Google API key', /\bAIza[A-Za-z0-9_-]{30,}/],
  ['OpenAI API key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/],
  ['Supabase secret key', /\bsb_secret_[A-Za-z0-9_-]{12,}/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/],
];
let issues = 0;
for (const file of files) {
  if (/(?:^|\/)(?:\.env(?:\..+)?|\.vercel(?:\/|$))/.test(file) && file !== '.env.example') {
    console.error(`FAIL: ${file}: private configuration must not be committed`);
    issues++;
  }
  const content = all ? readFileSync(file, 'utf8') : git(['show', `:${file}`]);
  for (const [name, value] of secrets) {
    if (content.includes(value)) {
      console.error(`FAIL: ${file}: contains configured ${name} value`);
      issues++;
    }
  }
  for (const [name, pattern] of patterns) {
    if (pattern.test(content)) {
      console.error(`FAIL: ${file}: possible ${name}`);
      issues++;
    }
  }
}
if (issues) {
  console.error(`Secret scan failed: ${issues} finding(s). Values were not printed.`);
  process.exitCode = 1;
} else {
  console.log(`PASS: ${files.length} ${all ? 'source files' : 'staged files'} scanned against ${secrets.length} configured secret values and common credential patterns.`);
  console.log('No matching secrets or private environment files found. Values were not printed.');
}
