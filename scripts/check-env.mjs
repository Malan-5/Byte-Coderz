import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// A local configuration check only: no credentials are printed or sent anywhere.
const envPath = resolve('.env.local');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const errors = [];
const warnings = [];
const value = (name) => process.env[name]?.trim() ?? '';

for (const name of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'DISPATCHER_PASSCODE', 'JWT_SECRET', 'APP_ORIGIN', 'OSM_CONTACT_EMAIL']) {
  if (!value(name)) errors.push(`${name} is required.`);
}

for (const name of ['SUPABASE_URL', 'APP_ORIGIN']) {
  if (!value(name)) continue;
  try {
    const url = new URL(value(name));
    const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(name === 'APP_ORIGIN' && isLocal && url.protocol === 'http:')) {
      errors.push(`${name} must use HTTPS, except localhost APP_ORIGIN.`);
    }
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      errors.push(`${name} must be an origin without credentials, path, query, or fragment.`);
    }
  } catch {
    errors.push(`${name} must be a valid URL.`);
  }
}

if (value('DISPATCHER_PASSCODE') && value('DISPATCHER_PASSCODE').length < 12) {
  errors.push('DISPATCHER_PASSCODE must contain at least 12 characters.');
}
if (value('JWT_SECRET') && Buffer.byteLength(value('JWT_SECRET'), 'utf8') < 32) {
  errors.push('JWT_SECRET must contain at least 32 bytes; use the random generator in README.md.');
}
if (value('JWT_SECRET') && value('JWT_SECRET') === value('DISPATCHER_PASSCODE')) {
  errors.push('JWT_SECRET must be different from DISPATCHER_PASSCODE.');
}
if (value('OSM_CONTACT_EMAIL') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value('OSM_CONTACT_EMAIL'))) {
  errors.push('OSM_CONTACT_EMAIL must be a valid contact email.');
}

const provider = value('LLM_PROVIDER');
if (!['gemini', 'openai'].includes(provider)) {
  errors.push('LLM_PROVIDER must be gemini or openai.');
} else {
  const prefix = provider.toUpperCase();
  if (!value(`${prefix}_API_KEY`)) {
    warnings.push(`${prefix}_API_KEY is missing. Later phases will use rule-based text scoring; image understanding needs the provider key.`);
  }
  if (!value(`${prefix}_MODEL`)) errors.push(`${prefix}_MODEL is required for the selected provider.`);
}

if (!['true', 'false'].includes(value('DEMO_MODE'))) {
  errors.push('DEMO_MODE must be true or false.');
}

// This project has no client environment configuration at all.
if (Object.keys(process.env).some((name) => name.startsWith('VITE_'))) {
  errors.push('Remove VITE_ environment variables: this project keeps configuration on the server.');
}

for (const warning of warnings) console.warn(`WARN: ${warning}`);
for (const error of errors) console.error(`FAIL: ${error}`);

if (errors.length) {
  console.error(`Configuration check failed (${errors.length} issue(s)). See .env.example.`);
  process.exitCode = 1;
} else {
  console.log('Server configuration format is valid. No secrets were printed.');
  console.log('This does not verify credentials or network access. Live connectivity is checked in Phase 2.');
}
