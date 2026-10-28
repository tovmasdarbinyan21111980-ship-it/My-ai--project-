/* Расчёт показателей. Без зависимостей, работает и в браузере, и в Node (для тестов). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.HPD = root.HPD || {}).calc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MONTHS_SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
  const MONTHS_FULL = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  // kind: 'pct' — доля, разница в процентных пунктах; 'money' — деньги, разница в процентах
  const METRICS = [
    { key: 'occupancy', label: 'Загрузка', short: 'Загрузка', kind: 'pct', money: false },
    { key: 'adr', label: 'Средняя цена номера', short: 'Средняя цена', kind: 'rel', money: true },
    { key: 'revpar', label: 'Выручка на доступный номер', short: 'На доступный номер', kind: 'rel', money: true },
    { key: 'revenue', label: 'Общая выручка', short: 'Общая выручка', kind: 'rel', money: true, big: true },
    { key: 'gop', label: 'Операционная прибыль', short: 'Операционная прибыль', kind: 'rel', money: true, big: true },
  ];

  const SCENARIOS = ['fact', 'budget', 'py'];

  function sumTotals(list) {
    const t = { avail: 0, sold: 0, roomRev: 0, totalRev: 0, opex: 0 };
    for (const x of list) for (const k in t) t[k] += x[k];
    return t;
  }

  function metrics(t) {
    if (!t) return null;
    const profit = t.totalRev - t.opex;
    return {
      occupancy: t.avail > 0 ? t.sold / t.avail : null,
      adr: t.sold > 0 ? t.roomRev / t.sold : null,
      revpar: t.avail > 0 ? t.roomRev / t.avail : null,
      revenue: t.totalRev,
      gop: profit,
      margin: t.totalRev > 0 ? profit / t.totalRev : null,
    };
  }

  /** Суммирует сценарий по списку месяцев (1..12). Если хоть в одном месяце данных нет — null,
   *  чтобы не сравнивать неполный период с полным. */
  function aggregate(yearData, months, scenario) {
    if (!yearData || !months.length) return null;
    const parts = [];
    for (const m of months) {
      const x = yearData.months[m - 1] && yearData.months[m - 1][scenario];
      if (!x) return null;
      parts.push(x);
    }
    return sumTotals(parts);
  }

  /** Месяцы выбранного периода, по которым есть факт. */
  function periodMonths(yearData, mode, endMonth) {
    const range = mode === 'month' ? [endMonth] : Array.from({ length: endMonth }, (_, i) => i + 1);
    return range.filter((m) => yearData.months[m - 1] && yearData.months[m - 1].fact);
  }

  function lastFactMonth(yearData) {
    for (let m = 12; m >= 1; m--) if (yearData.months[m - 1].fact) return m;
    return 0;
  }

  /** Разница: для долей — в процентных пунктах, для остальных — в процентах от базы. */
  function delta(actual, base, kind) {
    if (actual == null || base == null) return null;
    if (kind === 'pct') return (actual - base) * 100;
    if (base === 0) return null;
    return ((actual - base) / Math.abs(base)) * 100;
  }

  function monthMetric(yearData, month, scenario, key) {
    const t = yearData.months[month - 1][scenario];
    const m = metrics(t);
    return m ? m[key] : null;
  }

  return { MONTHS_SHORT, MONTHS_FULL, MONTHS_GEN, METRICS, SCENARIOS, sumTotals, metrics, aggregate, periodMonths, lastFactMonth, delta, monthMetric };
});
