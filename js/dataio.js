/* Перевод строк Excel в набор данных (с проверками) и обратно. Формат — «длинная» таблица:
 * одна строка = год + месяц + сценарий (Факт / Бюджет / Прошлый год) и пять числовых колонок. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.HPD = root.HPD || {}).dataio = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HEADERS = ['Год', 'Месяц', 'Сценарий', 'Доступно номеро-ночей', 'Продано номеро-ночей', 'Выручка от номеров', 'Общая выручка', 'Операционные расходы'];
  const FIELDS = ['year', 'month', 'scenario', 'avail', 'sold', 'roomRev', 'totalRev', 'opex'];
  const NUMERIC = ['avail', 'sold', 'roomRev', 'totalRev', 'opex'];

  const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');

  const ALIASES = {
    year: ['год', 'year'],
    month: ['месяц', 'мес', 'month'],
    scenario: ['сценарий', 'версия', 'scenario'],
    avail: ['доступнономероночей', 'доступныеномероночи', 'availableroomnights', 'roomsavailable'],
    sold: ['проданономероночей', 'проданныеномероночи', 'soldroomnights', 'roomssold'],
    roomRev: ['выручкаотномеров', 'выручкаотномерногофонда', 'roomrevenue'],
    totalRev: ['общаявыручка', 'выручкаобщая', 'totalrevenue'],
    opex: ['операционныерасходы', 'операционныезатраты', 'operatingexpenses', 'opex'],
  };

  const SCENARIO_ALIASES = {
    fact: ['факт', 'fact', 'actual'],
    budget: ['бюджет', 'budget', 'план'],
    py: ['прошлыйгод', 'пг', 'py', 'ly', 'lastyear', 'prioryear'],
  };

  const MONTH_PREFIX = ['янв', 'фев', 'мар', 'апр', 'ма', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const MONTH_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function parseNumber(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    if (typeof v !== 'string') return NaN;
    const s = v.replace(/[\s ]/g, '').replace(',', '.');
    return s === '' ? NaN : Number(s);
  }

  function parseMonth(v) {
    const n = parseNumber(v);
    if (Number.isInteger(n)) return n >= 1 && n <= 12 ? n : null;
    const s = norm(v);
    for (let i = 0; i < 12; i++) if ((s.startsWith(MONTH_PREFIX[i]) && s.length >= 3) || s.startsWith(MONTH_EN[i])) return i + 1;
    if (s === 'май' || s === 'мая') return 5;
    return null;
  }

  function parseScenario(v) {
    const s = norm(v);
    for (const k in SCENARIO_ALIASES) if (SCENARIO_ALIASES[k].includes(s)) return k;
    return null;
  }

  const isEmptyRow = (r) => !r || r.every((c) => c === '' || c == null);

  /** rows — массив строк листа. Возвращает { ok:true, dataset, count } или { ok:false, errors:[...] }. */
  function fromRows(rows) {
    // шапка — первая строка среди первых 15, где узнаны хотя бы 3 заголовка
    let headerAt = -1;
    let colOf = {};
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const found = {};
      (rows[i] || []).forEach((cell, c) => {
        const n = norm(cell);
        for (const f in ALIASES) if (ALIASES[f].includes(n) && !(f in found)) found[f] = c;
      });
      if (Object.keys(found).length >= 3) { headerAt = i; colOf = found; break; }
    }
    if (headerAt < 0) return { ok: false, errors: ['Не найдена строка заголовков. Ожидаются колонки: ' + HEADERS.join(', ') + '. Скачайте пример файла.'] };
    const missing = FIELDS.filter((f) => !(f in colOf));
    if (missing.length) return { ok: false, errors: ['Не хватает колонок: ' + missing.map((f) => HEADERS[FIELDS.indexOf(f)]).join(', ') + '.'] };

    const errors = [];
    const years = {};
    const seen = new Set();
    let count = 0;
    for (let i = headerAt + 1; i < rows.length; i++) {
      const row = rows[i];
      if (isEmptyRow(row)) continue;
      const line = i + 1;
      const get = (f) => row[colOf[f]];
      const problems = [];
      const year = parseNumber(get('year'));
      if (!Number.isInteger(year) || year < 2000 || year > 2100) problems.push('год должен быть числом от 2000 до 2100');
      const month = parseMonth(get('month'));
      if (!month) problems.push('месяц должен быть числом 1–12 или названием');
      const scenario = parseScenario(get('scenario'));
      if (!scenario) problems.push('сценарий должен быть «Факт», «Бюджет» или «Прошлый год»');
      const t = {};
      for (const f of NUMERIC) {
        const n = parseNumber(get(f));
        if (!Number.isFinite(n) || n < 0) problems.push('«' + HEADERS[FIELDS.indexOf(f)] + '» — нужно неотрицательное число');
        else t[f] = n;
      }
      if (!problems.length) {
        if (t.avail === 0) problems.push('доступных номеро-ночей не может быть 0');
        if (t.sold > t.avail) problems.push('продано больше, чем доступно');
        if (t.roomRev > t.totalRev) problems.push('выручка от номеров больше общей выручки');
        const key = year + '/' + month + '/' + scenario;
        if (seen.has(key)) problems.push('повтор: этот год, месяц и сценарий уже есть выше');
        seen.add(key);
      }
      if (problems.length) { errors.push('Строка ' + line + ': ' + problems.join('; ') + '.'); continue; }
      if (!years[year]) years[year] = { months: Array.from({ length: 12 }, () => ({ fact: null, budget: null, py: null })) };
      years[year].months[month - 1][scenario] = t;
      count++;
    }
    if (errors.length) return { ok: false, errors };
    if (!count) return { ok: false, errors: ['В файле нет строк с данными под заголовками.'] };
    const hasMain = Object.values(years).some((y) => y.months.some((m) => m.fact || m.budget));
    if (!hasMain) return { ok: false, errors: ['Нужна хотя бы одна строка со сценарием «Факт» или «Бюджет».'] };
    return { ok: true, dataset: { years }, count };
  }

  const SCENARIO_LABEL = { fact: 'Факт', budget: 'Бюджет', py: 'Прошлый год' };

  /** Набор данных → строки для листа «Данные» (с заголовками). */
  function toRows(dataset) {
    const out = [HEADERS.slice()];
    for (const year of Object.keys(dataset.years).sort()) {
      for (const scenario of ['fact', 'budget', 'py']) {
        dataset.years[year].months.forEach((m, i) => {
          const t = m[scenario];
          if (t) out.push([Number(year), i + 1, SCENARIO_LABEL[scenario], t.avail, t.sold, t.roomRev, t.totalRev, t.opex]);
        });
      }
    }
    return out;
  }

  const INSTRUCTION_ROWS = [
    ['Как заполнить лист «Данные»'],
    ['Одна строка = один месяц одного сценария.'],
    ['Год — например, 2026.'],
    ['Месяц — число от 1 до 12 или название (Январь, Фев, …).'],
    ['Сценарий — «Факт», «Бюджет» или «Прошлый год». «Прошлый год» относится к тому же отчётному году: это данные того же месяца годом ранее.'],
    ['Доступно номеро-ночей — число номеров в продаже × число дней месяца.'],
    ['Продано номеро-ночей — сколько номеро-ночей реально продано (не больше доступных).'],
    ['Выручка от номеров — выручка от проживания, без питания и услуг.'],
    ['Общая выручка — вся выручка отеля, включая выручку от номеров.'],
    ['Операционные расходы — расходы, из которых считается операционная прибыль: общая выручка минус эти расходы.'],
    ['Суммы — в одной валюте, числами, без символов валюты. Пустой месяц факта (ещё не закрыт) просто не добавляйте.'],
    ['Пример файла заполнен вымышленными демонстрационными данными.'],
  ];

  return { HEADERS, fromRows, toRows, parseNumber, parseMonth, parseScenario, INSTRUCTION_ROWS };
});
