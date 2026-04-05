require('dotenv').config();

const e = process.env;

const t = (k) => {
  const v = e[k];
  return v === undefined || v === null ? '' : String(v).trim();
};

const int = (k, d) => {
  const s = t(k);
  if (!s) return d;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : d;
};

const intOpt = (k) => {
  const s = t(k);
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
};

const str = (k, d) => {
  const s = t(k);
  return s === '' ? d : s;
};

const bool = (k, d) => {
  const s = t(k).toLowerCase();
  if (!s) return d;
  if (s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'on') return true;
  if (s === '0' || s === 'false' || s === 'no' || s === 'n' || s === 'off') return false;
  return d;
};

const DEF_AUTO = '안녕하세요! 자동 응답입니다. 곧 확인하겠습니다. 😊';
const DEF_AI = '친구처럼 반말로 짧게 답해. 자연스럽게.';

const user = t('IG_USERNAME');
const gkMulti = t('GEMINI_API_KEYS');
const gkOne = t('GEMINI_API_KEY');
const geminiApiKeys = gkMulti
  ? gkMulti.split(',').map((x) => x.trim()).filter(Boolean)
  : gkOne ? [gkOne] : [];

const autoVal = e.AUTO_RESPONSE_MESSAGE;
const autoResponseMessage =
  autoVal === undefined || String(autoVal).trim() === ''
    ? DEF_AUTO
    : String(autoVal).replace(/\\n/g, '\n');

const mt = t('MENTION_TARGET');
const atm = t('AI_TRIGGER_MODE').toLowerCase();

const ds = e.IG_DEVICE_STRING;
const igDeviceString =
  ds !== undefined && String(ds).trim() !== '' ? String(ds).trim() : '';

const aiVal = e.AI_SYSTEM_PROMPT;
const aiSystemPrompt =
  aiVal === undefined || String(aiVal).trim() === ''
    ? DEF_AI
    : String(aiVal).replace(/\\n/g, '\n');

module.exports = {
  username: user,
  password: e.IG_PASSWORD !== undefined ? String(e.IG_PASSWORD) : '',
  checkInterval: int('CHECK_INTERVAL_MS', 1000),
  maxCallsPerHour: int('MAX_CALLS_PER_HOUR', 180),
  minDelay: int('MIN_DELAY_MS', 1000),
  maxDelay: int('MAX_DELAY_MS', 3000),
  autoResponseMessage,
  mentionTarget: mt || user,
  mentionResponse: str('MENTION_RESPONSE', 'ㅇㅇ'),
  useAI: bool('USE_AI', true),
  aiTriggerMode: atm === 'mention' || atm === 'all' ? atm : 'all',
  geminiApiKeys,
  geminiModel: str('GEMINI_MODEL', 'gemini-2.5-flash-lite'),
  minRequestInterval: int('MIN_REQUEST_INTERVAL_MS', 3000),
  aiSystemPrompt,
  igLocale: str('IG_LOCALE', 'ko_KR'),
  igConnection: str('IG_CONNECTION', 'WIFI'),
  igDeviceString,
  igDevicePreset: t('IG_DEVICE_PRESET').toLowerCase(),
  igTimezoneOffsetSec: intOpt('IG_TIMEZONE_OFFSET_SEC')
};
