// 考核模块学员端 API 封装。鉴权走 ?token= 查询参数 + X-Assessment-Token 头双保险。

// 用 ?? 而不是 ||：单镜像 demo 把 VITE_API_BASE 设成 ""，让 API 走同源相对路径；
// || 会把空字符串当 falsy 落回 localhost:8000，导致浏览器跨域请求 404。
const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000';

// 注入式 token：主流程从 AccountHome/HomeScreen 进入时通过 setAssessmentToken 设置；
// 外发链接进入则走 URL ?token=。两条路径共享同一组 API。
let injectedToken = null;
export function setAssessmentToken(t) { injectedToken = t || null; }

function getToken() {
  if (injectedToken) return injectedToken;
  return new URLSearchParams(window.location.search).get('token') || '';
}

function tokenHeaders() {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const t = getToken();
  if (t) h['X-Assessment-Token'] = t;
  return h;
}

// 按 account 拉学员自己的考核任务（无 token 鉴权，account.id 即弱身份）
export async function listByAccount(accountRef) {
  const url = `${API_BASE}/api/assessment/by-account/${encodeURIComponent(accountRef)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  return data.items || [];
}

async function req(method, path, body, options = {}) {
  const timeoutMs = options.timeoutMs || 45000;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const url = `${API_BASE}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(getToken())}`;
  const opts = { method, headers: tokenHeaders(), signal: controller.signal };
  if (body != null) opts.body = JSON.stringify(body);
  try {
    const resp = await fetch(url, opts);
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status} ${text}`);
    }
    return resp.json();
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('请求超时，请稍后重试');
    throw e;
  } finally {
    window.clearTimeout(timer);
  }
}

export const getSessionInfo = () => req('GET', '/api/assessment/session');
export const submitBankAnswer = (turn_idx, answer_text) =>
  req('POST', '/api/assessment/answer', { turn_idx, answer_text });
export const oralNext = () => req('GET', '/api/assessment/oral/next');
export const oralAnswer = (payload) => req('POST', '/api/assessment/oral/answer', payload);
export const submitAssignment = () => req('POST', '/api/assessment/submit', {});
