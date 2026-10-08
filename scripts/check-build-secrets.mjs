import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { parseEnv } from 'node:util';

const roots = ['dist', join('.vercel','output')].filter(existsSync);
const envFiles = ['.env.local', join('.vercel','.env.preview.local')].filter(existsSync);
const secretEntries = envFiles.flatMap((file) => Object.entries(parseEnv(readFileSync(file,'utf8'))))
  .filter(([name,value]) => /(?:KEY|SECRET|TOKEN|PASSWORD|PASSCODE)/i.test(name) && value.length >= 8);
const textExtensions = new Set(['.js','.json','.html','.css','.map','.txt','.mjs','.cjs']);
const findings = [];
let checked = 0;

function visit(path) {
  for (const entry of readdirSync(path,{ withFileTypes: true })) {
    const full = join(path,entry.name);
    if (entry.isDirectory()) visit(full);
    else if (textExtensions.has(extname(entry.name).toLowerCase()) || entry.name === '.vc-config.json') {
      checked++;
      const content = readFileSync(full,'utf8');
      for (const [name,value] of secretEntries) if (content.includes(value)) findings.push({ file: relative('.',full), name });
    }
  }
}
for (const root of roots) visit(root);
for (const finding of findings) console.error(`FAIL: ${finding.file} contains configured ${finding.name}`);
if (findings.length) {
  console.error(`Build secret scan failed: ${findings.length} finding(s). Values were not printed.`);
  process.exitCode = 1;
} else {
  console.log(`PASS: ${checked} client/function build files contain none of ${secretEntries.length} configured secret values.`);
  console.log('Values were not printed.');
}
