/**
 * Strategic Command Center — серверная часть (Google Apps Script).
 *
 * Принципы:
 *  - Только чтение. Запись в таблицы, отправка писем и изменение файлов в коде отсутствуют.
 *  - Приложение запускается от имени вошедшего пользователя (см. appsscript.json),
 *    доступ только владельцу. Дополнительно каждая функция проверяет почту вызывающего.
 *  - Отсутствующие данные не заменяются выдуманными: пустое поле остаётся пустым,
 *    срок считается просроченным только если он указан и прошёл.
 *  - Корпоративный и личный контуры читаются разными функциями и не смешиваются.
 */

var SCC = {
  CORPORATE_ID: '16AWVZ0C7XkXfGBRMcHjpLnkHWTd8A27gB1ioDx-0LcA',
  PERSONAL_ID: '1K6pCrRl-oj0S_UWtI-jmXsomgjm-iI95oo5P0NuyeQI',
  STALE_DAYS: 7, // порог «журнал давно не обновлялся»; рабочий параметр, не факт из данных
  CORPORATE_TABS: ['Панель руководителя', 'Проекты', 'Действия', 'Контроль переговоров', 'Риски',
    'Журнал решений', 'Источники', 'Журнал синхронизации', 'Инвентаризация источников'],
  PERSONAL_TABS: ['Проекты', 'Действия', 'Решения', 'Капитал и доли', 'Личная панель']
};

/* ───────────── Точки входа и доступ ───────────── */

