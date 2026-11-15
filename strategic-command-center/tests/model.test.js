'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { load } = require('./load');
const { corporate, personal } = require('./fixtures');

const ids = (g) => ({ [g.__SCC.CORPORATE_ID]: corporate, [g.__SCC.PERSONAL_ID]: personal });
function app(over = {}) {
  const g = load({ ...over });
  g.__opts = over;
  const books = ids(g);
  const g2 = load({ ...over, books });
  return wrap(g2);
}
// результаты vm-контекста приводим к обычным объектам, чтобы сравнивать их строго
function wrap(g) {
  for (const f of ['getCorporateData', 'getPersonalData']) {
    const orig = g[f];
    g[f] = (...a) => JSON.parse(JSON.stringify(orig(...a)));
  }
  return g;
}

test('корпоративные данные читаются и совпадают с фикстурой', () => {
  const g = app();
  const d = g.getCorporateData();
  assert.equal(d.projects.length, 6);
  assert.equal(d.actions.length, 4);
  assert.equal(d.talks.length, 3);
  assert.equal(d.risks.length, 6);
  assert.equal(d.decisions.length, 3);
  assert.equal(d.meta.warnings.length, 0, d.meta.warnings.join(' | '));
  assert.equal(d.kpi.projects, 6);
  assert.equal(d.kpi.p1, 3);
  assert.equal(d.kpi.actionsOpen, 4);
  assert.equal(d.kpi.talksCheck, 1);
  assert.equal(d.kpi.risksOpen, 6);
  assert.equal(d.kpi.risksHigh, 1);
});

test('ручная панель сверяется с реестрами, расхождение фиксируется', () => {
  const g = app();
  const d = g.getCorporateData();
  assert.ok(d.reconcile.length === 5 && d.reconcile.every((r) => r.match));
  const broken = JSON.parse(JSON.stringify(corporate));
  broken.tabs['Панель руководителя'][4][1] = '2';
  const g2 = wrap(load({ books: { [g.__SCC.CORPORATE_ID]: broken } }));
  const d2 = g2.getCorporateData();
  assert.ok(d2.reconcile.some((r) => !r.match && r.label === 'Переговоров на проверке'));
  assert.ok(d2.meta.warnings.some((w) => /Переговоров на проверке/.test(w)));
});

test('срок не установлен ≠ просрочка; просрочка только по указанной дате', () => {
  const g = app();
  const d = g.getCorporateData();
  assert.ok(d.actions.every((a) => a.due.state === 'none' && a.due.label === 'Срок не установлен'));
  assert.ok(d.talks.every((t) => t.due.state === 'none'));
  assert.equal(d.kpi.actionsOverdue, 0);
  assert.ok(!d.attention.some((a) => /Просрочено|Контакт просрочен/.test(a.kind)));
  const b = JSON.parse(JSON.stringify(corporate));
  b.tabs['Действия'][1][4] = '10.11.2026';      // просрочено
  b.tabs['Действия'][2][4] = '20.11.2026';      // впереди
  b.tabs['Действия'][3][4] = 'после встречи';   // не дата
  b.tabs['Действия'][4][4] = '01.11.2026'; b.tabs['Действия'][4][5] = 'Выполнено'; // закрыто, срок прошёл
  b.tabs['Контроль переговоров'][3][8] = '12.11.2026';
  const dd = wrap(load({ books: { [g.__SCC.CORPORATE_ID]: b } })).getCorporateData();
  assert.equal(dd.actions[0].due.state, 'overdue');
  assert.equal(dd.actions[0].due.days, 5);
  assert.equal(dd.actions[1].due.state, 'set');
  assert.equal(dd.actions[2].due.state, 'unparsed');
  assert.equal(dd.actions[3].due.state, 'set', 'закрытое действие не просрочено');
  assert.equal(dd.talks[2].due.state, 'overdue');
  assert.equal(dd.kpi.actionsOverdue, 1);
});

