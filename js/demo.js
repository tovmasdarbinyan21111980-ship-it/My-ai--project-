/* Демонстрационные данные. Полностью вымышленные: сгенерированы формулой, не связаны с реальным отелем. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.HPD = root.HPD || {}).demo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const YEAR = 2026;
  const ROOMS = 140;
  const FACT_MONTHS = 9; // факт — январь–сентябрь, остальное в плане
  const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const OCC = [0.58, 0.62, 0.68, 0.72, 0.78, 0.84, 0.88, 0.9, 0.82, 0.76, 0.66, 0.74];
  const ADR = [19500, 20500, 21500, 23000, 25500, 28500, 31000, 32000, 27500, 24000, 21500, 26500];

  function rng(seed) { // mulberry32: одинаковые данные при каждом запуске
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function build() {
    const rand = rng(2026);
    const noise = (s) => (rand() * 2 - 1) * s;
    const months = [];
    for (let i = 0; i < 12; i++) {
      const avail = ROOMS * DAYS[i];
      const mk = (occ, adr, fixed) => {
        const sold = Math.round(avail * Math.min(0.97, occ));
        const roomRev = Math.round((sold * adr) / 1000) * 1000;
        const totalRev = Math.round(roomRev / (0.66 + noise(0.02)) / 1000) * 1000;
        const opex = Math.round((totalRev * 0.31 + fixed * (1 + noise(0.02))) / 1000) * 1000;
        return { avail, sold, roomRev, totalRev, opex };
      };
      const budget = mk(OCC[i], ADR[i], 39000000);
      const py = mk(OCC[i] - 0.025 + noise(0.02), ADR[i] * 0.94 * (1 + noise(0.02)), 37000000);
      const fact = i < FACT_MONTHS ? mk(OCC[i] + noise(0.04), ADR[i] * (1.012 + noise(0.03)), 39800000) : null;
      months.push({ fact, budget, py });
    }
    return { years: { [YEAR]: { months } } };
  }

  return { YEAR, ROOMS, build };
});
