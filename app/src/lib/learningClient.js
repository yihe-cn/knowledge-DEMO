// 学习闭环 API（swipe 卡片 + 逐 KP 闭卷答题 + AI 评分）。
// 学员身份用 account.id 作为 external_ref 弱身份，与 /api/courses/by-account 一致。

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

async function req(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  };
  if (body != null) opts.body = JSON.stringify(body);
  const resp = await fetch(`${API_BASE}${path}`, opts);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} ${text}`);
  }
  return resp.json();
}

// productCode 是 product.code（如 zeekr007），accountRef 来自 account.id。
export function listCards(productCode, accountRef) {
  const qs = accountRef ? `?account=${encodeURIComponent(accountRef)}` : '';
  return req('GET', `/api/learning/courses/${encodeURIComponent(productCode)}/cards${qs}`);
}

export function submitAnswer({ kpId, productId, answer, accountRef }) {
  const qs = `?account=${encodeURIComponent(accountRef)}`;
  return req('POST', `/api/learning/kp/${kpId}/answer${qs}`, {
    product_id: productId,
    answer,
  });
}

export function skipKp({ kpId, productId, accountRef }) {
  const qs = `?account=${encodeURIComponent(accountRef)}`;
  return req('POST', `/api/learning/kp/${kpId}/skip${qs}`, {
    product_id: productId,
  });
}
