export function endpoint(input, route) {
  let url;
  try { url = new URL(input.trim()); } catch { throw new Error('请填写完整的 API URL，例如 https://api.example.com/v1。'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('API 地址须使用 HTTPS，本机调试可用 HTTP。');
  if (url.search || url.hash || url.username || url.password) throw new Error('API URL 不可含凭据、查询参数或片段。');
  const path = url.pathname.replace(/\/+$/, '');
  const root = path ? path.replace(/\/(?:chat\/completions|models)$/, '') : '/v1';
  url.pathname = root + '/' + route;
  return url.href;
}
function redact(message, key) {
  const value = String(message || '');
  return (key ? value.split(key).join('•••') : value).slice(0, 240);
}
function httpError(status, detail, key) {
  const errors = {400:'请求参数不受支持，请检查模型和接口兼容性',401:'API Key 无效或已过期',402:'账户余额不足',403:'无权使用此接口或模型',404:'找不到模型或接口，请核对 URL 和模型 ID',429:'达到速率或额度限制，请检查配额或稍后再试'};
  const message = redact(detail, key);
  return new Error('HTTP ' + status + ' · ' + (errors[status] || '服务商请求失败') + (message ? '。' + message : '。'));
}
export async function request(config, route, body, signal, consume) {
  const address = endpoint(config.url, route);
  if (!config.key.trim()) throw new Error('请先填写 API Key。');
  const controller = new AbortController();
  let timer;
  const bump = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new DOMException('等待服务商超时，请重试。','TimeoutError')), 120000);
  };
  const stop = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  bump();
  try {
    const response = await fetch(address, {
      method: body ? 'POST' : 'GET', signal: controller.signal, cache:'no-store', redirect:'error',
      credentials:'omit', referrerPolicy:'no-referrer',
      headers: { Authorization: 'Bearer ' + config.key.trim(), ...(body && {'Content-Type':'application/json'}) },
      body: body && JSON.stringify(body)
    });
    if (!response.ok) {
      const payload = await response.text();
      let detail;
      try { const data = JSON.parse(payload); detail = data.error?.message || data.message; } catch { /* Status still identifies failed HTML gateways. */ }
      throw httpError(response.status, detail, config.key);
    }
    return await consume(response, bump);
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (error instanceof TypeError) throw new Error('网络连接失败。请检查地址、网络，以及服务商是否允许浏览器跨域访问（CORS）。');
    if (error instanceof SyntaxError) throw new Error('服务商返回了无法解析的数据，请检查 API URL。');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}
export async function getModels(config, signal) {
  return request(config, 'models', undefined, signal, async response => {
    const data = await response.json();
    const ids = (Array.isArray(data) ? data : data.data || data.models || [])
      .map(item => typeof item === 'string' ? item : item.id).filter(id => typeof id === 'string' && id);
    if (!ids.length) throw new Error('接口没有返回模型 ID，仍可手动填写。');
    return [...new Set(ids)].sort();
  });
}
function content(value) {
  if (typeof value === 'string') return value;
  return Array.isArray(value) ? value.map(v => typeof v?.text === 'string' ? v.text : '').join('') : '';
}
const temps = new Map();
function savedTemperature(model) {
  if (temps.has(model)) return temps.get(model);
  try { const v = localStorage.getItem('novel-temperature:' + model); if (v !== null) return v === 'omit' ? null : Number(v); } catch { /* No storage: stay in memory. */ }
  return undefined;
}
function saveTemperature(model, value) {
  temps.set(model, value);
  try { localStorage.setItem('novel-temperature:' + model, value === null ? 'omit' : String(value)); } catch { /* Memory is enough. */ }
}
function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    const fail = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', fail); resolve(); }, ms);
    signal?.addEventListener('abort', fail, { once: true });
    if (signal?.aborted) fail();
  });
}
export async function completion(config, messages, { mode = 'write', signal, onText = () => {} } = {}) {
  if (!config.model.trim()) throw new Error('请先填写模型 ID。');
  const testing = mode === 'test';
  const body = { model:config.model.trim(), messages, stream:!testing, max_tokens: testing ? 16 : mode === 'summary' ? 2000 : 8192 };
  const learned = savedTemperature(body.model);
  if (!testing && learned !== null) body.temperature = learned ?? (mode === 'summary' ? 0.3 : 0.8);
  let rateWaits = 0, temperatureFixed = false;
  for (;;) {
    try { return await send(); }
    catch (error) {
      const message = String(error.message);
      // Rate limit that names a wait: pause, then try again (the answer has not started yet).
      const wait = message.startsWith('HTTP 429') && /after\s+(\d+)\s+seconds?/i.exec(message);
      if (wait && rateWaits < 3 && Number(wait[1]) <= 30) { rateWaits++; await pause((Number(wait[1]) + 1) * 1000, signal); continue; }
      // A model that accepts one temperature only: use the value the server names, or omit it, and remember that.
      if (!temperatureFixed && body.temperature !== undefined && message.startsWith('HTTP 400') && /temperature/i.test(message)) {
        temperatureFixed = true;
        const only = /only\s+(-?[\d.]+)\s+is allowed/i.exec(message);
        const value = only ? Number(only[1]) : null;
        saveTemperature(body.model, value);
        if (value === null) delete body.temperature; else body.temperature = value;
        continue;
      }
      throw error;
    }
  }
  function send() { return request(config, 'chat/completions', body, signal, async (response, bump) => {
    let finish = null, done = false, hasText = false;
    async function accept(data) {
      if (data.error) throw new Error('服务商错误：' + redact(data.error.message || data.error, config.key));
      const choice = data.choices?.[0];
      if (!choice) return;
      const text = content(choice.delta?.content ?? choice.message?.content ?? choice.text);
      if (text) { hasText = true; await onText(text); }
      finish = choice.finish_reason || finish;
    }
    if ((response.headers.get('content-type') || '').includes('application/json')) {
      await accept(await response.json());
      done = true;
    } else {
      if (!response.body) throw new Error('浏览器未提供响应流。');
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '', dataLines = [];
      async function line(value) {
        if (value === '') {
          const payload = dataLines.join('\n').trim();
          dataLines = [];
          if (payload === '[DONE]') done = true;
          else if (payload) await accept(JSON.parse(payload));
        } else if (value.startsWith('data:')) dataLines.push(value.slice(5).replace(/^ /, ''));
      }
      try {
        while (!done) {
          const packet = await reader.read();
          if (packet.done) break;
          bump();
          buffer += packet.value;
          let end;
          while (!done && (end = buffer.indexOf('\n')) !== -1) {
            await line(buffer.slice(0, end).replace(/\r$/, ''));
            buffer = buffer.slice(end + 1);
          }
        }
        if (!done && buffer) await line(buffer.replace(/\r$/, ''));
        if (!done) await line('');
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
    if (!done && !finish) throw new Error('回复传输中断，已接收的部分可继续使用。');
    if (finish === 'content_filter') throw new Error('服务商中止了正文输出。');
    if (!hasText && !(testing && finish)) throw new Error('接口已响应，但没有返回正文，请检查模型。');
    return finish;
  }); }
}
