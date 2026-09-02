const test = require('node:test');
const assert = require('node:assert/strict');
let core, service;
try { core = require('../youtube/growth-core.js'); service = require('../youtube/growth-service.js'); } catch (_) {}
const context = { videoId: 'abcDEF_1234', title: '练习成长', url: 'https://www.youtube.com/watch?v=abcDEF_1234', transcript: '视频建议每天练习十分钟。', overview: '形成练习习惯' };
const report = { summary: '明确练习目标', insights: ['每天一点练习'], actions: [{ priority: '高', action: '安排练习', deliverable: '练习记录', timeframe: '明天', successCriterion: '完成十分钟', obstacle: '忘记', alternative: '设置提醒' }], questions: ['练习是否可持续？'] };
function fixture(complete = async () => '可以从十分钟开始。') {
  const data = {}; let next = 0;
  const storage = { get: async key => structuredClone({ [key]: data[key] }), set: async values => Object.assign(data, structuredClone(values)), remove: async key => { delete data[key]; } };
  return { data, storage, api: service.create({ storage, complete, now: () => '2026-08-31T00:00:00.000Z', makeId: () => `id-${++next}` }) };
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function until(predicate) { for (let n = 0; n < 100 && !predicate(); n++) await new Promise(resolve => setImmediate(resolve)); assert.ok(predicate(), 'expected asynchronous boundary'); }

test('core normalizes video identity and copies background plus attachment instructions', () => {
  assert.ok(core, 'growth core API must exist');
  assert.equal(core.normalizeContext({ ...context, url: 'https://youtu.be/abcDEF_1234?t=9' }).url, context.url);
  const prompt = core.buildClientPrompt(context, '附件里的方法适合练习吗？');
  for (const text of [context.title, context.url, context.transcript, context.overview, '附件里的方法适合练习吗？', '附件', '推断']) assert.ok(prompt.includes(text));
  assert.throws(() => core.normalizeContext({ ...context, videoId: '../secret' }), /视频/);
  assert.throws(() => core.normalizeContext({ ...context, transcript: '' }), /字幕/);
  assert.throws(() => core.normalizeContext({ ...context, url: 'https://evil.test/?v=abcDEF_1234' }), /链接/);
  assert.throws(() => core.normalizeContext({ ...context, url: 'https://youtu.be/another1234' }), /视频|链接/);
  assert.equal(core.reportPath('Folder/a.note.md'), 'Folder/a.note - 对话报告.md');
});

test('empty dialogue and imported-only materials never call the model for a report', async () => {
  assert.ok(service, 'growth service API must exist');
  let calls = 0; const { api } = fixture(async () => { calls++; return 'unexpected'; });
  assert.equal(await api.prepareReport(context), null);
  const state = await api.importSource(context.videoId, { title: '客户端分析', text: '我的笔记内容' });
  assert.equal(state.revision, 1);
  assert.equal(state.turns.length, 0);
  assert.equal(await api.prepareReport(context), null);
  assert.equal(calls, 0);
});

test('successful pairs persist with source provenance and full context in subsequent calls', async () => {
  const calls = []; const { api, storage } = fixture(async input => { calls.push(input); return '练习建议'; });
  const imported = await api.importSource(context.videoId, { title: 'Gemini 分析', text: '附件提出晚间练习' });
  await api.send(context, '如何开始？');
  const result = await api.send(context, '明天怎么检查？');
  assert.equal(result.turns.length, 2);
  assert.equal(result.revision, 3);
  assert.deepEqual(result.turns[0].sourceIds, [imported.sources[0].id]);
  assert.equal(result.turns[0].user, '如何开始？');
  assert.equal(result.turns[0].assistant, '练习建议');
  const messages = calls[1].messages;
  const payload = JSON.stringify(messages);
  for (const value of [context.transcript, context.overview, '附件提出晚间练习', 'Gemini 分析', '如何开始？', '练习建议', '明天怎么检查？']) assert.ok(payload.includes(value));
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /数据|指令/);
  const reopened = service.create({ storage, complete: async () => '' });
  assert.deepEqual(await reopened.get(context.videoId), result);
  result.turns[0].user = '外部修改';
  assert.equal((await api.get(context.videoId)).turns[0].user, '如何开始？');
});

