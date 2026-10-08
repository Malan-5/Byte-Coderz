import { analyzeDistress } from '../api/_lib/llm';
import { callRpc, getDb, throwIfDbError } from '../api/_lib/db';

// Read-only live verification. This script prints status/counts, never credentials.
const db = getDb();
const { count, error } = await db.from('incidents').select('id', { head: true, count: 'exact' });
throwIfDbError(error);
const severity = await callRpc<string>('dm_severity', { score: 75 });
if (severity !== 'Critical') throw new Error(`Unexpected database function result: ${String(severity)}`);
console.log(`PASS Supabase: connected; incidents=${count}; dm_severity(75)=${severity}`);

const llm = await analyzeDistress('Medical help needed in Adyar. One elderly person is unconscious.');
if (llm.status !== 'used' || !llm.analysis) throw new Error(`LLM verification failed with status ${llm.status}`);
console.log(`PASS LLM: provider=${llm.provider}; model=${llm.model}; status=${llm.status}; type=${llm.analysis.emergency_type}; score=${llm.analysis.urgency_score}; latency_ms=${llm.latency_ms}`);
