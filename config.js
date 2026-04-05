require('dotenv').config();

function geminiKeysFromEnv() {
  const multi = process.env.GEMINI_API_KEYS;
  if (multi && multi.trim()) {
    return multi.split(',').map((k) => k.trim()).filter(Boolean);
  }
  const one = process.env.GEMINI_API_KEY;
  return one && one.trim() ? [one.trim()] : [];
}

function envInt(name, fallback) {
  const v = process.env[name];
  if (v === undefined || String(v).trim() === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name, fallback) {
  const v = process.env[name];
  if (v === undefined || String(v).trim() === '') return fallback;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(s)) return false;
  return fallback;
}

function envString(name, fallback) {
  const v = process.env[name];
  if (v === undefined) return fallback;
  const t = String(v).trim();
  if (t === '') return fallback;
  return t;
}

function envMultiline(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  return String(raw).replace(/\\n/g, '\n');
}

function mentionTargetFromEnv() {
  const mt = process.env.MENTION_TARGET;
  if (mt !== undefined && String(mt).trim() !== '') return String(mt).trim();
  const u = process.env.IG_USERNAME;
  return u && String(u).trim() ? String(u).trim() : '';
}

function aiTriggerModeFromEnv() {
  const v = (process.env.AI_TRIGGER_MODE || '').trim().toLowerCase();
  if (v === 'mention' || v === 'all') return v;
  return 'all';
}

const DEFAULT_AUTO_RESPONSE = '안녕하세요! 자동 응답입니다. 곧 확인하겠습니다. 😊';
const DEFAULT_AI_PROMPT = '친구처럼 반말로 짧게 답해. 자연스럽게.';

module.exports = {
  username: process.env.IG_USERNAME ? String(process.env.IG_USERNAME).trim() : '',
  password: process.env.IG_PASSWORD !== undefined ? String(process.env.IG_PASSWORD) : '',
  checkInterval: envInt('CHECK_INTERVAL_MS', 1000),
  maxCallsPerHour: envInt('MAX_CALLS_PER_HOUR', 180),
  minDelay: envInt('MIN_DELAY_MS', 1000),
  maxDelay: envInt('MAX_DELAY_MS', 3000),
  autoResponseMessage: process.env.AUTO_RESPONSE_MESSAGE !== undefined && String(process.env.AUTO_RESPONSE_MESSAGE).trim() !== ''
    ? String(process.env.AUTO_RESPONSE_MESSAGE).replace(/\\n/g, '\n')
    : DEFAULT_AUTO_RESPONSE,
  mentionTarget: mentionTargetFromEnv(),
  mentionResponse: envString('MENTION_RESPONSE', 'ㅇㅇ'),
  useAI: envBool('USE_AI', true),
  aiTriggerMode: aiTriggerModeFromEnv(),
  geminiApiKeys: geminiKeysFromEnv(),
  geminiModel: envString('GEMINI_MODEL', 'gemini-2.5-flash-lite'),
  minRequestInterval: envInt('MIN_REQUEST_INTERVAL_MS', 3000),
  aiSystemPrompt: envMultiline('AI_SYSTEM_PROMPT', DEFAULT_AI_PROMPT)
};