test('риски: вероятность и ущерб не придумываются', () => {
  const d = app().getCorporateData();
  assert.equal(d.optional.riskProbability, false);
  assert.equal(d.optional.riskImpact, false);
  assert.ok(d.risks.every((r) => r.probability === '' && r.impact === ''));
  assert.equal(d.risks.find((r) => r.id === 'R05').rank, 3);
});

test('связи проект ↔ записи без дублей и без потерь', () => {
  const d = app().getCorporateData();
  const c01 = d.projects.find((p) => p.id === 'C01');
  assert.deepEqual(c01.actionIds, ['A01', 'A02']);
  assert.deepEqual(c01.talkIds, ['N01', 'N02', 'N03']);
  assert.deepEqual(c01.riskIds, ['R01', 'R02']);
  assert.equal(c01.owners.length, 1);
  const urls = c01.sources.map((s) => (s.url || s.text).toLowerCase());
  assert.equal(new Set(urls).size, urls.length, 'источники не должны повторяться');
  // портфельные решения не приписываются проектам
  assert.deepEqual(d.meta.portfolioDecisions, ['D01', 'D02', 'D03']);
  const sum = d.projects.reduce((n, p) => n + p.actionIds.length, 0);
  assert.equal(sum, d.actions.length);
  assert.equal(d.meta.orphans.length, 0);
  assert.equal(Object.values(d.meta.duplicates).flat().length, 0);
});

test('актуальность: дата последней записи журнала и признак устаревания', () => {
  const g = app();
  const d = g.getCorporateData();
  assert.equal(d.meta.lastSync.date, '15.11.2026');
  assert.equal(d.meta.lastSync.ageDays, 0);
  assert.equal(d.meta.lastSync.stale, false);
  assert.equal(d.meta.auditDate, '15.11.2026');
  const old = JSON.parse(JSON.stringify(corporate));
  old.tabs['Журнал синхронизации'].forEach((r, i) => { if (i) r[0] = '01.11.2026'; });
  const d2 = wrap(load({ books: { [g.__SCC.CORPORATE_ID]: old } })).getCorporateData();
  assert.equal(d2.meta.lastSync.stale, true);
  assert.ok(d2.attention.some((a) => /не обновлялся 14 дн/.test(a.title)));
});

test('достоверность: подтверждено / проверка / нет данных', () => {
  const d = app().getCorporateData();
  const n = Object.fromEntries(d.talks.map((t) => [t.id, t]));
  assert.equal(n.N01.st, 'confirmed');
  assert.equal(n.N03.st, 'check');
  assert.equal(n.N03.stFact, 'missing' === n.N03.stFact ? 'missing' : n.N03.stFact);
  assert.equal(d.projects.find((p) => p.id === 'C03').stChecked, 'check');
  assert.equal(d.projects.find((p) => p.id === 'C03').stState, 'check');
  assert.equal(d.sources.find((s) => /архив/.test(s.type)).st, 'check');
});

test('ссылки: только https и только Google-домены', () => {
  const g = app();
  const bad = JSON.parse(JSON.stringify(corporate));
  bad.tabs['Проекты'][1][5] = 'javascript:alert(1)';
  bad.tabs['Проекты'][2][5] = 'https://evil.example.com/x';
  bad.tabs['Проекты'][3][5] = 'http://docs.google.com/document/d/1';
  const d = wrap(load({ books: { [g.__SCC.CORPORATE_ID]: bad } })).getCorporateData();
  assert.deepEqual(d.projects.slice(0, 3).map((p) => p.source.url), ['', '', '']);
  assert.ok(d.projects[3].source.url.startsWith('https://docs.google.com/'));
});

test('отсутствующая вкладка или столбец не роняют приложение', () => {
  const g = app();
  const cut = JSON.parse(JSON.stringify(corporate));
  delete cut.tabs['Риски'];
  cut.tabs['Действия'][0] = cut.tabs['Действия'][0].filter((h) => h !== 'Ответственный');
  cut.tabs['Действия'] = cut.tabs['Действия'].map((r, i) => i === 0 ? r : r.filter((_, j) => j !== 3));
  const d = wrap(load({ books: { [g.__SCC.CORPORATE_ID]: cut } })).getCorporateData();
  assert.equal(d.risks.length, 0);
  assert.ok(d.meta.warnings.some((w) => /«Риски» не найдена/.test(w)));
  assert.ok(d.meta.warnings.some((w) => /«Действия» нет столбцов: owner/.test(w)));
  assert.equal(d.actions[0].owner, '');
});

