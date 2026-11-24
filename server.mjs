import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { approach, chapters, hanCount, nextQuestion, transcript } from './docs/guide.mjs';

export function makeApi({ key, model, fetchModel = fetch }) {
  async function ask(instructions, input, maxTokens, json = false) {
    const response = await fetchModel('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, instructions: approach + '\n' + instructions, input, store: false,
        max_output_tokens: maxTokens,
        ...(json && { text: { format: { type: 'json_object' } } })
      }),
      signal: AbortSignal.timeout(145000)
    });
    if (!response.ok) throw Error('上游请求失败');
    const data = await response.json();
    if (data.status !== 'completed') throw Error('生成未完成');
    return data.output.flatMap(item => item.content ?? [])
      .filter(item => item.type === 'output_text').map(item => item.text).join('\n').trim();
  }
  return async function run(payload) {
    if (!payload || !Array.isArray(payload.entries) || payload.entries.length > 10) return null;
    const validated = [];
    for (const entry of payload.entries) {
      const expected = nextQuestion(validated);
      if (!expected || entry?.id !== expected.id || typeof entry.question !== 'string' ||
          entry.question.length > 180 || typeof entry.answer !== 'string' || entry.answer.length > 2500) return null;
      validated.push({ id: entry.id, question: entry.question, answer: entry.answer });
    }
    if (!validated.some(entry => entry.answer.trim())) return null;
    const materials = transcript(validated);
    const next = nextQuestion(validated);
    if (payload.action === 'feedback') {
      if (!validated.at(-1)?.answer) return null;
      const followup = next && next.id.endsWith('-followup') ? next.question : '';
      const reply = await ask(
        '针对最后一条回答，用两句内中文具体回应。若有后续访谈方向，只围绕该方向，用一个问号结束一句开放式问题。输出 JSON 对象，字段 feedback 和 question，没有方向时 question 为空。',
        JSON.stringify({ interview: materials, followup }), 450, true
      );
      const parsed = JSON.parse(reply);
      return { feedback: parsed.feedback, question: parsed.question };
    }
    if (payload.action !== 'report' || next || !Number.isInteger(payload.index) || !chapters[payload.index] ||
        !Array.isArray(payload.sections) || payload.sections.length !== payload.index ||
        !payload.sections.every(section => typeof section === 'string' && section.length <= 12000 && hanCount(section) >= 2000)) return null;
    const content = await ask(
      `撰写《个人天赋使用说明书》的第 ${payload.index + 1} 节，共五节。自行拟贴合来访者的节标题。仅输出本节 Markdown 正文，目标至少 2,200 个汉字。此前章节用于衔接和减少重复。只遵循以下主题：${chapters[payload.index]}`,
      JSON.stringify({ interview: materials, previousSections: payload.sections }), 7000
    );
    if (hanCount(content) < 2000) throw Error('章节篇幅不足');
    return { content };
  };
}

const assets = {
  '/': ['index.html', 'text/html'],
  '/style.css': ['style.css', 'text/css'],
  '/app.js': ['app.js', 'text/javascript'],
  '/guide.mjs': ['guide.mjs', 'text/javascript'],
  '/config.mjs': ['config.mjs', 'text/javascript']
};

export function makeServer({ origin, key, model = 'gpt-4.1-mini', fetchModel } = {}) {
  const run = makeApi({ key, model, fetchModel });
  let active = 0;
  let used = 0;
  let windowStart = Date.now();
  return createServer(async (req, res) => {
    const send = (code, value) => {
      if (!res.headersSent) res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(value));
    };
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET' && Object.hasOwn(assets, pathname)) {
      const [file, type] = assets[pathname];
      try {
        const content = await readFile(new URL('./docs/' + file, import.meta.url));
        res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
        res.end(content);
      } catch { send(500, { error: '无法读取页面' }); }
      return;
    }
    if (pathname !== '/api') return send(404, { error: '页面不存在' });
    const caller = req.headers.origin;
    if (caller !== origin || !origin) return send(403, { error: '来源未获授权' });
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }).end();
      return;
    }
    if (req.method !== 'POST') return send(405, { error: '请求方法不支持' });
    if (!key) return send(503, { error: 'AI 服务尚未配置' });
    if (Date.now() - windowStart > 3600000) {
      used = 0;
      windowStart = Date.now();
    }
    if (used >= 80 || active >= 3) return send(429, { error: 'AI 服务暂时繁忙' });
    active++;
    try {
      const chunks = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 320000) {
          send(413, { error: '资料过长' });
          return;
        }
        chunks.push(chunk);
      }
      let payload;
      try { payload = JSON.parse(Buffer.concat(chunks).toString()); }
      catch { return send(400, { error: '请求格式错误' }); }
      used++;
      const output = await run(payload);
      if (output === null) return send(400, { error: '访谈资料不完整或无效' });
      send(200, output);
    } catch { send(502, { error: 'AI 生成失败，请稍后重试' }); }
    finally { active--; }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || '127.0.0.1';
  const origin = process.env.SITE_ORIGIN || `http://127.0.0.1:${port}`;
  makeServer({ origin, key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL })
    .listen(port, host, () => console.log(`Local: http://127.0.0.1:${port}`));
}
