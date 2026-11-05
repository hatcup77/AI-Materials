/* =========================================================================
 *  AI+ 虚拟仿真材料实验平台 · 外部大模型接入
 *  只依赖浏览器原生 fetch，兼容任何 OpenAI 风格的 /chat/completions 接口
 * ========================================================================= */
(function (global) {
  'use strict';

  var CFG_KEY = 'hdu-lab-ai-config';

  var PRESETS = [
    { id: 'deepseek',   name: 'DeepSeek',              base: 'https://api.deepseek.com/v1',                        model: 'deepseek-chat' },
    { id: 'moonshot',   name: 'Moonshot Kimi',         base: 'https://api.moonshot.cn/v1',                         model: 'moonshot-v1-8k' },
    { id: 'dashscope',  name: '通义千问（兼容模式）',    base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',   model: 'qwen-plus' },
    { id: 'silicon',    name: '硅基流动 SiliconFlow',   base: 'https://api.siliconflow.cn/v1',                      model: 'Qwen/Qwen2.5-7B-Instruct' },
    { id: 'openai',     name: 'OpenAI',                base: 'https://api.openai.com/v1',                          model: 'gpt-4o-mini' },
    { id: 'ollama',     name: '本地 Ollama',            base: 'http://127.0.0.1:11434/v1',                          model: 'qwen2.5:7b' },
    { id: 'lmstudio',   name: '本地 LM Studio',         base: 'http://127.0.0.1:1234/v1',                           model: 'qwen2.5-7b-instruct' },
    { id: 'custom',     name: '自定义（OpenAI 兼容）',   base: '',                                                   model: '' }
  ];

  var DEFAULTS = {
    saved: false,
    preset: 'deepseek',
    base: PRESETS[0].base,
    model: PRESETS[0].model,
    key: '',
    temp: 0.4,
    maxTokens: 1200,
    useContext: true
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function readConfig() {
    var cfg = clone(DEFAULTS);
    try {
      var raw = localStorage.getItem(CFG_KEY);
      if (raw) {
        var got = JSON.parse(raw);
        Object.keys(cfg).forEach(function (k) {
          if (got[k] !== undefined && got[k] !== null) cfg[k] = got[k];
        });
      }
    } catch (e) {}
    return cfg;
  }

  function saveConfig(cfg) {
    var out = clone(DEFAULTS);
    Object.keys(out).forEach(function (k) { if (cfg[k] !== undefined) out[k] = cfg[k]; });
    out.base = String(out.base || '').trim();
    out.model = String(out.model || '').trim();
    out.key = String(out.key || '').trim();
    out.temp = Math.max(0, Math.min(2, Number(out.temp) || 0));
    out.maxTokens = Math.max(128, Math.min(8192, parseInt(out.maxTokens, 10) || 1200));
    out.saved = !!(out.base && out.model);
    try { localStorage.setItem(CFG_KEY, JSON.stringify(out)); } catch (e) {}
    return out;
  }

  function clearConfig() {
    try { localStorage.removeItem(CFG_KEY); } catch (e) {}
  }

  /* 「有没有真正配过」看 saved 标记：默认预设只是给表单预填，不代表已接入。
     本地部署的模型可以不带 key，所以这里不强制 key 非空。 */
  function isConfigured(cfg) {
    cfg = cfg || readConfig();
    return !!(cfg.saved && cfg.base && cfg.model);
  }

  function endpoint(base) {
    var b = String(base || '').trim().replace(/\/+$/, '');
    if (!b) return '';
    if (/\/chat\/completions$/.test(b)) return b;
    return b + '/chat/completions';
  }

  function describeHttpError(status, text) {
    var detail = '';
    try {
      var obj = JSON.parse(text);
      detail = (obj.error && (obj.error.message || obj.error.type)) || obj.message || '';
    } catch (e) {
      detail = String(text || '').slice(0, 160);
    }
    var head;
    if (status === 401 || status === 403) head = 'API Key 无效或没有权限（HTTP ' + status + '）';
    else if (status === 404) head = '接口地址不存在（HTTP 404），检查 Base URL 是否带 /v1';
    else if (status === 429) head = '请求太频繁或余额不足（HTTP 429）';
    else if (status >= 500) head = '服务端错误（HTTP ' + status + '）';
    else head = '请求失败（HTTP ' + status + '）';
    return detail ? head + '：' + detail : head;
  }

  function networkHint() {
    return '无法连接接口。常见原因：① 地址写错；② 该服务不允许浏览器直连（缺 CORS 头）；③ 本机服务没启动。' +
      '可在浏览器控制台看具体报错，或换用支持 CORS 的服务商。';
  }

  /* ------------------------------------------------------------------ *
   * 流式对话
   * handlers: { onDelta(text), onDone(fullText), onError(message) }
   * 返回 { abort() }
   * ------------------------------------------------------------------ */
  function streamChat(cfg, messages, handlers) {
    var h = handlers || {};
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var url = endpoint(cfg.base);
    var used = 0;
    // 服务挂住时不能一直停在「停止」：60 秒没有任何响应/数据就自动放弃
    var IDLE_MS = 60000;
    var idleTimer = null;
    var timedOut = false;
    function stopTimer() { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } }
    function armTimer() {
      stopTimer();
      idleTimer = setTimeout(function () {
        timedOut = true;
        if (ctrl) try { ctrl.abort(); } catch (e) {}
        fail('模型响应超时（' + Math.round(IDLE_MS / 1000) + ' 秒无数据），请检查服务是否卡住，然后点「重试」');
      }, IDLE_MS);
    }
    var body = {
      model: cfg.model,
      messages: messages,
      temperature: Number(cfg.temp) || 0,
      max_tokens: parseInt(cfg.maxTokens, 10) || 1200,
      stream: true
    };

    function fail(msg) {
      stopTimer();
      if (h.onError) h.onError(msg);
    }

    if (!url) { fail('还没有填写接口地址'); return { abort: function () {} }; }

    var headers = { 'Content-Type': 'application/json' };
    if (cfg.key) headers.Authorization = 'Bearer ' + cfg.key;
    armTimer();

    fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) { throw new Error(describeHttpError(res.status, t)); });
      }
      var ctype = res.headers.get('content-type') || '';
      // 有些服务忽略 stream 参数，直接返回完整 JSON
      if (ctype.indexOf('event-stream') < 0) {
        return res.text().then(function (t) {
          var txt = '';
          try {
            var obj = JSON.parse(t);
            txt = (obj.choices && obj.choices[0] && obj.choices[0].message && obj.choices[0].message.content) || '';
          } catch (e) {
            throw new Error('返回内容不是有效的模型响应，请确认接口是 OpenAI 兼容格式');
          }
          if (txt && h.onDelta) h.onDelta(txt);
          used = txt.length;
          stopTimer();
          if (h.onDone) h.onDone(txt);
        });
      }

      var reader = res.body.getReader();
      var decoder = new TextDecoder('utf-8');
      var buf = '';
      var full = '';

      function handleLine(line) {
        var s = line.trim();
        if (!s || s.indexOf(':') === 0) return;         // 空行 / 注释（: keep-alive）
        if (s.indexOf('data:') !== 0) return;
        var payload = s.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        var obj;
        try { obj = JSON.parse(payload); } catch (e) { return; }
        var delta = obj.choices && obj.choices[0] &&
          ((obj.choices[0].delta && obj.choices[0].delta.content) ||
           (obj.choices[0].message && obj.choices[0].message.content) || '');
        if (delta) {
          full += delta;
          used = full.length;
          if (h.onDelta) h.onDelta(delta);
        }
      }

      function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            if (buf.trim()) handleLine(buf);
            stopTimer();
            if (h.onDone) h.onDone(full);
            return;
          }
          armTimer();
          buf += decoder.decode(r.value, { stream: true });
          var parts = buf.split('\n');
          buf = parts.pop();
          parts.forEach(handleLine);
          return pump();
        });
      }
      return pump();
    }).catch(function (err) {
      if (timedOut) return;      // 超时已经报过错，abort 引发的 AbortError 不再重复提示
      if (err && err.name === 'AbortError') { fail('__aborted__'); return; }
      var msg = err && err.message ? err.message : '';
      // fetch 自身的 TypeError 都是网络/CORS 层的问题
      if (!msg || /Failed to fetch|NetworkError|Load failed|Network request failed/i.test(msg)) {
        msg = networkHint();
      }
      fail(msg);
    });

    return {
      abort: function () { stopTimer(); if (ctrl) try { ctrl.abort(); } catch (e) {} },
      size: function () { return used; }
    };
  }

  /* 用一条极短的请求验证地址、密钥、模型是否可用 */
  function testConnection(cfg) {
    return new Promise(function (resolve) {
      var url = endpoint(cfg.base);
      if (!url) { resolve({ ok: false, msg: '还没有填写接口地址' }); return; }
      var headers = { 'Content-Type': 'application/json' };
      if (cfg.key) headers.Authorization = 'Bearer ' + cfg.key;
      fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          model: cfg.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 4,
          stream: false
        })
      }).then(function (res) {
        if (!res.ok) {
          return res.text().then(function (t) { resolve({ ok: false, msg: describeHttpError(res.status, t) }); });
        }
        return res.text().then(function (t) {
          var len = 0, model = '';
          try {
            var obj = JSON.parse(t);
            model = (obj.model || '') + '';
            len = ((obj.choices && obj.choices[0] && obj.choices[0].message &&
              obj.choices[0].message.content) || '').length;
          } catch (e) {}
          resolve({
            ok: true,
            msg: '连接正常' + (model ? '，模型 ' + model : '') + (len ? '，已返回 ' + len + ' 字符' : '')
          });
        });
      }).catch(function (err) {
        var msg = err && err.message ? err.message : '';
        if (!msg || /Failed to fetch|NetworkError|Load failed|Network request failed/i.test(msg)) msg = networkHint();
        resolve({ ok: false, msg: msg });
      });
    });
  }

  global.AIAPI = {
    PRESETS: PRESETS,
    DEFAULTS: DEFAULTS,
    readConfig: readConfig,
    saveConfig: saveConfig,
    clearConfig: clearConfig,
    isConfigured: isConfigured,
    endpoint: endpoint,
    streamChat: streamChat,
    testConnection: testConnection
  };
})(typeof window !== 'undefined' ? window : globalThis);
