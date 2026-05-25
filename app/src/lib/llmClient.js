// SSE 流式调用封装。
// 后端约定的事件类型：token / result / error / done。
// 不用 EventSource 是因为它不支持 POST body。

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';
const INTERNAL_TOKEN = import.meta.env.VITE_INTERNAL_TOKEN || '';

/**
 * 非流式 JSON POST。
 * @param {{endpoint: string, body: any, signal?: AbortSignal}} opts
 */
export async function postJSON({ endpoint, body, signal }) {
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
  if (INTERNAL_TOKEN) headers['X-Internal-Token'] = INTERNAL_TOKEN;
  const resp = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body || {}),
    signal,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} ${text}`);
  }
  return resp.json();
}

/**
 * 练后评估报告（非流式）。后端 Graph 一次性返回完整报告 JSON。
 * @param {Object} body  { customer, picks, kp_list, final_mood, viewed_kp, product_code }
 * @param {AbortSignal} [signal]
 */
export function evaluatePractice(body, signal) {
  return postJSON({ endpoint: '/api/practice/evaluate', body, signal });
}

/**
 * @param {Object} opts
 * @param {string} opts.endpoint  - 形如 '/api/qa'
 * @param {Object} opts.body
 * @param {(text:string)=>void} [opts.onToken]
 * @param {(data:any)=>void}    [opts.onResult]
 * @param {(err:Error)=>void}   [opts.onError]
 * @param {()=>void}            [opts.onDone]
 * @param {(items:any[])=>void} [opts.onCitations]
 * @param {(items:any[])=>void} [opts.onTaggedKps]
 * @param {(data:any)=>void}    [opts.onFallback]
 * @param {(items:string[])=>void} [opts.onFollowups] - 异步追问事件，在 result 之后到达
 * @param {(data:{node:string,duration_ms:number,status:string})=>void} [opts.onStage] - 流水线节点完成事件，用于展示进度
 * @param {(mode:string)=>void} [opts.onAnswerMode] - 后端选定回答模式 'kb' | 'experience'
 * @param {AbortSignal}         [opts.signal]
 */
export async function streamChat({ endpoint, body, onToken, onResult, onError, onDone, onCitations, onTaggedKps, onFallback, onFollowups, onStage, onAnswerMode, signal }) {
  let resp;
  try {
    const headers = { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' };
    if (INTERNAL_TOKEN) headers['X-Internal-Token'] = INTERNAL_TOKEN;
    resp = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {}),
      signal,
    });
  } catch (e) {
    onError && onError(new Error(`无法连接后端服务：${e?.message || e}`));
    onDone && onDone();
    return;
  }
  if (!resp.ok || !resp.body) {
    const text = resp.body ? await resp.text().catch(() => '') : '';
    onError && onError(new Error(`HTTP ${resp.status} ${text}`));
    onDone && onDone();
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';

  const handleBlock = (block) => {
    // 一个 SSE 事件块由若干行组成
    let event = 'message';
    const dataLines = [];
    for (const line of block.split('\n')) {
      if (!line) continue;
      if (line.startsWith(':')) continue; // comment
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    const dataStr = dataLines.join('\n');
    let data = null;
    if (dataStr) {
      try { data = JSON.parse(dataStr); } catch { data = dataStr; }
    }
    if (event === 'token') {
      const text = (data && typeof data === 'object') ? data.text : data;
      if (text) onToken && onToken(text);
    } else if (event === 'result') {
      onResult && onResult(data);
    } else if (event === 'citations') {
      onCitations && onCitations((data && data.items) || []);
    } else if (event === 'tagged_kps') {
      onTaggedKps && onTaggedKps((data && data.items) || []);
    } else if (event === 'fallback') {
      onFallback && onFallback(data || {});
    } else if (event === 'followups') {
      onFollowups && onFollowups((data && data.items) || []);
    } else if (event === 'stage') {
      onStage && onStage(data || {});
    } else if (event === 'answer_mode') {
      const mode = (data && typeof data === 'object') ? data.mode : data;
      if (mode) onAnswerMode && onAnswerMode(mode);
    } else if (event === 'error') {
      const msg = (data && data.message) || String(data) || 'unknown error';
      onError && onError(new Error(msg));
    }
    // done 事件 -> 由读取流结束统一触发 onDone
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // CRLF → LF 归一化（sse-starlette 等服务端会发 \r\n\r\n）
      buf = buf.replace(/\r\n/g, '\n');
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (block.trim()) handleBlock(block);
      }
    }
    if (buf.trim()) handleBlock(buf);
  } catch (e) {
    onError && onError(e);
  } finally {
    onDone && onDone();
  }
}
