// Проверка в браузере. Нужен Playwright: node tests/e2e.js <каталог-для-скриншотов> [каталог-с-тестовыми-xlsx]
// Сервер должен быть запущен: npm start
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('path');

const URL_ = process.env.URL || 'http://127.0.0.1:8080/';
const out = process.argv[2] || '.';
const fixtures = process.argv[3];

(async () => {
  const browser = await chromium.launch();
  const problems = [];
  const watch = (page) => {
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(m.type() + ': ' + m.text()); });
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  };

  // iPhone 14: 390×844, сенсорный экран
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ru-RU' });
  const p = await phone.newPage();
  watch(p);
  await p.goto(URL_);
  await p.waitForSelector('.kpi');
  assert.equal(await p.locator('.kpi').count(), 4);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, 'горизонтальная прокрутка страницы на телефоне: ' + overflow);
  await p.screenshot({ path: path.join(out, 'phone-top.png') });
  await p.screenshot({ path: path.join(out, 'phone-full.png'), fullPage: true });

  // период «Месяц» и смена показателя
  await p.click('[data-mode=month]');
  assert.match(await p.textContent('#periodLine'), /Сентябрь 2026/);
  await p.click('#metricTabs button:nth-child(5)');
  assert.match(await p.textContent('#trendTitle'), /операционная прибыль/);
  // касание графика показывает подсказку
  await p.locator('#trendChart svg').scrollIntoViewIfNeeded();
  const box = await p.locator('#trendChart svg').boundingBox();
  await p.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height * 0.4);
  await p.waitForSelector('#trendChart .tip:not([hidden])');
  console.log('подсказка:', (await p.textContent('#trendChart .tip')).replace(/\s+/g, ' '));
  // скрытие линии через легенду
  await p.click('#legend button:nth-child(3)');
  assert.equal(await p.locator('#trendChart path.line').count(), 2);

  // десктоп
  const desk = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'ru-RU' });
  const d = await desk.newPage();
  watch(d);
  await d.goto(URL_);
  await d.waitForSelector('.kpi');
  await d.hover('#trendChart svg', { position: { x: 500, y: 120 } });
  await d.waitForSelector('#trendChart .tip:not([hidden])');
  await d.screenshot({ path: path.join(out, 'desktop-top.png') });
  await d.screenshot({ path: path.join(out, 'desktop-full.png'), fullPage: true });

  // загрузка Excel
  if (fixtures) {
    await d.click('#openImport');
    await d.setInputFiles('#fileInput', path.join(fixtures, 'bad.xlsx'));
    await d.waitForSelector('#importErrors:not([hidden])');
    console.log('ошибка bad.xlsx:', (await d.textContent('#importErrors')).replace(/\s+/g, ' '));
    for (const f of ['old.xls', 'fake.xlsx']) {
      await d.setInputFiles('#fileInput', path.join(fixtures, f));
      await d.waitForTimeout(150);
      console.log('ошибка ' + f + ':', (await d.textContent('#importErrors')).replace(/\s+/g, ' '));
    }
    await d.setInputFiles('#fileInput', path.join(fixtures, 'good.xlsx'));
    await d.waitForSelector('#toast:not([hidden])');
    console.log('good.xlsx →', await d.textContent('#toast'), '|', await d.textContent('#source'));
    assert.match(await d.textContent('#periodLine'), /Февраль 2025/);
    // с начала года (янв–фев): (3000+3000)/(4340+3920) = 72,6 %
    assert.match(await d.locator('.kpi-value').first().textContent(), /72,6/);
    await d.reload();
    await d.waitForSelector('.kpi');
    assert.match(await d.textContent('#source'), /good\.xlsx/, 'данные должны сохраняться между визитами');
    await d.click('#openImport');
    await d.click('#resetDemo');
    assert.match(await d.textContent('#source'), /Демонстрация/);

    // пример файла: скачать → сохранить
    await d.click('#openImport');
    const [dl] = await Promise.all([d.waitForEvent('download'), d.click('#downloadExample')]);
    await dl.saveAs(path.join(fixtures, 'example-downloaded.xlsx'));
    // и загрузить обратно
    await d.setInputFiles('#fileInput', path.join(fixtures, 'example-downloaded.xlsx'));
    await d.waitForSelector('#toast:not([hidden])');
    console.log('пример файла загружается обратно:', await d.textContent('#toast'));
  }

  // тёмная тема
  const dark = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  const k = await dark.newPage();
  await k.goto(URL_);
  await k.waitForSelector('.kpi');
  await k.screenshot({ path: path.join(out, 'phone-dark.png') });

  await browser.close();
  console.log(problems.length ? 'ПРОБЛЕМЫ КОНСОЛИ:\n' + problems.join('\n') : 'консоль чистая');
  if (problems.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
