/* Интерфейс Hotel Performance Dashboard. */
(function () {
  'use strict';
  const { calc, fmt, demo, xlsx, dataio, charts } = window.HPD;
  const STORE_KEY = 'hpd.dataset.v1';
  const KPI_KEYS = ['occupancy', 'adr', 'revpar', 'gop'];
  const SCEN_LABEL = { fact: 'Факт', budget: 'Бюджет', py: 'Прошлый год' };
  const SCEN_CLASS = { fact: 's-fact', budget: 's-budget', py: 's-py' };
  const METRIC = Object.fromEntries(calc.METRICS.map((m) => [m.key, m]));

  const $ = (id) => document.getElementById(id);

  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const k in props || {}) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      e.append(kid.nodeType ? kid : document.createTextNode(kid));
    }
    return e;
  }

  /* ---------- состояние ---------- */

  const state = { dataset: null, sourceName: null, year: null, mode: 'ytd', month: 1, metric: 'occupancy', hidden: new Set() };

  function save(name, dataset) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ name, dataset })); } catch (e) { /* хранилище недоступно — работаем без него */ }
  }
  function loadSaved() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const { name, dataset } = JSON.parse(raw);
      const check = dataio.fromRows(dataio.toRows(dataset));
      return check.ok ? { name, dataset: check.dataset } : null;
    } catch (e) { return null; }
  }
  function clearSaved() { try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ } }

  function setDataset(dataset, sourceName) {
    state.dataset = dataset;
    state.sourceName = sourceName;
    const years = Object.keys(dataset.years).map(Number).sort((a, b) => a - b);
    const withFact = years.filter((y) => calc.lastFactMonth(dataset.years[y]) > 0);
    state.year = (withFact.length ? withFact : years).pop();
    state.month = calc.lastFactMonth(dataset.years[state.year]) || 12;
  }

  const yearData = () => state.dataset.years[state.year];

  /* ---------- расчёт для периода ---------- */

  function periodInfo() {
    const y = yearData();
    const months = calc.periodMonths(y, state.mode, state.month);
    const get = (s) => calc.metrics(calc.aggregate(y, months, s));
    return { months, totals: Object.fromEntries(calc.SCENARIOS.map((s) => [s, calc.aggregate(y, months, s)])), m: { fact: get('fact'), budget: get('budget'), py: get('py') } };
  }

  function periodLabel() {
    const name = calc.MONTHS_FULL[state.month - 1];
    return state.mode === 'month' || state.month === 1 ? name + ' ' + state.year : 'Январь–' + name + ' ' + state.year;
  }

  /* ---------- отрисовка ---------- */

  function deltaNode(d, kind) {
    const f = fmt.delta(d, kind);
    if (!f) return h('span', { class: 'd none' }, 'нет данных');
    const cls = f.dir > 0 ? 'pos' : f.dir < 0 ? 'neg' : 'zero';
    return h('span', { class: 'd ' + cls }, f.dir ? h('span', { class: 'arr', 'aria-hidden': 'true' }, f.dir > 0 ? '▲' : '▼') : null, f.text);
  }

  function renderControls() {
    document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
    const sel = $('monthSel');
    sel.textContent = '';
    const y = yearData();
    calc.MONTHS_FULL.forEach((name, i) => {
      const o = h('option', { value: i + 1 }, name + (y.months[i].fact ? '' : ' (нет факта)'));
      if (i + 1 === state.month) o.selected = true;
      sel.append(o);
    });
    const years = Object.keys(state.dataset.years).sort();
    $('yearWrap').hidden = years.length < 2;
    const ys = $('yearSel');
    ys.textContent = '';
    years.forEach((yr) => { const o = h('option', { value: yr }, yr); if (Number(yr) === state.year) o.selected = true; ys.append(o); });
  }

  function renderHeader() {
    $('periodLine').textContent = 'Период: ' + periodLabel();
    const src = $('source');
    src.textContent = '';
    if (state.sourceName) src.append(h('span', { class: 'badge' }, 'Ваши данные'), 'Файл: ' + state.sourceName);
    else src.append(h('span', { class: 'badge' }, 'Демонстрация'), 'Вымышленные данные для примера. Загрузите свой файл Excel, чтобы увидеть реальные показатели.');
    $('resetDemo').hidden = !state.sourceName;
  }

  function renderKpis() {
    const p = periodInfo();
    const box = $('kpis');
    box.textContent = '';
    const have = p.m.fact;
    for (const key of KPI_KEYS) {
      const m = METRIC[key];
      const f = fmt.forMetric(m);
      const val = have ? have[key] : null;
      let sub = '';
      if (have && key === 'occupancy') sub = fmt.nf(p.totals.fact.sold, 0) + ' из ' + fmt.nf(p.totals.fact.avail, 0) + ' номеро-ночей';
      if (have && key === 'gop') sub = 'Маржа ' + fmt.pct(have.margin);
      const dB = have && p.m.budget ? calc.delta(val, p.m.budget[key], m.kind) : null;
      const dP = have && p.m.py ? calc.delta(val, p.m.py[key], m.kind) : null;
      box.append(h('article', { class: 'kpi' },
        h('div', { class: 'kpi-label' }, m.label, key === 'revpar' ? [' ', h('small', null, 'RevPAR')] : null),
        h('div', { class: 'kpi-value' }, have ? f.value(val) : '—'),
        h('div', { class: 'kpi-sub' }, have ? sub : 'нет факта за период'),
        h('div', { class: 'cmp' },
          h('div', { class: 'cmp-row' }, h('span', null, 'К бюджету'), deltaNode(dB, m.kind)),
          h('div', { class: 'cmp-row' }, h('span', null, h('span', { class: 'long' }, 'К прошлому году'), h('span', { class: 'short' }, 'К прош. году')), deltaNode(dP, m.kind)))));
    }
  }

  function monthSeries(key, scen) {
    const y = yearData();
    return y.months.map((_, i) => calc.monthMetric(y, i + 1, scen, key));
  }

  function renderTabs() {
    const box = $('metricTabs');
    box.textContent = '';
    for (const m of calc.METRICS) {
      box.append(h('button', { type: 'button', 'aria-pressed': String(m.key === state.metric), onclick: () => { state.metric = m.key; renderMetricViews(); } }, m.short));
    }
    const lg = $('legend');
    lg.textContent = '';
    for (const s of calc.SCENARIOS) {
      lg.append(h('button', { type: 'button', 'aria-pressed': String(!state.hidden.has(s)), onclick: () => { state.hidden.has(s) ? state.hidden.delete(s) : state.hidden.add(s); renderMetricViews(); } },
        h('i', { class: 'sw ' + SCEN_CLASS[s] }), SCEN_LABEL[s]));
    }
  }

  function renderTrend() {
    const m = METRIC[state.metric];
    const f = fmt.forMetric(m);
    const y = yearData();
    const series = calc.SCENARIOS.filter((s) => !state.hidden.has(s)).map((s) => ({ id: s, label: SCEN_LABEL[s], cls: SCEN_CLASS[s], values: monthSeries(m.key, s) }));
    charts.line($('trendChart'), {
      categories: calc.MONTHS_SHORT,
      series,
      axisFmt: f.axis,
      zero: m.key === 'gop' || m.key === 'revenue',
      label: m.label + ' по месяцам, ' + state.year + ': факт, бюджет и прошлый год',
      tip: (i) => {
        const rows = series.map((s) => ({ cls: s.cls, label: s.label, value: s.values[i] == null ? '—' : f.value(s.values[i]) }));
        const fact = monthSeries(m.key, 'fact')[i];
        for (const [scen, label] of [['budget', 'к бюджету'], ['py', 'к прошлому году']]) {
          const d = fmt.delta(calc.delta(fact, monthSeries(m.key, scen)[i], m.kind), m.kind);
          if (d) rows.push({ cls: 'none', label: 'Факт ' + label, value: d.text, tone: d.dir > 0 ? 'pos' : d.dir < 0 ? 'neg' : '' });
        }
        return { title: calc.MONTHS_FULL[i] + ' ' + state.year, rows };
      },
    });
    $('trendTitle').textContent = 'Динамика по месяцам: ' + m.label.toLowerCase();
    void y;
  }

  function renderDeviation() {
    const m = METRIC[state.metric];
    const fact = monthSeries(m.key, 'fact');
    const dev = (scen) => monthSeries(m.key, scen).map((b, i) => calc.delta(fact[i], b, m.kind));
    const unit = m.kind === 'pct' ? 'п.п.' : '%';
    const series = [{ id: 'budget', label: 'К бюджету', cls: 'b-budget', values: dev('budget') }, { id: 'py', label: 'К прошлому году', cls: 'b-py', values: dev('py') }];
    $('devHint').textContent = m.label + ', отклонение факта в ' + (m.kind === 'pct' ? 'процентных пунктах' : 'процентах');
    charts.bars($('devChart'), {
      categories: calc.MONTHS_SHORT,
      series,
      axisFmt: fmt.axisDelta(m.kind),
      label: 'Отклонение факта (' + m.label.toLowerCase() + ') от бюджета и от прошлого года по месяцам, ' + unit,
      tip: (i) => ({
        title: calc.MONTHS_FULL[i] + ' ' + state.year,
        rows: series.map((s) => {
          const d = fmt.delta(s.values[i], m.kind);
          return { cls: s.cls, label: s.label, value: d ? d.text : '—', tone: d ? (d.dir > 0 ? 'pos' : d.dir < 0 ? 'neg' : '') : '' };
        }),
      }),
    });
  }

  function renderTable() {
    const m = METRIC[state.metric];
    const f = fmt.forMetric(m, true);
    const y = yearData();
    const p = periodInfo();
    const cell = (v) => (v == null ? h('td', { class: 'na' }, '—') : h('td', null, f.value(v)));
    const dcell = (a, b) => h('td', null, deltaNode(calc.delta(a, b, m.kind), m.kind));
    const rowFor = (label, fv, bv, pv, cls) => h('tr', { class: cls }, h('td', null, label), cell(fv), cell(bv), dcell(fv, bv), cell(pv), dcell(fv, pv));
    const rows = y.months.map((_, i) => {
      const g = (s) => calc.monthMetric(y, i + 1, s, m.key);
      return rowFor(calc.MONTHS_FULL[i], g('fact'), g('budget'), g('py'), p.months.includes(i + 1) ? 'in-period' : '');
    });
    const t = (s) => (p.m[s] ? p.m[s][m.key] : null);
    rows.push(rowFor('Период: ' + periodLabel(), t('fact'), t('budget'), t('py'), 'total'));
    $('tableWrap').replaceChildren(h('table', null,
      h('caption', { class: 'sr' }, m.label + ' по месяцам'),
      h('thead', null, h('tr', null, ['Месяц', 'Факт', 'Бюджет', 'К бюджету', 'Прошлый год', 'К прошлому году'].map((x) => h('th', { scope: 'col' }, x)))),
      h('tbody', null, rows)));
  }

  function renderMetricViews() {
    renderTabs();
    renderTrend();
    renderDeviation();
    renderTable();
  }

  function renderAll() {
    renderControls();
    renderHeader();
    renderKpis();
    renderMetricViews();
  }

  /* ---------- события ---------- */

  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { state.mode = b.dataset.mode; renderAll(); }));
  $('monthSel').addEventListener('change', (e) => { state.month = Number(e.target.value); renderAll(); });
  $('yearSel').addEventListener('change', (e) => {
    state.year = Number(e.target.value);
    state.month = calc.lastFactMonth(yearData()) || 12;
    renderAll();
  });

  let resizeTimer;
  new ResizeObserver(() => {
    cancelAnimationFrame(resizeTimer);
    resizeTimer = requestAnimationFrame(() => { renderTrend(); renderDeviation(); });
  }).observe($('trendChart'));

  /* ---------- загрузка Excel ---------- */

  const dlg = $('importDlg');
  $('colsList').textContent = dataio.HEADERS.join(' · ');

  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { t.hidden = true; }, 4500);
  }

  function showErrors(list) {
    const box = $('importErrors');
    box.textContent = '';
    if (!list || !list.length) { box.hidden = true; return; }
    const shown = list.slice(0, 8);
    box.append(h('b', null, 'Файл не загружен. Исправьте и попробуйте снова:'), h('ul', null, shown.map((e) => h('li', null, e)), list.length > shown.length ? h('li', null, 'и ещё ' + (list.length - shown.length) + '…') : null));
    box.hidden = false;
  }

  async function handleFile(file) {
    showErrors(null);
    if (!file) return;
    if (/\.xls$/i.test(file.name)) return showErrors(['Старый формат .xls не поддерживается. Откройте файл в Excel и сохраните как «Книга Excel (.xlsx)».']);
    if (!/\.xls[xm]$/i.test(file.name)) return showErrors(['Нужен файл Excel в формате .xlsx.']);
    if (file.size > 10 * 1024 * 1024) return showErrors(['Файл больше 10 МБ.']);
    try {
      const { rows } = await xlsx.readXlsx(await file.arrayBuffer(), ['Данные', 'Data']);
      const res = dataio.fromRows(rows);
      if (!res.ok) return showErrors(res.errors);
      setDataset(res.dataset, file.name);
      save(file.name, res.dataset);
      dlg.close();
      renderAll();
      toast('Загружено строк: ' + res.count);
    } catch (e) {
      showErrors([e && e.message ? e.message : 'Не удалось прочитать файл.']);
    }
  }

  $('openImport').addEventListener('click', () => { showErrors(null); dlg.showModal(); });
  $('fileInput').addEventListener('change', (e) => { handleFile(e.target.files[0]); e.target.value = ''; });
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  $('downloadExample').addEventListener('click', () => {
    const bytes = xlsx.writeXlsx([
      { name: 'Данные', rows: dataio.toRows(demo.build()), widths: [8, 8, 14, 24, 22, 20, 16, 22], header: true },
      { name: 'Инструкция', rows: dataio.INSTRUCTION_ROWS, widths: [120] },
    ]);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = h('a', { href: url, download: 'hotel-performance-example.xlsx' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });

  $('resetDemo').addEventListener('click', () => {
    clearSaved();
    setDataset(demo.build(), null);
    dlg.close();
    renderAll();
    toast('Показаны демонстрационные данные');
  });

  /* ---------- запуск ---------- */

  const saved = loadSaved();
  if (saved) setDataset(saved.dataset, saved.name);
  else setDataset(demo.build(), null);
  renderAll();
})();
