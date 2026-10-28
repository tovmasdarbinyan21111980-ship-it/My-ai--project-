const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../js/calc.js');
const demo = require('../js/demo.js');
const dataio = require('../js/dataio.js');

const T = (avail, sold, roomRev, totalRev, opex) => ({ avail, sold, roomRev, totalRev, opex });

test('показатели считаются по формулам', () => {
  const m = calc.metrics(T(1000, 800, 20000000, 30000000, 18000000));
  assert.equal(m.occupancy, 0.8);
  assert.equal(m.adr, 25000);
  assert.equal(m.revpar, 20000);
  assert.equal(m.revenue, 30000000);
  assert.equal(m.gop, 12000000);
  assert.equal(m.margin, 0.4);
});

test('нулевой знаменатель даёт null, а не NaN', () => {
  const m = calc.metrics(T(0, 0, 0, 0, 0));
  assert.equal(m.occupancy, null);
  assert.equal(m.adr, null);
  assert.equal(m.revpar, null);
  assert.equal(m.margin, null);
});

test('отклонения: п.п. для доли, % для остальных, база 0 и пустые значения', () => {
  assert.ok(Math.abs(calc.delta(0.78, 0.75, 'pct') - 3) < 1e-9);
  assert.equal(calc.delta(110, 100, 'rel'), 10);
  assert.equal(calc.delta(-50, -100, 'rel'), 50); // убыток сократился — улучшение
  assert.equal(calc.delta(5, 0, 'rel'), null);
  assert.equal(calc.delta(null, 1, 'rel'), null);
});

test('итог за период считается из сумм, а не средним от месяцев', () => {
  const months = Array.from({ length: 12 }, () => ({ fact: null, budget: null, py: null }));
  months[0].fact = T(100, 50, 1000, 2000, 1000);
  months[1].fact = T(300, 270, 9000, 12000, 6000);
  const y = { months };
  const t = calc.aggregate(y, [1, 2], 'fact');
  assert.equal(calc.metrics(t).occupancy, 320 / 400); // не (0.5+0.9)/2
  assert.equal(calc.aggregate(y, [1, 2], 'budget'), null); // нет бюджета — не сравниваем
});

test('демо-данные: факт до сентября, бюджет и прошлый год на весь год, значения правдоподобны', () => {
  const ds = demo.build();
  const y = ds.years[demo.YEAR];
  assert.equal(calc.lastFactMonth(y), 9);
  y.months.forEach((m) => {
    assert.ok(m.budget && m.py);
    for (const s of ['fact', 'budget', 'py']) {
      if (!m[s]) continue;
      assert.ok(m[s].sold <= m[s].avail && m[s].roomRev <= m[s].totalRev);
      const x = calc.metrics(m[s]);
      assert.ok(x.occupancy > 0.4 && x.occupancy < 0.98, 'загрузка');
      assert.ok(x.margin > 0, 'прибыль положительна');
    }
  });
});

test('импорт: round-trip демо-данных через строки', () => {
  const ds = demo.build();
  const res = dataio.fromRows(dataio.toRows(ds));
  assert.equal(res.ok, true);
  assert.deepEqual(res.dataset, ds);
});

test('импорт: русские названия, числа-строки с пробелами и запятой, пустые строки, смещённая шапка', () => {
  const rows = [
    ['Отчёт отеля'],
    [],
    dataio.HEADERS,
    [2026, 'Март', 'факт', '4 340', '3 000,0', '70 000 000', 100000000, 60000000],
    [],
    [2026, 3, 'БЮДЖЕТ', 4340, 3100, 72000000, 101000000, 59000000],
  ];
  const res = dataio.fromRows(rows);
  assert.equal(res.ok, true);
  assert.equal(res.dataset.years[2026].months[2].fact.sold, 3000);
  assert.equal(res.dataset.years[2026].months[2].budget.opex, 59000000);
});

test('импорт: ошибки указывают номер строки, неверные данные не загружаются', () => {
  const h = dataio.HEADERS;
  const bad = dataio.fromRows([h, [2026, 13, 'Факт', 100, 50, 1, 2, 1], [2026, 1, 'Факт', 100, 150, 1, 2, 1], [2026, 2, 'Что-то', 100, 50, 1, 2, 1], [2026, 3, 'Факт', 100, 50, 5, 2, 1]]);
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.length, 4);
  assert.match(bad.errors[0], /^Строка 2:.*месяц/);
  assert.match(bad.errors[1], /^Строка 3:.*больше, чем доступно/);
  assert.match(bad.errors[2], /^Строка 4:.*сценарий/);
  assert.match(bad.errors[3], /^Строка 5:.*выручка от номеров больше/);
});

test('импорт: дубликаты, нет колонок, пустой файл', () => {
  const h = dataio.HEADERS;
  const r = [2026, 1, 'Факт', 100, 50, 1, 2, 1];
  assert.match(dataio.fromRows([h, r, r]).errors[0], /повтор/);
  assert.match(dataio.fromRows([['Год', 'Месяц', 'Сценарий']]).errors[0], /Не хватает колонок/);
  assert.match(dataio.fromRows([['a', 'b']]).errors[0], /Не найдена строка заголовков/);
  assert.match(dataio.fromRows([h]).errors[0], /нет строк/);
  assert.match(dataio.fromRows([h, [2026, 1, 'Прошлый год', 100, 50, 1, 2, 1]]).errors[0], /Факт.*Бюджет/);
});
