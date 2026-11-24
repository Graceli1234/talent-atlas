import { nextQuestion, localFeedback, transcript, reportPrompt, chapters, hanCount } from './guide.mjs';
import { suggestedEndpoint } from './config.mjs';

const $ = id => document.getElementById(id);
const key = 'talent-atlas-v1';
const blank = () => ({ started: false, entries: [], current: null, draft: '', sections: [], endpoint: '' });
let state = blank();
let busy = false;
try {
  const saved = JSON.parse(localStorage.getItem(key));
  if (saved && Array.isArray(saved.entries)) state = { ...state, ...saved };
} catch {}
function persist() {
  try { localStorage.setItem(key, JSON.stringify(state)); } catch {
    $('settings').open = true;
    $('connection-status').textContent = '浏览器无法保存记录，请在关闭页面前下载访谈。';
  }
}
function history(target) {
  $(target).replaceChildren(...state.entries.map(entry => {
    const block = document.createElement('div');
    block.className = 'entry';
    const title = document.createElement('strong');
    title.textContent = entry.question;
    const reply = document.createElement('p');
    reply.textContent = entry.answer || '已跳过';
    block.append(title, reply);
    return block;
  }));
}
function render({ focus = false } = {}) {
  const question = state.current ?? nextQuestion(state.entries);
  const done = state.started && !question;
  for (const id of ['welcome', 'method']) $(id).hidden = state.started;
  $('interview').hidden = !state.started || done;
  $('result').hidden = !done;
  $('settings').hidden = false;
  $('reset').hidden = !state.started;
  $('generate').hidden = !state.endpoint || !state.entries.some(entry => entry.answer);
  $('generate').disabled = busy || state.sections.length === chapters.length;
  $('generate').textContent = state.sections.length ? '继续生成说明书' : '在网页内生成说明书';
  $('connection').querySelectorAll('input, button').forEach(control => { control.disabled = busy; });
  $('reset').disabled = busy;
  if (done) {
    history('result-history');
    $('last-feedback').textContent = state.entries.at(-1)?.feedback ?? '';
    const complete = state.sections.length === chapters.length;
    $('report').hidden = !state.sections.length;
    $('save-report').hidden = !complete;
    $('report').textContent = state.sections.join('\n\n') + (complete ? '\n\n访谈附录\n\n' + transcript(state.entries) : '');
    if (focus) $('result-heading').focus();
  }
  if (question && state.started) {
    $('progress').textContent = `第 ${state.entries.length + 1} 题 · 最多 10 题`;
    $('mode').textContent = state.endpoint ? 'AI 访谈' : '本地引导';
    $('feedback').textContent = state.entries.at(-1)?.feedback ?? '';
    $('feedback').hidden = !state.entries.length;
    $('question').textContent = question.question;
    $('hint').textContent = question.hint;
    $('answer').value = state.draft;
    $('past').hidden = !state.entries.length;
    history('history');
    if (focus) $('question').focus();
  }
}
async function api(payload) {
  const response = await fetch(state.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(160000)
  });
  if (!response.ok) throw new Error('AI 服务暂时不可用');
  return response.json();
}
async function advance(skipped) {
  if (busy) return;
  const answer = skipped ? '' : $('answer').value.trim();
  if (!skipped && !answer) {
    $('status').textContent = '写下一点你记得的事，或者跳过这一题。';
    $('answer').focus();
    return;
  }
  const item = state.current ?? nextQuestion(state.entries);
  const entry = { id: item.id, question: item.question, answer, feedback: localFeedback(item, answer) };
  const entries = [...state.entries, entry];
  const next = nextQuestion(entries);
  let current = next ?? null;
  let usedLocal = false;
  if (state.endpoint && answer) {
    busy = true;
    $('answer-form').querySelectorAll('textarea, button').forEach(control => { control.disabled = true; });
    $('reset').disabled = true;
    $('connection').querySelectorAll('input, button').forEach(control => { control.disabled = true; });
    $('status').textContent = '正在整理这段回答……';
    try {
      const result = await api({ action: 'feedback', entries });
      if (typeof result.feedback === 'string' && result.feedback.trim()) entry.feedback = result.feedback.trim().slice(0, 240);
      if (next?.id.endsWith('-followup') && typeof result.question === 'string') {
        const question = result.question.trim();
        if (question.length <= 95 && /^[^？?！!。\n]+[？?]$/u.test(question)) current = { ...next, question };
      }
    } catch { usedLocal = true; }
    busy = false;
    $('answer-form').querySelectorAll('textarea, button').forEach(control => { control.disabled = false; });
  }
  Object.assign(state, { entries, current, draft: '' });
  persist();
  const status = current ? $('status') : $('report-status');
  status.textContent = usedLocal ? 'AI 暂时连不上，本轮已使用本地回应。' : '';
  render({ focus: true });
}
async function generate() {
  if (busy || !state.endpoint) return;
  busy = true;
  render();
  try {
    while (state.sections.length < chapters.length) {
      const index = state.sections.length;
      $('report-status').textContent = `正在生成第 ${index + 1} / ${chapters.length} 部分，可在中断后继续。`;
      const { content } = await api({ action: 'report', entries: state.entries, index, sections: state.sections });
      if (typeof content !== 'string' || hanCount(content) < 2000) throw new Error('篇幅不足');
      state.sections.push(content);
      persist();
      render();
    }
    $('report-status').textContent = `已生成说明书，正文共 ${hanCount(state.sections.join('')).toLocaleString('zh-CN')} 个汉字，另附完整访谈。`;
  } catch { $('report-status').textContent = '本节生成中断或篇幅不足。已完成的部分已保留，可以点击按钮继续。'; }
  busy = false;
  render();
}
function download(name, content) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('start').addEventListener('click', () => {
  state.started = true;
  persist();
  render({ focus: true });
});
$('answer').addEventListener('input', () => { state.draft = $('answer').value; persist(); });
$('answer-form').addEventListener('submit', event => { event.preventDefault(); advance(false); });
$('skip').addEventListener('click', () => advance(true));
$('reset').addEventListener('click', () => {
  if (busy || !confirm('清空本浏览器中的访谈、草稿与报告，重新开始？')) return;
  state = { ...blank(), endpoint: state.endpoint };
  $('manual-copy').value = '';
  $('manual-copy').hidden = true;
  $('report-status').textContent = '';
  $('status').textContent = '';
  $('report').textContent = '';
  for (const id of ['history', 'result-history', 'feedback', 'last-feedback', 'answer']) $(id).textContent = '';
  $('answer').value = '';
  persist();
  render();
  $('start').focus();
});
$('connection').addEventListener('submit', event => {
  event.preventDefault();
  const value = $('endpoint').value.trim();
  try {
    if (value) {
      const url = new URL(value);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw Error();
      if (url.username || url.password || url.hash) throw Error();
    }
    state.endpoint = value;
    persist();
    $('connection-status').textContent = value ? '连接地址已保存。下次使用 AI 时会发送访谈内容。' : '已切换回本地引导。';
    render();
  } catch { $('connection-status').textContent = '请填写有效的 HTTPS 服务地址。'; }
});
$('copy').addEventListener('click', async () => {
  const payload = reportPrompt(state.entries);
  try {
    await navigator.clipboard.writeText(payload);
    $('report-status').textContent = '已复制生成指令和完整访谈。';
  } catch {
    $('manual-copy').hidden = false;
    $('manual-copy').value = payload;
    $('manual-copy').select();
    $('report-status').textContent = '请手动复制下方已选中的材料。';
  }
});
$('generate').addEventListener('click', generate);
$('save-transcript').addEventListener('click', () => download('天赋访谈记录.md', transcript(state.entries)));
$('save-report').addEventListener('click', () => download('个人天赋使用说明书.md', '# 个人天赋使用说明书\n\n' + $('report').textContent));
$('endpoint').value = state.endpoint || suggestedEndpoint;
render();
