import { createClient } from '@supabase/supabase-js';
import { getEnv } from './env.js';

let cachedClient: ReturnType<typeof createClient> | undefined;

export function getDb() {
  if (cachedClient) return cachedClient;
  const env = getEnv();
  cachedClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'X-Client-Info': 'disastermesh-server/1.0' } },
  });
  return cachedClient;
}

export function throwIfDbError(error: { message: string; code?: string } | null): void {
  if (!error) return;
  const wrapped = new Error(error.message) as Error & { code?: string };
  wrapped.code = error.code;
  throw wrapped;
}

export async function callRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  // The project deliberately avoids generated browser database types because the
  // privileged client exists only on the server. Runtime schemas live in SQL.
  const client = getDb();
  const rpc = client.rpc.bind(client) as unknown as (functionName: string, parameters: Record<string, unknown>) => Promise<{
    data: T | null; error: { message: string; code?: string } | null;
  }>;
  const { data, error } = await rpc(name, args);
  throwIfDbError(error);
  if (data === null) throw new Error(`${name} returned no data`);
  return data;
}