test('failed model calls preserve complete history and sanitize secret-bearing errors', async () => {
  let fail = false; const { api } = fixture(async () => { if (fail) throw new Error('Authorization: Bearer sk-secret provider error'); return '成功'; });
  const before = await api.send(context, '第一问'); fail = true;
  await assert.rejects(api.send(context, '第二问'), error => /失败|重试/.test(error.message) && !/sk-secret|Authorization/.test(error.message));
  assert.deepEqual(await api.get(context.videoId), before);
});

test('cancel releases callers even if the transport ignores AbortSignal and rejects late replies', async () => {
  const pending = deferred(); let signal;
  const { api } = fixture(input => { signal = input.signal; return pending.promise; });
  const sending = api.send(context, '等待');
  const rejected = assert.rejects(sending, /取消|停止|变化/);
  await until(() => signal);
  await api.cancel(context.videoId);
  assert.equal(signal.aborted, true);
  await rejected;
  pending.resolve('迟到回复');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await api.get(context.videoId)).turns.length, 0);
});

for (const mutation of ['clear', 'import', 'remove']) test(`${mutation} during a request invalidates the snapshot and prevents late persistence`, async () => {
  const pending = deferred(); let started = false;
  const { api } = fixture(() => { started = true; return pending.promise; });
  const imported = await api.importSource(context.videoId, { title: '材料', text: '内容' });
  const sending = api.send(context, '等待'); const rejected = assert.rejects(sending, /取消|变化|停止/);
  await until(() => started);
  if (mutation === 'clear') await api.clear(context.videoId);
  if (mutation === 'import') await api.importSource(context.videoId, { title: '新材料', text: '新内容' });
  if (mutation === 'remove') await api.removeSource(context.videoId, imported.sources[0].id);
  pending.resolve('不应保存'); await rejected;
  const state = await api.get(context.videoId);
  assert.equal(state.turns.length, 0);
  assert.equal(state.revision, 2);
  assert.equal(state.report, null);
});

test('one video rejects concurrent sends while another video continues independently', async () => {
  const pending = deferred(); let calls = 0;
  const { api } = fixture(() => ++calls === 1 ? pending.promise : Promise.resolve('另一个视频回答'));
  const first = api.send(context, '问题'); await until(() => calls === 1);
  await assert.rejects(api.send(context, '重复'), /进行|等待|稍后/);
  const second = await api.send({ ...context, videoId: 'different01', url: 'https://youtu.be/different01' }, '独立问题');
  assert.equal(second.turns.length, 1);
  pending.resolve('第一个视频回答'); await first;
  assert.equal((await api.get(context.videoId)).turns[0].assistant, '第一个视频回答');
});

test('reports reuse unchanged revisions but regenerate after context, dialogue or source changes', async () => {
  let calls = 0; const { api } = fixture(async input => { calls++; return input.maxTokens > 4096 ? JSON.stringify(report) : '回答'; });
  await api.send(context, '问题一');
  const first = await api.prepareReport(context, 1);
  assert.deepEqual(await api.prepareReport(context, 1), first);
  assert.equal(calls, 2);
  const changed = await api.prepareReport({ ...context, transcript: '更新字幕' });
  assert.notEqual(changed.key, first.key);
  assert.equal(calls, 3);
  await api.importSource(context.videoId, { title: '材料', text: '补充' });
  assert.equal((await api.get(context.videoId)).report, null);
  await api.prepareReport(context);
  assert.equal(calls, 4);
  await assert.rejects(api.prepareReport(context, 1), /变化|版本/);
  assert.equal(calls, 4);
});