function doGet() {
  var gate = checkAccess_();
  if (!gate.ok) {
    return HtmlService.createHtmlOutput(
      '<!doctype html><body style="margin:0;background:#0e0f11;color:#cfcdc8;font:16px -apple-system,Helvetica,sans-serif;' +
      'display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px">' +
      '<div><div style="font-size:20px;margin-bottom:8px">Доступ закрыт</div>' +
      '<div style="color:#8b8f97">Это личная панель. Войдите под учётной записью владельца.</div></div></body>')
      .setTitle('Доступ закрыт');
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Strategic Command Center')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function checkAccess_(sheetId) {
  var email = '';
  try { email = String(Session.getActiveUser().getEmail() || '').toLowerCase(); } catch (e) { email = ''; }
  if (!email) return { ok: false, reason: 'no_identity' };
  var allowed = allowedEmails_(sheetId || SCC.CORPORATE_ID);
  if (!allowed.length) return { ok: false, reason: 'no_owner_configured' }; // закрыто по умолчанию
  if (allowed.indexOf(email) === -1) return { ok: false, reason: 'not_owner' };
  return { ok: true, email: email };
}

function allowedEmails_(sheetId) {
  var prop = '';
  try { prop = PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL') || ''; } catch (e) { prop = ''; }
  if (prop) {
    return prop.split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
  }
  try {
    var owner = SpreadsheetApp.openById(sheetId).getOwner();
    if (owner && owner.getEmail()) return [String(owner.getEmail()).toLowerCase()];
  } catch (e) { /* владелец не определён — остаёмся закрытыми */ }
  return [];
}

function requireAccess_(sheetId) {
  var gate = checkAccess_(sheetId);
  if (!gate.ok) throw new Error('ACCESS_DENIED');
  return gate;
}

function makeCtx_() {
  var tz = Session.getScriptTimeZone();
  var now = new Date();
  return {
    todayIso: Utilities.formatDate(now, tz, 'yyyy-MM-dd'),
    nowIso: now.toISOString(),
    nowLabel: Utilities.formatDate(now, tz, 'dd.MM.yyyy HH:mm'),
    tz: tz,
    staleDays: SCC.STALE_DAYS
  };
}

function loadTabs_(spreadsheetId, names) {
  var ss = SpreadsheetApp.openById(spreadsheetId);
  var tabs = {};
  names.forEach(function (n) {
    var sh = ss.getSheetByName(n);
    tabs[n] = sh ? sh.getDataRange().getDisplayValues() : null;
  });
  return { title: ss.getName(), tabs: tabs };
}

/** Корпоративный контур. Читает только корпоративную таблицу. */
function getCorporateData() {
  requireAccess_(SCC.CORPORATE_ID);
  return buildCorporate_(loadTabs_(SCC.CORPORATE_ID, SCC.CORPORATE_TABS), makeCtx_());
}

/** Личный контур. Читает только личную таблицу. */
function getPersonalData() {
  requireAccess_(SCC.PERSONAL_ID);
  return buildPersonal_(loadTabs_(SCC.PERSONAL_ID, SCC.PERSONAL_TABS), makeCtx_());
}

/* ───────────── Общие функции модели (чистые, без Google API) ───────────── */

function norm_(s) {
  return String(s === null || s === undefined ? '' : s).replace(/\s+/g, ' ').trim();
}

/**
 * Читает таблицу «первая строка — заголовки». spec: { ключ: [допустимые заголовки] }.
 * Возвращает { rows, has, missing }. Пустые строки пропускаются, исходные значения не меняются.
 */
function table_(values, spec, optional) {
  optional = optional || [];
  var out = { rows: [], has: {}, missing: [], found: !!(values && values.length) };
  var keys = Object.keys(spec);
  if (!out.found) { out.missing = keys.filter(function (k) { return optional.indexOf(k) < 0; }); return out; }
  var headers = values[0].map(norm_);
  var idx = {};
  keys.forEach(function (k) {
    var at = -1;
    spec[k].forEach(function (alias) { if (at < 0) { var i = headers.indexOf(alias); if (i >= 0) at = i; } });
    if (at < 0) { if (optional.indexOf(k) < 0) out.missing.push(k); out.has[k] = false; } else { idx[k] = at; out.has[k] = true; }
  });
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var empty = true;
    for (var c = 0; c < row.length; c++) { if (norm_(row[c]) !== '') { empty = false; break; } }
    if (empty) continue;
    var o = { _row: r + 1 };
    keys.forEach(function (k) { o[k] = idx[k] === undefined ? '' : norm_(row[idx[k]]); });
    out.rows.push(o);
  }
  return out;
}

function isMissingText_(t) {
  var s = norm_(t).toLowerCase();
  if (!s) return true;
  return /^(не установлен|не установлена|неизвестн|не определ|нет данных|нет подтвержд|нет$|нет(?![а-яa-z])|[—–-]$)/.test(s);
}

/**
 * Класс достоверности текста статуса:
 *  confirmed — подтверждено; check — требует проверки; assumption — цель/шаблон/предположение;
 *  missing — данных нет; neutral — нейтральная запись без оценки.
 */
function classify_(text) {
  var s = norm_(text).toLowerCase();
  if (!s) return 'missing';
  if (/требу|ожида|не подтвержд|не сверен|частично|на проверк|кандидат|не оценивал|проверять до|необходимо/.test(s)) return 'check';
  if (/^(не установлен|не установлена|неизвестн|не определ|нет данных|нет подтвержд|нет(?![а-яёa-z]))/.test(s)) return 'missing';
  if (/цель|шаблон|гипотез|предполож/.test(s)) return 'assumption';
  if (/подтвержд|сверена|утвержд|действует|найден|успешно|выполнен|запись выполнена/.test(s)) return 'confirmed';
  return 'neutral';
}

function classifyChecked_(text) {
  var s = norm_(text).toLowerCase();
  if (!s) return 'missing';
  if (/^нет(?![а-яёa-z])|частично/.test(s)) return 'check';
  return 'neutral'; // «найден» — это факт обнаружения, а не проверки содержимого
}

function parseDate_(text) {
  var s = norm_(text), m;
  if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/))) return makeDate_(+m[3], +m[2], +m[1]);
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return makeDate_(+m[1], +m[2], +m[3]);
  return null;
}
function makeDate_(y, mo, d) {
  var dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { iso: pad_(y, 4) + '-' + pad_(mo, 2) + '-' + pad_(d, 2), label: pad_(d, 2) + '.' + pad_(mo, 2) + '.' + y, t: dt.getTime() };
}
function pad_(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }
function dayDiff_(aIso, bIso) { // a - b в днях
  return Math.round((parseDate_(aIso).t - parseDate_(bIso).t) / 86400000);
}

