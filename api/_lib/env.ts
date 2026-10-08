import { z } from 'zod';

const envSchema = z.object({
  SUPABASE_URL: z.string().url().refine((value) => value.startsWith('https://'), 'SUPABASE_URL must use HTTPS'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  DISPATCHER_PASSCODE: z.string().min(12),
  JWT_SECRET: z.string().min(32),
  LLM_PROVIDER: z.enum(['gemini', 'openai']),
  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().optional().default('gemini-2.5-flash'),
  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_MODEL: z.string().optional().default(''),
  APP_ORIGIN: z.string().url(),
  OSM_CONTACT_EMAIL: z.string().email(),
  DEMO_MODE: z.enum(['true', 'false']).transform((value) => value === 'true'),
}).superRefine((env, context) => {
  const key = env.LLM_PROVIDER === 'gemini' ? env.GEMINI_API_KEY : env.OPENAI_API_KEY;
  const model = env.LLM_PROVIDER === 'gemini' ? env.GEMINI_MODEL : env.OPENAI_MODEL;
  if (!key) context.addIssue({ code: 'custom', message: `${env.LLM_PROVIDER} API key is missing` });
  if (!model) context.addIssue({ code: 'custom', message: `${env.LLM_PROVIDER} model is missing` });
});

export type ServerEnv = z.infer<typeof envSchema>;
let cached: ServerEnv | undefined;

export function getEnv(): ServerEnv {
  cached ??= envSchema.parse(process.env);
  return cached;
}

export function clearEnvCacheForTests(): void {
  cached = undefined;
}