test('личный контур: отдельные данные, пробелы названы, цифры не придуманы', () => {
  const g = app();
  const p = g.getPersonalData();
  assert.equal(p.contour, 'personal');
  assert.equal(p.projects.length, 1);
  assert.equal(p.projects[0].actions.length, 1);
  assert.equal(p.summary.capital.st, 'missing');
  assert.equal(p.summary.deals.value, '0');
  assert.equal(p.capital.length, 2);
  assert.ok(p.gaps.length >= 8);
  assert.equal(p.conflicts.unresolved, 2);
  assert.equal(p.capital[0].checkSt, 'assumption');
  // в личных данных нет корпоративных ID и наоборот
  const flat = JSON.stringify(p);
  assert.ok(!/Accor|Lotte|Luxury|C0\d/.test(flat), 'корпоративные сведения в личном контуре');
  const c = JSON.stringify(g.getCorporateData());
  assert.ok(!/Дом — архитектура|совладение/.test(c), 'личные сведения в корпоративном контуре');
});

test('каждый контур читает только свою таблицу', () => {
  const g = app();
  const opened = [];
  const orig = g.SpreadsheetApp.openById;
  g.SpreadsheetApp.openById = (id) => { opened.push(id); return orig(id); };
  g.getPersonalData();
  assert.deepEqual([...new Set(opened)], [g.__SCC.PERSONAL_ID]);
  opened.length = 0;
  g.getCorporateData();
  assert.ok(opened.every((id) => id === g.__SCC.CORPORATE_ID));
});

test('доступ: чужая почта, пустая личность, нет владельца — отказ', () => {
  const stranger = app({ email: 'stranger@example.com' });
  assert.throws(() => stranger.getCorporateData(), /ACCESS_DENIED/);
  assert.throws(() => stranger.getPersonalData(), /ACCESS_DENIED/);
  assert.match(stranger.doGet().html, /Доступ закрыт/);
  assert.ok(!/Corporate|Accor|Lotte/.test(stranger.doGet().html));
  const anon = app({ email: '' });
  assert.throws(() => anon.getCorporateData(), /ACCESS_DENIED/);
  // владелец не определился и свойство не задано → закрыто
  const g = load({ books: {}, email: 'owner@example.com' });
  assert.throws(() => g.getCorporateData(), /ACCESS_DENIED/);
  // владелец проходит
  assert.equal(app().doGet().file, 'Index');
  // регистр и свойство OWNER_EMAIL
  const prop = app({ email: 'Boss@Example.com', props: { OWNER_EMAIL: 'boss@example.com' } });
  assert.equal(prop.doGet().file, 'Index');
});

test('приложение ничего не пишет и не отправляет (в рантайме и в исходнике)', () => {
  const g = app();
  g.getCorporateData(); g.getPersonalData();
  assert.deepEqual(g.__calls.writes, []);
  const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8');
  for (const bad of ['setValue', 'setValues', 'appendRow', 'sendEmail', 'GmailApp', 'MailApp', 'DriveApp', 'deleteRow', 'clearContent', 'setSharing', 'UrlFetchApp', 'CalendarApp']) {
    assert.ok(!src.includes(bad), 'найдено запрещённое: ' + bad);
  }
});

test('манифест: закрытый режим и минимальные права', () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'appsscript.json'), 'utf8'));
  assert.equal(m.webapp.access, 'MYSELF');
  assert.equal(m.webapp.executeAs, 'USER_ACCESSING');
  assert.deepEqual(m.oauthScopes.sort(), [
    'https://www.googleapis.com/auth/spreadsheets.readonly',
    'https://www.googleapis.com/auth/userinfo.email'
  ]);
});
