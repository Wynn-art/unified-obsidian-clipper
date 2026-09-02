const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const growthUI = require('../web/growth-ui.js');

const bundle = fs.readFileSync(path.join(__dirname, '../web/popup.js'), 'utf8');
function section(start, end) {
  const from = bundle.indexOf(start), to = bundle.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `production boundary missing: ${start}`);
  return bundle.slice(from, to);
}
const production = section('var obsidian_note_creator_awaiter=', 'function obsidian_note_creator_generateFrontmatter')
  + ';var popup_awaiter=obsidian_note_creator_awaiter;'
  + section('function refreshFields', 'function toggleMetadataProperties');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
class Element {
  constructor(value = '') { this.value = value; this.children = []; this.listeners = {}; this.textContent = ''; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute() {}
  getAttribute(name) { return name === 'data-type' ? 'text' : null; }
}
function fixture() {
  const elements = new Map(), errors = [];
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
    querySelector: () => null,
    createElement: () => new Element(),
  };
  document.getElementById('note-content-field').value = 'Existing article';
  const growth = growthUI.create({ document, copy: async () => {}, confirm: () => true,
    send: async message => ({ success: true, value: { videoId: message.videoId, revision: 0, turns: [], sources: [], report: null } }),
  });
  let latestCommit;
  const commitRefresh = growth.commitRefresh;
  growth.commitRefresh = (...args) => (latestCommit = commitRefresh(...args));
  const articles = new Map(['A', 'B'].map(id => [id, { gate: deferred(), started: deferred() }]));
  const value = (format, variables) => variables[format] || format;
  const context = {
    console: { log() {}, warn() {}, error() {} }, Promise, document,
    popup_templates: [{}], popup_currentVariables: {}, currentTabId: 'A', isPanelOpen: false,
    popup_currentTemplate: {
      name: 'Article', properties: [{ name: 'author', value: '{{author}}' }],
      noteNameFormat: '{{title}}', path: '{{path}}', noteContentFormat: '{{content}}',
    },
    generalSettings: { interpreterEnabled: false },
    getTabInfo: async id => ({ url: `https://example.com/${id}`, title: id }),
    isBlankPage: () => false, isValidUrl: () => true, isRestrictedUrl: () => false,
    memoizedExtractPageContent: async id => ({ content: id, title: id }),
    initializePageContent: async id => ({ currentVariables: {
      '{{title}}': id, '{{content}}': `Body ${id}`, '{{path}}': `Folder ${id}`, '{{author}}': `Author ${id}`,
    } }),
    memoizedCompileTemplate: async (id, format, variables) => {
      if (format === '{{content}}') {
        articles.get(id).started.resolve();
        await articles.get(id).gate.promise;
      }
      return value(format, variables);
    },
    compileTemplate: async (id, format, variables) => value(format, variables),
    formatPropertyValue: value => value, adjustNoteNameHeight() {}, debugLog() {},
    showError: error => { errors.push(error); growth.invalidate(); },
    WEB_ARTICLE_GROWTH: growth,
  };
  vm.createContext(context);
  vm.runInContext(production, context);
  return { growth, errors, articles,
    field: id => document.getElementById(id).value,
    settleGrowth: () => latestCommit,
    refresh: id => { context.currentTabId = id; return context.refreshFields(id, { rebuildSkeleton: false, checkTemplateTriggers: false }); },
  };
}

test('production refresh keeps growth unavailable until article template fields are rendered', async () => {
  const f = fixture(), run = f.refresh('A');
  await f.articles.get('A').started.promise;
  try {
    assert.equal(f.growth.getContext(), null);
    assert.equal(f.growth.isReady(), false);
    assert.equal(f.field('note-content-field'), 'Existing article');
  } finally { f.articles.get('A').gate.resolve(); await run; await f.settleGrowth(); }
  assert.deepEqual(f.errors, []);
  assert.equal(f.field('note-content-field'), 'Body A');
  assert.equal(f.growth.getContext().url, 'https://example.com/A');
  assert.equal(f.growth.isReady(), true);
});

test('late production compilation for A cannot overwrite B fields or growth context', async () => {
  const f = fixture(), first = f.refresh('A');
  await f.articles.get('A').started.promise;
  const second = f.refresh('B');
  await f.articles.get('B').started.promise;
  f.articles.get('B').gate.resolve(); await second;
  f.articles.get('A').gate.resolve(); await first;
  await f.settleGrowth();
  assert.deepEqual(f.errors, []);
  assert.equal(f.field('note-content-field'), 'Body B');
  assert.equal(f.field('note-name-field'), 'B');
  assert.equal(f.field('path-name-field'), 'Folder B');
  assert.equal(f.field('author'), 'Author B');
  assert.equal(f.growth.getContext().url, 'https://example.com/B');
  assert.equal(f.growth.isReady(), true);
});

test('late production compilation failure for A does not invalidate current B', async () => {
  const f = fixture(), first = f.refresh('A');
  await f.articles.get('A').started.promise;
  const second = f.refresh('B');
  await f.articles.get('B').started.promise;
  f.articles.get('B').gate.resolve(); await second;
  f.articles.get('A').gate.reject(new Error('Old article compilation failed')); await first;
  await f.settleGrowth();
  assert.deepEqual(f.errors, []);
  assert.equal(f.field('note-content-field'), 'Body B');
  assert.equal(f.growth.getContext().url, 'https://example.com/B');
  assert.equal(f.growth.isReady(), true);
});