test('report uses full successful dialogue and sources, renders escaped complete appendix and action fields', async () => {
  const calls = []; const { api } = fixture(async input => { calls.push(input); return input.maxTokens > 4096 ? JSON.stringify(report) : '完整回答\n<script>alert(1)</script>\n[[note]]'; });
  await api.importSource(context.videoId, { title: '材料 | <img>', text: '完整材料内容' });
  await api.send(context, '完整问题\n第二行');
  const result = await api.prepareReport(context);
  for (const text of ['完整问题', '第二行', '完整回答', '完整材料内容', '验收标准', '练习记录', '设置提醒', context.url]) assert.ok(result.markdown.includes(text), text);
  assert.ok(!result.markdown.includes('<script>'));
  assert.ok(!result.markdown.includes('<img>'));
  const payload = JSON.stringify(calls[1].messages);
  for (const text of ['完整问题', '完整回答', '完整材料内容', '材料 | <img>', 'successCriterion', 'alternative']) assert.ok(payload.includes(text), text);
});

for (const invalid of ['not json secret sk-123', JSON.stringify({ ...report, actions: [] }), JSON.stringify({ ...report, actions: [{ action: '缺字段' }] }), JSON.stringify({ ...report, insights: [] }), JSON.stringify({ ...report, questions: [] })]) test('invalid report output never caches or exposes raw provider output', async () => {
  const { api } = fixture(async input => input.maxTokens > 4096 ? invalid : '回答');
  await api.send(context, '问题');
  await assert.rejects(api.prepareReport(context), error => /报告|格式/.test(error.message) && !/sk-123/.test(error.message));
  assert.equal((await api.get(context.videoId)).report, null);
});

test('report generation rejects conflicting sends and cannot cache after state mutation', async () => {
  const pending = deferred(); let started = false;
  const { api } = fixture(input => { if (input.maxTokens > 4096) { started = true; return pending.promise; } return Promise.resolve('回答'); });
  await api.send(context, '问题');
  const generating = api.prepareReport(context, 1); const rejected = assert.rejects(generating, /取消|变化|停止/);
  await until(() => started);
  await assert.rejects(api.send(context, '新问题'), /进行|等待|稍后/);
  await api.clear(context.videoId);
  pending.resolve(JSON.stringify(report)); await rejected;
  assert.equal((await api.get(context.videoId)).report, null);
  assert.equal((await api.get(context.videoId)).turns.length, 0);
});

test('limits reject input without silent truncation or provider calls', async () => {
  let calls = 0; const { api } = fixture(async () => { calls++; return '回答'; });
  await assert.rejects(api.send(context, 'x'.repeat(8001)), /8000/);
  await assert.rejects(api.importSource(context.videoId, { title: '材料', text: 'x'.repeat(20001) }), /20000/);
  await assert.rejects(api.send({ ...context, transcript: 'x'.repeat(300001) }, '问题'), /300000/);
  assert.equal(calls, 0);
  for (let i = 0; i < 10; i++) await api.importSource(context.videoId, { title: `材料${i}`, text: '内容' });
  await assert.rejects(api.importSource(context.videoId, { title: '第11份', text: '内容' }), /10/);
  for (let i = 0; i < 40; i++) await api.send(context, `问题${i}`);
  await assert.rejects(api.send(context, '第41问'), /40/);
  assert.equal(calls, 40);
});

test('storage quota failure neither auto-deletes data nor persists a half pair', async () => {
  const { storage, api } = fixture();
  await api.send(context, '原来的问题');
  storage.set = async () => { throw new Error('QUOTA_BYTES sk-private'); };
  await assert.rejects(api.send(context, '新问题'), error => /存储|保存/.test(error.message) && !/sk-private/.test(error.message));
  const result = await api.get(context.videoId);
  assert.equal(result.turns.length, 1);
  assert.equal(result.turns[0].user, '原来的问题');
});

test('an old canceled request cannot interfere with a newer request for the same video', async () => {
  const old = deferred(), fresh = deferred(); let calls = 0;
  const { api } = fixture(() => ++calls === 1 ? old.promise : fresh.promise);
  const first = api.send(context, '旧问题'); const rejected = assert.rejects(first, /取消/);
  await until(() => calls === 1); await api.cancel(context.videoId); await rejected;
  const second = api.send(context, '新问题'); await until(() => calls === 2);
  old.resolve('旧回答'); await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(api.send(context, '重复问题'), /进行/);
  fresh.resolve('新回答'); await second;
  assert.deepEqual((await api.get(context.videoId)).turns.map(turn => [turn.user, turn.assistant]), [['新问题', '新回答']]);
});

