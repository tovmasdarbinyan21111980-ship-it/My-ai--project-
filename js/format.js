/* Форматирование чисел в русской локали. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.HPD = root.HPD || {}).fmt = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CURRENCY = '₽';
  const NBSP = ' ';
  const MINUS = '−';
  const cache = {};

  function nf(n, d) {
    const nfmt = cache[d] || (cache[d] = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d }));
    return nfmt.format(n).replace('-', MINUS);
  }

  const pct = (v, d = 1) => (v == null ? '—' : nf(v * 100, d) + NBSP + '%');

  /** big — сокращать до «млн» и «млрд». */
  function money(v, big) {
    if (v == null) return '—';
    const a = Math.abs(v);
    if (big && a >= 1e9) return nf(v / 1e9, 2) + NBSP + 'млрд' + NBSP + CURRENCY;
    if (big && a >= 1e6) return nf(v / 1e6, 1) + NBSP + 'млн' + NBSP + CURRENCY;
    return nf(v, 0) + NBSP + CURRENCY;
  }

  function axisMoney(v) {
    const a = Math.abs(v);
    if (a >= 1e9) return nf(v / 1e9, a % 1e9 ? 1 : 0) + NBSP + 'млрд';
    if (a >= 1e6) return nf(v / 1e6, a % 1e6 ? 1 : 0) + NBSP + 'млн';
    if (a >= 1e3) return nf(v / 1e3, a % 1e3 ? 1 : 0) + NBSP + 'тыс.';
    return nf(v, 0);
  }

  const axisPct = (v) => nf(v * 100, 0) + NBSP + '%';

  /** Разница с явным знаком. kind: 'pct' — п.п., иначе проценты. Возвращает { text, dir: 1|-1|0 } или null. */
  function delta(d, kind) {
    if (d == null) return null;
    const r = Math.round(d * 10) / 10;
    const unit = kind === 'pct' ? NBSP + 'п.п.' : NBSP + '%';
    if (r === 0) return { text: '0,0' + unit, dir: 0 };
    return { text: (r > 0 ? '+' : MINUS) + nf(Math.abs(r), 1) + unit, dir: r > 0 ? 1 : -1 };
  }

  const axisDelta = (kind) => (v) => (v > 0 ? '+' : v < 0 ? MINUS : '') + nf(Math.abs(v), 0) + (kind === 'pct' ? '' : NBSP + '%');

  /** Форматтеры для показателя из calc.METRICS. */
  function forMetric(m, big) {
    if (m.kind === 'pct') return { value: (v) => pct(v), axis: axisPct };
    return { value: (v) => money(v, big === undefined ? m.big : big), axis: axisMoney };
  }

  return { CURRENCY, nf, pct, money, axisMoney, axisPct, delta, axisDelta, forMetric };
});