/** Срок: просрочка объявляется только при указанной, разобранной дате в прошлом. */
function dueInfo_(text, ctx, isOpen) {
  var s = norm_(text);
  if (isMissingText_(s)) return { state: 'none', label: 'Срок не установлен', iso: '' };
  var d = parseDate_(s);
  if (!d) return { state: 'unparsed', label: s, iso: '' };
  var diff = dayDiff_(d.iso, ctx.todayIso);
  if (diff < 0 && isOpen) return { state: 'overdue', label: d.label, iso: d.iso, days: -diff };
  return { state: diff === 0 ? 'today' : 'set', label: d.label, iso: d.iso, days: diff };
}

function safeUrl_(text) {
  var s = String(text || '').replace(/\\([_#&=])/g, '$1');
  var m = s.match(/https:\/\/[^\s"'<>]+/);
  if (!m) return '';
  var url = m[0].replace(/[).,;]+$/, '');
  var host = (url.match(/^https:\/\/([^\/?#]+)/) || [])[1] || '';
  if (['docs.google.com', 'drive.google.com', 'mail.google.com'].indexOf(host.toLowerCase()) === -1) return '';
  return url;
}
function sourceKind_(text, url) {
  var s = String(text || '').toLowerCase();
  if (/mail\.google\.com/.test(url) || /gmail/.test(s)) return 'Gmail';
  if (/drive\.google\.com|docs\.google\.com/.test(url) || /drive/.test(s)) return 'Drive';
  return url ? 'Ссылка' : 'Запись';
}

function levelRank_(t) {
  var s = norm_(t).toLowerCase();
  if (/крит|высок/.test(s)) return 3;
  if (/средн/.test(s)) return 2;
  if (/низк/.test(s)) return 1;
  return 0;
}
function isOpenAction_(status) {
  var s = norm_(status).toLowerCase();
  if (!s) return false;
  if (/закрыт|выполнен|готов|отмен|завершен/.test(s)) return false;
  return /открыт|в работе|ожида|новое|в процессе/.test(s);
}
function isOpenRisk_(state) {
  var s = norm_(state).toLowerCase();
  if (!s) return false;
  return !/закрыт|снят|устранен|принят/.test(s);
}

function dupIds_(rows, key) {
  var seen = {}, dups = [];
  rows.forEach(function (r) {
    var k = (r[key] || '').toUpperCase();
    if (!k) return;
    if (seen[k]) { if (dups.indexOf(k) < 0) dups.push(k); } else seen[k] = 1;
  });
  return dups;
}

function panelLookup_(rows, label) {
  for (var i = 0; i < rows.length; i++) if (rows[i].label.toLowerCase() === label.toLowerCase()) return rows[i];
  return null;
}

function parsePanel_(values) {
  var rows = [], fresh = [];
  if (!values) return { found: false, rows: rows, fresh: fresh };
  for (var r = 1; r < values.length; r++) {
    var v = values[r];
    var a = norm_(v[0]);
    if (a) rows.push({ label: a, value: norm_(v[1]), note: norm_(v[2]), source: norm_(v[3]) });
    var f = norm_(v[5]);
    if (f) fresh.push({ label: f, state: norm_(v[6]), st: classify_(v[6]) });
  }
  return { found: true, rows: rows, fresh: fresh };
}

function tabReport_(name, t) {
  return { name: name, ok: !!t.found, rows: t.rows ? t.rows.length : 0, missingColumns: t.missing || [] };
}

/* ───────────── Корпоративный контур ───────────── */

var COLS_ = {
  projects: { id: ['ID'], name: ['Проект'], priority: ['Приоритет'], state: ['Состояние', 'Статус'], next: ['Следующее действие'], source: ['Источник'], checked: ['Проверено'] },
  actions: { id: ['ID'], projectId: ['Проект ID'], title: ['Действие'], owner: ['Ответственный'], due: ['Срок'], status: ['Статус'], basis: ['Основание'] },
  talks: { id: ['ID'], projectId: ['Проект ID'], contact: ['Контакт'], org: ['Организация'], fact: ['Последний подтверждённый факт'], factDate: ['Дата факта'], turn: ['Чей ход'], next: ['Следующее действие'], due: ['Срок контакта'], status: ['Статус'], source: ['Источник'] },
  risks: { id: ['ID'], projectId: ['Проект ID'], title: ['Риск / контрольная точка'], category: ['Категория'], level: ['Уровень'], probability: ['Вероятность'], impact: ['Последствия', 'Ущерб'], basis: ['Основание'], action: ['Действие'], owner: ['Ответственный'], due: ['Срок'], state: ['Состояние'], source: ['Источник'] },
  decisions: { date: ['Дата'], id: ['ID'], projectId: ['Проект ID'], decision: ['Решение / предложение'], alternatives: ['Альтернативы'], reason: ['Причина / доказательство'], review: ['Условие пересмотра'], status: ['Статус'], owner: ['Ответственный'], source: ['Источник'] },
  sources: { projectId: ['Проект'], type: ['Тип'], doc: ['Документ / письмо'], url: ['Ссылка'], status: ['Статус'] },
  sync: { date: ['Дата'], type: ['Тип события'], source: ['Источник'], check: ['Проверка'], result: ['Итог'], changes: ['Изменения в реестре'], note: ['Примечание'] },
  inventory: { group: ['Группа'], found: ['Обнаружено'], canonical: ['Канонический источник'], dup: ['Потенциальные повторы'], action: ['Действие'], confidence: ['Уверенность'], checked: ['Проверка'], status: ['Статус'] }
};

function src_(text) {
  var url = safeUrl_(text);
  return { text: norm_(text).replace(/\\([_#&=])/g, '$1'), url: url, kind: sourceKind_(text, url) };
}

function buildCorporate_(raw, ctx) {
  var T = raw.tabs;
  var tProjects = table_(T['Проекты'], COLS_.projects);
  var tActions = table_(T['Действия'], COLS_.actions);
  var tTalks = table_(T['Контроль переговоров'], COLS_.talks);
  var tRisks = table_(T['Риски'], COLS_.risks, ['probability', 'impact']);
  var tDecisions = table_(T['Журнал решений'], COLS_.decisions);
  var tSources = table_(T['Источники'], COLS_.sources);
  var tSync = table_(T['Журнал синхронизации'], COLS_.sync);
  var tInv = table_(T['Инвентаризация источников'], COLS_.inventory);
  var panel = parsePanel_(T['Панель руководителя']);

  var projects = tProjects.rows.map(function (r) {
    return {
      id: r.id, name: r.name, priority: r.priority, state: r.state, next: r.next, source: src_(r.source),
      checked: r.checked, stState: classify_(r.state), stChecked: classifyChecked_(r.checked), row: r._row
    };
  });
  var projectById = {};
  projects.forEach(function (p) { projectById[p.id.toUpperCase()] = p; });

  var actions = tActions.rows.map(function (r) {
    var open = isOpenAction_(r.status);
    return { id: r.id, projectId: r.projectId, title: r.title, owner: r.owner, due: dueInfo_(r.due, ctx, open), status: r.status, basis: r.basis,
      open: open, stBasis: classify_(r.basis), row: r._row };
  });

  var talks = tTalks.rows.map(function (r) {
    var st = classify_(r.status);
    var open = st !== 'confirmed' || !!r.due;
    return { id: r.id, projectId: r.projectId, contact: r.contact, org: r.org, fact: r.fact, factDate: parseDate_(r.factDate) ? parseDate_(r.factDate).label : norm_(r.factDate),
      factIso: parseDate_(r.factDate) ? parseDate_(r.factDate).iso : '', turn: r.turn, next: r.next, due: dueInfo_(r.due, ctx, open), status: r.status,
      st: st, stFact: r.fact ? (r.factDate ? 'confirmed' : 'check') : 'missing', source: src_(r.source), row: r._row };
  });

  var risks = tRisks.rows.map(function (r) {
    var open = isOpenRisk_(r.state);
    return { id: r.id, projectId: r.projectId, title: r.title, category: r.category, level: r.level, rank: levelRank_(r.level),
      probability: r.probability, impact: r.impact, basis: r.basis, action: r.action, owner: r.owner, due: dueInfo_(r.due, ctx, open),
      state: r.state, open: open, source: src_(r.source), row: r._row };
  });

  var decisions = tDecisions.rows.map(function (r) {
    var d = parseDate_(r.date);
    return { date: d ? d.label : r.date, iso: d ? d.iso : '', id: r.id, projectId: r.projectId, decision: r.decision, alternatives: r.alternatives,
      reason: r.reason, review: r.review, status: r.status, st: classify_(r.status), owner: r.owner, source: norm_(r.source), row: r._row };
  });

  var sources = tSources.rows.map(function (r) {
    var s = src_(r.url);
    return { projectId: r.projectId, type: r.type, doc: r.doc, url: s.url, urlText: s.url ? '' : s.text, status: r.status, st: classify_(r.status), row: r._row };
  });

  var sync = tSync.rows.map(function (r) {
    var d = parseDate_(r.date);
    return { date: d ? d.label : r.date, iso: d ? d.iso : '', type: r.type, source: r.source, check: r.check, result: r.result, changes: r.changes, note: r.note, st: classify_(r.result), row: r._row };
  });

  var inventory = tInv.rows.map(function (r) {
    return { group: r.group, found: r.found, canonical: src_(r.canonical), dup: r.dup, action: r.action, confidence: r.confidence, checked: r.checked, status: r.status, st: classify_(r.status), row: r._row };
  });

  // связи
  function byProject(list, key) { return list.filter(function (x) { return x[key] && projectById[x[key].toUpperCase()]; }); }
  projects.forEach(function (p) {
    var id = p.id.toUpperCase();
    function mine(list) { return list.filter(function (x) { return (x.projectId || '').toUpperCase() === id; }); }
    var a = mine(actions), t = mine(talks), r = mine(risks), d = mine(decisions), s = mine(sources);
    p.actionIds = a.map(function (x) { return x.id; });
    p.talkIds = t.map(function (x) { return x.id; });
    p.riskIds = r.map(function (x) { return x.id; });
    p.decisionIds = d.map(function (x) { return x.id; });
    p.openActions = a.filter(function (x) { return x.open; }).length;
    p.openRisks = r.filter(function (x) { return x.open; }).length;
    p.topRisk = r.filter(function (x) { return x.open; }).reduce(function (m, x) { return Math.max(m, x.rank); }, 0);
    // ответственные: только из реестров, без догадок
    var owners = [];
    a.concat(r).concat(d).forEach(function (x) { if (x.owner && owners.indexOf(x.owner) < 0) owners.push(x.owner); });
    p.owners = owners;
    // источники без повторов (по ссылке или тексту)
    var seen = {}, list = [];
    function addSource(label, url, text, kind, st) {
      var key = (url || text || '').toLowerCase();
      if (!key || seen[key]) return;
      seen[key] = 1;
      list.push({ label: label, url: url, text: url ? '' : text, kind: kind, st: st });
    }
    if (p.source.text) addSource('Источник проекта', p.source.url, p.source.text, p.source.kind, 'neutral');
    s.forEach(function (x) { addSource(x.doc || x.type, x.url, x.urlText, x.type, x.st); });
    t.forEach(function (x) { if (x.source.text) addSource('Переговоры ' + x.id + ' · ' + x.contact, x.source.url, x.source.text, x.source.kind, x.st); });
    p.sources = list;
    // история: только записи с привязкой к проекту; без даты — в конец
    var tl = [];
    t.forEach(function (x) { if (x.fact) tl.push({ iso: x.factIso, date: x.factDate, kind: 'Переговоры', text: x.contact + (x.org ? ' (' + x.org + ')' : '') + ': ' + x.fact, st: x.stFact }); });
    d.forEach(function (x) { tl.push({ iso: x.iso, date: x.date, kind: 'Решение', text: x.decision, st: x.st }); });
    tl.sort(function (a1, b1) { if (!a1.iso && !b1.iso) return 0; if (!a1.iso) return 1; if (!b1.iso) return -1; return a1.iso < b1.iso ? 1 : -1; });
    p.history = tl;
  });

  var portfolioDecisions = decisions.filter(function (d) { return !projectById[(d.projectId || '').toUpperCase()]; }).map(function (d) { return d.id; });
  var orphans = [];
  actions.concat(talks, risks, sources).forEach(function (x) {
    if (x.projectId && !projectById[x.projectId.toUpperCase()]) orphans.push((x.id || x.doc || '?') + ' → ' + x.projectId);
  });

  // показатели (считаем сами; сверяем с ручной панелью)
  var kpi = {
    projects: projects.length,
    p1: projects.filter(function (p) { return /^p1$/i.test(p.priority); }).length,
    actionsOpen: actions.filter(function (a) { return a.open; }).length,
    actionsNoDue: actions.filter(function (a) { return a.open && a.due.state === 'none'; }).length,
    actionsOverdue: actions.filter(function (a) { return a.due.state === 'overdue'; }).length,
    talks: talks.length,
    talksCheck: talks.filter(function (t) { return t.st === 'check'; }).length,
    risksOpen: risks.filter(function (r) { return r.open; }).length,
    risksHigh: risks.filter(function (r) { return r.open && r.rank === 3; }).length,
    decisions: decisions.length
  };
  var reconcileMap = [
    ['Активных проектов', kpi.projects], ['Приоритет P1', kpi.p1], ['Открытых действий', kpi.actionsOpen],
    ['Переговоров на проверке', kpi.talksCheck], ['Открытых контрольных рисков', kpi.risksOpen]
  ];
  var reconcile = [];
  reconcileMap.forEach(function (m) {
    var row = panelLookup_(panel.rows, m[0]);
    if (!row) return;
    reconcile.push({ label: m[0], sheet: row.value, computed: String(m[1]), match: row.value === String(m[1]) });
  });

  // актуальность
  var lastSync = null;
  sync.forEach(function (s) { if (s.iso && (!lastSync || s.iso > lastSync.iso)) lastSync = s; });
  var auditRow = panelFresh_(panel, 'Дата аудита');
  var automationRow = panelFresh_(panel, 'Автоматизация');
  var meta = {
    title: raw.title, readAt: ctx.nowIso, readAtLabel: ctx.nowLabel, today: ctx.todayIso, staleDays: ctx.staleDays,
    tabs: [
      tabReport_('Панель руководителя', { found: panel.found, rows: panel.rows, missing: [] }),
      tabReport_('Проекты', tProjects), tabReport_('Действия', tActions), tabReport_('Контроль переговоров', tTalks),
      tabReport_('Риски', tRisks), tabReport_('Журнал решений', tDecisions), tabReport_('Источники', tSources),
      tabReport_('Журнал синхронизации', tSync), tabReport_('Инвентаризация источников', tInv)
    ],
    lastSync: lastSync ? { date: lastSync.date, iso: lastSync.iso, type: lastSync.type, result: lastSync.result,
      ageDays: Math.max(0, dayDiff_(ctx.todayIso, lastSync.iso)), stale: dayDiff_(ctx.todayIso, lastSync.iso) > ctx.staleDays } : null,
    auditDate: auditRow ? auditRow.state : '',
    automation: automationRow ? { text: automationRow.state, st: automationRow.st } : null,
    duplicates: { projects: dupIds_(projects, 'id'), actions: dupIds_(actions, 'id'), talks: dupIds_(talks, 'id'), risks: dupIds_(risks, 'id'), decisions: dupIds_(decisions, 'id') },
    orphans: orphans,
    portfolioDecisions: portfolioDecisions,
    warnings: []
  };
  meta.tabs.forEach(function (t) {
    if (!t.ok) meta.warnings.push('Вкладка «' + t.name + '» не найдена.');
    else if (t.missingColumns.length) meta.warnings.push('Во вкладке «' + t.name + '» нет столбцов: ' + t.missingColumns.join(', ') + '.');
  });
  Object.keys(meta.duplicates).forEach(function (k) { if (meta.duplicates[k].length) meta.warnings.push('Повторяющиеся ID (' + k + '): ' + meta.duplicates[k].join(', ') + '.'); });
  reconcile.forEach(function (r) { if (!r.match) meta.warnings.push('Ручная панель: «' + r.label + '» = ' + r.sheet + ', по реестрам = ' + r.computed + '.'); });
  if (orphans.length) meta.warnings.push('Записи ссылаются на неизвестный проект: ' + orphans.join('; ') + '.');

  var hasPeriodic = !!meta.lastSync;
  var attention = buildAttention_(projects, actions, talks, risks, reconcile, meta);

  return {
    contour: 'corporate', meta: meta, kpi: kpi, reconcile: reconcile, attention: attention,
    projects: projects, actions: actions, talks: talks, risks: risks, decisions: decisions,
    sources: sources, sync: sync, inventory: inventory,
    panel: { rows: panel.rows, fresh: panel.fresh },
    optional: { riskProbability: !!tRisks.has.probability, riskImpact: !!tRisks.has.impact }
  };
}

function panelFresh_(panel, label) {
  for (var i = 0; i < panel.fresh.length; i++) if (panel.fresh[i].label.toLowerCase() === label.toLowerCase()) return panel.fresh[i];
  return null;
}

function buildAttention_(projects, actions, talks, risks, reconcile, meta) {
  var out = [];
  risks.forEach(function (r) {
    if (r.open && r.rank === 3) out.push({ level: 3, kind: 'Риск · высокий', title: r.title, detail: r.basis, ref: { type: 'risk', id: r.id }, projectId: r.projectId });
  });
  actions.forEach(function (a) {
    if (a.due.state === 'overdue') out.push({ level: 3, kind: 'Просрочено', title: a.title, detail: 'Срок ' + a.due.label + ' (' + a.due.days + ' дн. назад)', ref: { type: 'action', id: a.id }, projectId: a.projectId });
  });
  talks.forEach(function (t) {
    if (t.due.state === 'overdue') out.push({ level: 3, kind: 'Контакт просрочен', title: t.contact + ' · ' + t.org, detail: 'Срок ' + t.due.label, ref: { type: 'talk', id: t.id }, projectId: t.projectId });
    else if (t.st === 'check') out.push({ level: 2, kind: 'Переговоры · проверка', title: t.contact + (t.org ? ' · ' + t.org : ''), detail: t.status, ref: { type: 'talk', id: t.id }, projectId: t.projectId });
  });
  projects.forEach(function (p) {
    if (p.stState === 'check') out.push({ level: 1, kind: 'Проект · сверка', title: p.name, detail: p.state + (p.checked ? ' · проверено: ' + p.checked : ''), ref: { type: 'project', id: p.id }, projectId: p.id });
  });
  if (meta.lastSync && meta.lastSync.stale) out.push({ level: 2, kind: 'Данные', title: 'Журнал синхронизации не обновлялся ' + meta.lastSync.ageDays + ' дн.', detail: 'Последняя запись: ' + meta.lastSync.date, ref: { type: 'data' } });
  if (!meta.lastSync) out.push({ level: 2, kind: 'Данные', title: 'В журнале синхронизации нет датированных записей', detail: 'Актуальность нельзя оценить', ref: { type: 'data' } });
  reconcile.forEach(function (r) { if (!r.match) out.push({ level: 2, kind: 'Данные', title: 'Ручная панель расходится с реестрами: ' + r.label, detail: 'Панель: ' + r.sheet + ' · по реестрам: ' + r.computed, ref: { type: 'data' } }); });
  out.sort(function (a, b) { return b.level - a.level; });
  return out;
}

/* ───────────── Личный контур ───────────── */

var PCOLS_ = {
  projects: { id: ['ID'], name: ['Проект'], state: ['Состояние', 'Статус'], next: ['Следующее действие'], folder: ['Папка', 'Источник'] },
  actions: { id: ['ID'], projectId: ['Проект ID'], title: ['Действие'], due: ['Срок'], status: ['Статус'] },
  decisions: { date: ['Дата'], project: ['Проект'], decision: ['Решение'], status: ['Статус'] },
  capital: { id: ['ID'], asset: ['Возможность / актив'], shareType: ['Тип доли'], stage: ['Стадия'], amount: ['Размер инвестиций'], capitalSource: ['Источник капитала'],
    share: ['Потенциальная доля'], basis: ['Основание права на долю'], conflict: ['Конфликт интересов'], next: ['Следующее действие'], check: ['Статус проверки'], source: ['Источник'] }
};

function buildPersonal_(raw, ctx) {
  var T = raw.tabs;
  var tP = table_(T['Проекты'], PCOLS_.projects);
  var tA = table_(T['Действия'], PCOLS_.actions);
  var tD = table_(T['Решения'], PCOLS_.decisions);
  var tC = table_(T['Капитал и доли'], PCOLS_.capital);
  var panel = parsePanel_(T['Личная панель']);

  var actions = tA.rows.map(function (r) {
    var open = isOpenAction_(r.status);
    return { id: r.id, projectId: r.projectId, title: r.title, due: dueInfo_(r.due, ctx, open), status: r.status, open: open };
  });
  var decisions = tD.rows.map(function (r) {
    var d = parseDate_(r.date);
    return { date: d ? d.label : r.date, iso: d ? d.iso : '', project: r.project, decision: r.decision, status: r.status, st: classify_(r.status) };
  });
  var projects = tP.rows.map(function (r) {
    var id = r.id.toUpperCase();
    return { id: r.id, name: r.name, state: r.state, next: r.next, folder: src_(r.folder), stState: classify_(r.state),
      actions: actions.filter(function (a) { return (a.projectId || '').toUpperCase() === id; }),
      decisions: decisions.filter(function (d) { return (d.project || '').toUpperCase() === id; }) };
  });

  var capitalFields = [['amount', 'размер инвестиций'], ['capitalSource', 'источник капитала'], ['share', 'потенциальная доля'], ['shareType', 'тип доли'], ['basis', 'основание права на долю']];
  var gaps = [];
  var capital = tC.rows.map(function (r) {
    var missing = [];
    capitalFields.forEach(function (f) { if (isMissingText_(r[f[0]])) { missing.push(f[1]); gaps.push(r.id + ': ' + f[1] + ' — нет данных'); } });
    return { id: r.id, asset: r.asset, shareType: r.shareType, stage: r.stage, amount: r.amount, capitalSource: r.capitalSource, share: r.share, basis: r.basis,
      conflict: r.conflict, conflictSt: classify_(r.conflict), next: r.next, check: r.check, checkSt: classify_(r.check), source: r.source, missing: missing };
  });

  function pv(label) { var row = panelLookup_(panel.rows, label); return row ? { value: row.value, note: row.note, st: isMissingText_(row.value) || /^неизвестен/i.test(row.value) ? 'missing' : classify_(row.value) } : null; }
  var summary = {
    goal: pv('Цель'), capital: pv('Инвестиционный капитал'), deals: pv('Подтверждённых сделок'), projectsActive: pv('Активных личных проектов'),
    next: pv('Следующий шаг'), rule: pv('Правило')
  };
  if (summary.capital && /^неизвестен/i.test(summary.capital.value)) summary.capital.st = 'missing';

  var conflicts = {
    unresolved: capital.filter(function (c) { return c.conflictSt !== 'confirmed' && c.conflictSt !== 'neutral'; }).length,
    total: capital.length
  };

  var tabs = [tabReport_('Проекты', tP), tabReport_('Действия', tA), tabReport_('Решения', tD), tabReport_('Капитал и доли', tC),
    tabReport_('Личная панель', { found: panel.found, rows: panel.rows, missing: [] })];
  var warnings = [];
  tabs.forEach(function (t) {
    if (!t.ok) warnings.push('Вкладка «' + t.name + '» не найдена.');
    else if (t.missingColumns.length) warnings.push('Во вкладке «' + t.name + '» нет столбцов: ' + t.missingColumns.join(', ') + '.');
  });

  return {
    contour: 'personal',
    meta: { title: raw.title, readAt: ctx.nowIso, readAtLabel: ctx.nowLabel, today: ctx.todayIso, tabs: tabs, warnings: warnings },
    summary: summary, projects: projects, actions: actions, decisions: decisions, capital: capital, gaps: gaps, conflicts: conflicts,
    panel: { rows: panel.rows }
  };
}