test('concurrent imports serialize without losing either source or revisions', async () => {
  const { api } = fixture();
  await Promise.all([api.importSource(context.videoId, { title: '甲', text: '一' }), api.importSource(context.videoId, { title: '乙', text: '二' })]);
  const state = await api.get(context.videoId);
  assert.equal(state.revision, 2);
  assert.deepEqual(state.sources.map(source => source.title), ['甲', '乙']);
});

test('report snapshots cannot be changed by mutating the callers context during generation', async () => {
  const pending = deferred(); let started = false;
  const { api } = fixture(input => { if (input.maxTokens > 4096) { started = true; return pending.promise; } return Promise.resolve('回答'); });
  await api.send(context, '问题');
  const mutable = { ...context };
  const generating = api.prepareReport(mutable);
  await until(() => started); mutable.title = '串台标题'; mutable.transcript = '串台字幕';
  pending.resolve(JSON.stringify(report));
  const result = await generating;
  assert.ok(result.markdown.includes('练习成长'));
  assert.ok(!result.key.includes('串台'));
});

test('adding completed dialogue invalidates cached report and deleting sources records removed provenance', async () => {
  const { api } = fixture(async input => input.maxTokens > 4096 ? JSON.stringify(report) : '回答');
  const imported = await api.importSource(context.videoId, { title: '旧材料', text: '旧材料内容' });
  await api.send(context, '第一问');
  const first = await api.prepareReport(context);
  await api.send(context, '第二问');
  assert.equal((await api.get(context.videoId)).report, null);
  const second = await api.prepareReport(context);
  assert.notEqual(second.key, first.key);
  assert.ok(second.markdown.includes('第二问'));
  await api.removeSource(context.videoId, imported.sources[0].id);
  const third = await api.prepareReport(context);
  assert.ok(third.markdown.includes('已移除材料'));
  assert.ok(!third.markdown.includes('旧材料内容'));
});

test('malformed stored pairs fail safely and can be cleared without deleting another video', async () => {
  const { api, data } = fixture();
  const other = await api.send({ ...context, videoId: 'different01', url: 'https://youtu.be/different01' }, '另一个视频');
  data['ytd_growth_v1_' + context.videoId] = { videoId: context.videoId, revision: 5, turns: [{ user: '残缺问题' }], sources: [], report: null };
  await assert.rejects(api.get(context.videoId), /记录|格式/);
  const cleared = await api.clear(context.videoId);
  assert.equal(cleared.turns.length, 0);
  assert.equal(cleared.revision, 6);
  assert.deepEqual(await api.get('different01'), other);
});

test('invalid raw report field length cannot consume storage and fenced valid JSON is accepted', async () => {
  let bad = true;
  const { api } = fixture(async input => input.maxTokens > 4096 ? (bad ? JSON.stringify({ ...report, summary: 'x'.repeat(6001) }) : '```json\n' + JSON.stringify(report) + '\n```') : '回答');
  await api.send(context, '问题');
  await assert.rejects(api.prepareReport(context), /报告/);
  assert.equal((await api.get(context.videoId)).report, null);
  bad = false;
  assert.ok((await api.prepareReport(context)).markdown.includes('明确练习目标'));
});

test('oversized assistant output fails explicitly without truncating or persisting a pair', async () => {
  const { api } = fixture(async () => 'x'.repeat(60001));
  await assert.rejects(api.send(context, '问题'), /回复.*60000|60000.*回复/);
  const state = await api.get(context.videoId);
  assert.equal(state.turns.length, 0);
  assert.equal(state.revision, 0);
});

test('report requests JSON object output while ordinary chat leaves response format unset', async () => {
  const requests = [];
  const { api } = fixture(async request => { requests.push(request); return request.maxTokens > 4096 ? JSON.stringify(report) : '普通文字回答'; });
  await api.send(context, '问题');
  await api.prepareReport(context);
  assert.equal(requests[0].responseFormat, undefined);
  assert.deepEqual(requests[1].responseFormat, { type: 'json_object' });
});
