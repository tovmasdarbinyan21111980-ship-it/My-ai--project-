'use strict';
/**
 * Проверка интерфейса в Chromium (Playwright) на вымышленном сервере Google:
 * google.script.run возвращает вывод настоящей серверной логики на фикстурах.
 * Запуск: node tests/ui.test.js <каталог-скриншотов>
 */
const path = require('path');
const fs = require('fs');
const assert = require('node:assert/strict');
const { chromium, devices } = require('playwright');
const { load } = require('./load');
const { corporate, personal } = require('./fixtures');

const out = process.argv[2] || path.join(__dirname, '..', '.shots');
fs.mkdirSync(out, { recursive: true });
const g0 = load();
const g = load({ books: { [g0.__SCC.CORPORATE_ID]: corporate, [g0.__SCC.PERSONAL_ID]: personal } });
const payload = {
  getCorporateData: JSON.parse(JSON.stringify(g.getCorporateData())),
  getPersonalData: JSON.parse(JSON.stringify(g.getPersonalData()))
};
const html = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8');

function stub(p, mode) {
  return `(() => {
    const P = ${JSON.stringify(p).replace(/</g, '\\u003c')}; const calls = []; window.__calls = calls;
    function mk(ok, bad){ return new Proxy({}, { get(_, fn){
      if (fn === 'withSuccessHandler') return (f) => mk(f, bad);
      if (fn === 'withFailureHandler') return (f) => mk(ok, f);
      return () => { calls.push(fn); setTimeout(() => {
        if (${JSON.stringify(mode)} === 'deny') bad && bad(new Error('ACCESS_DENIED'));
        else if (${JSON.stringify(mode)} === 'fail') bad && bad(new Error('boom'));
        else ok && ok(JSON.parse(JSON.stringify(P[fn])));
      }, 30); };
    }}); }
    window.google = { script: { run: mk() } };
  })();`;
}

async function open(browser, ctxOpts, mode) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const external = [];
  await page.route('**/*', (r) => {
    const u = r.request().url();
    if (u.startsWith('data:') || u.startsWith('about:') || u === 'http://app.test/') return r.continue();
    external.push(u); return r.abort();
  });
  await page.route('http://app.test/', (r) => r.fulfill({ contentType: 'text/html', body: html.replace('<script>', () => '<script>' + stub(payload, mode)) }));
  await page.goto('http://app.test/');
  return { ctx, page, errors, external };
}

const noOverflow = async (page, label) => {
  const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert.ok(w.sw <= w.cw + 1, `${label}: горизонтальная прокрутка ${w.sw} > ${w.cw}`);
  // overflow-x скрыт в стилях, поэтому отдельно проверяем, что ничто не вылезает за правый край экрана
  const bad = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth, out = [];
    document.querySelectorAll('main *, .top *').forEach((el) => {
      if (el.closest('.chips,.tablewrap')) return;
      const r = el.getBoundingClientRect();
      if (r.width && r.right > vw + 1) out.push((el.className || el.tagName) + ':' + Math.round(r.right));
    });
    return out.slice(0, 5);
  });
  assert.deepEqual(bad, [], `${label}: элементы за правым краем: ${bad.join(', ')}`);
};

(async () => {
  const browser = await chromium.launch();
  const results = [];
  const ok = (name) => { results.push(name); console.log('ok  -', name); };

  // ── iPhone ──
  const phone = await open(browser, { ...devices['iPhone 14'], deviceScaleFactor: 2 });
  let { page } = phone;
  await page.waitForSelector('.kpis');
  const txt = await page.textContent('main');
  assert.match(txt, /Проекты в реестре/); assert.match(txt, /Требует внимания/);
  assert.match(txt, /Срок не установлен|без срока: 4/);
  assert.ok(!/просрочен/i.test(txt.replace(/Срок не установлен ≠ просрочка/, '')) || /Это не просрочка/.test(txt));
  await noOverflow(page, 'главная');
  await page.screenshot({ path: path.join(out, 'phone-home.png'), fullPage: false });
  await page.screenshot({ path: path.join(out, 'phone-home-full.png'), fullPage: true });
  ok('iPhone: главная, без горизонтальной прокрутки');

  for (const [hash, needle, shot] of [
    ['projects', 'Ереван — гостиничный проект', 'phone-projects'],
    ['project/C01', 'François Baudin', 'phone-project'],
    ['talks', 'Чей ход / ожидаемый ответ', 'phone-talks'],
    ['actions', 'Проверить актуальный ответ по линии Accor', 'phone-actions'],
    ['risks', 'Условия Cullinan', 'phone-risks'],
    ['decisions', 'Условие пересмотра', 'phone-decisions'],
    ['sources', 'Инвентаризация источников', 'phone-sources'],
    ['data', 'Не подключено', 'phone-data']
  ]) {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await page.waitForFunction((n) => document.getElementById('view').textContent.includes(n), needle);
    await noOverflow(page, hash);
    await page.screenshot({ path: path.join(out, shot + '.png'), fullPage: true });
  }
  ok('iPhone: все корпоративные разделы открываются и без горизонтальной прокрутки');

  // нет выдуманных оценок рисков
  await page.evaluate(() => { location.hash = 'risks'; });
  await page.waitForSelector('.banner');
  const rt = await page.textContent('main');
  assert.match(rt, /Оценки не выводятся и не придумываются/);
  assert.ok(!/Вероятность:|Последствия:/.test(rt));
  ok('Риски: вероятность и ущерб не выдуманы');

  // нижняя панель и «Ещё»
  const bar = await page.$$eval('#bar button', (b) => b.map((x) => x.textContent.trim()));
  assert.deepEqual(bar, ['Главная', 'Проекты', 'Переговоры', 'Риски', 'Ещё']);
  const h = await page.$$eval('#bar button', (b) => Math.min(...b.map((x) => x.getBoundingClientRect().height)));
  assert.ok(h >= 44, 'цель касания ≥44px: ' + h);
  await page.click('#bar [data-more]');
  await page.waitForSelector('#sheet.open');
  await page.screenshot({ path: path.join(out, 'phone-more.png') });
  await page.click('#sheet [data-go="data"]');
  await page.waitForFunction(() => document.getElementById('view').textContent.includes('Подключения'));
  ok('iPhone: нижняя навигация, меню «Ещё», цели касания ≥44px');

  // личный контур
  const callsBefore = await page.evaluate(() => window.__calls.slice());
  assert.ok(!callsBefore.includes('getPersonalData'), 'личные данные не запрашивались без переключения');
  await page.click('#segTop [data-c="pers"]');
  await page.waitForFunction(() => document.getElementById('view').textContent.includes('Пятилетняя стратегия'));
  const pt = await page.textContent('main');
  assert.ok(!/Accor|Lotte|Luxury|Mandarin|GCC/.test(pt), 'корпоративные данные в личном контуре');
  assert.equal(await page.getAttribute('body', 'data-contour'), 'pers');
  await noOverflow(page, 'личный');
  await page.screenshot({ path: path.join(out, 'phone-personal.png'), fullPage: true });
  for (const [hash, needle, shot] of [['p-projects', 'Дом — архитектура', 'phone-p-projects'], ['p-capital', 'Размер инвестиций', 'phone-p-capital'], ['p-conflicts', 'Контроль конфликтов', 'phone-p-conflicts']]) {
    await page.evaluate((x) => { location.hash = x; }, hash);
    await page.waitForFunction((n) => document.getElementById('view').textContent.includes(n), needle);
    await noOverflow(page, hash);
    await page.screenshot({ path: path.join(out, shot + '.png'), fullPage: true });
  }
  const corpLeak = await page.evaluate(() => JSON.stringify(Object.keys(window)).includes('corp'));
  assert.ok(!corpLeak);
  // возврат в корпоративный контур
  await page.click('#bar [data-c="corp"]');
  await page.waitForFunction(() => document.getElementById('view').textContent.includes('Проекты в реестре'));
  const t2 = await page.textContent('main');
  assert.ok(!/Пятилетняя|совладение/.test(t2));
  ok('Контуры разделены: личные данные запрашиваются только по переключению, корпоративных в личном нет');

  assert.deepEqual(phone.errors, [], 'ошибки консоли: ' + phone.errors.join('; '));
  assert.deepEqual(phone.external, [], 'внешние запросы: ' + phone.external.join(', '));
  ok('Нет ошибок консоли и нет внешних сетевых запросов');
  await phone.ctx.close();

  // ── компьютер ──
  const desk = await open(browser, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page = desk.page;
  await page.waitForSelector('.kpis');
  assert.ok(await page.isVisible('#side'));
  assert.ok(!(await page.isVisible('#bar')));
  await noOverflow(page, 'desktop');
  await page.screenshot({ path: path.join(out, 'desktop-home.png') });
  await page.evaluate(() => { location.hash = 'project/C01'; });
  await page.waitForFunction(() => document.getElementById('view').textContent.includes('История'));
  await page.screenshot({ path: path.join(out, 'desktop-project.png') });
  await page.evaluate(() => { location.hash = 'risks'; });
  await page.waitForSelector('.chips');
  await page.click('[data-filter="risk:high"]');
  assert.equal(await page.$$eval('main .card:not(.banner)', (c) => c.length), 1);
  ok('Компьютер: боковая навигация, фильтр рисков');
  assert.deepEqual(desk.errors, []);
  await desk.ctx.close();

  // ── ошибки ──
  const denied = await open(browser, { ...devices['iPhone 14'] }, 'deny');
  await denied.page.waitForSelector('.err');
  const dt = await denied.page.textContent('main');
  assert.match(dt, /Доступ закрыт/);
  assert.ok(!/Accor|Lotte/.test(dt));
  await denied.page.screenshot({ path: path.join(out, 'phone-denied.png') });
  await denied.ctx.close();
  const failed = await open(browser, { ...devices['iPhone 14'] }, 'fail');
  await failed.page.waitForSelector('.err');
  assert.match(await failed.page.textContent('main'), /Не удалось прочитать данные/);
  await failed.ctx.close();
  ok('Ошибки: отказ в доступе и сбой чтения показываются без данных');

  // ── XSS: вредоносное содержимое ячеек не исполняется ──
  const evil = JSON.parse(JSON.stringify(payload));
  evil.getCorporateData.projects[0].name = '<img src=x onerror="window.__xss=1">Проект';
  evil.getCorporateData.projects[0].next = '"><script>window.__xss=2</script>';
  const ctx = await browser.newContext({ ...devices['iPhone 14'] });
  const ep = await ctx.newPage();
  await ep.route('**/*', (r) => {
    const u = r.request().url();
    if (u === 'http://app.test/') return r.fulfill({ contentType: 'text/html', body: html.replace('<script>', () => '<script>' + stub(evil, 'ok')) });
    return r.abort();
  });
  await ep.goto('http://app.test/');
  await ep.waitForSelector('.kpis');
  assert.equal(await ep.evaluate(() => window.__xss), undefined);
  assert.match(await ep.textContent('main'), /<img src=x/);
  await ctx.close();
  ok('Защита от внедрения кода через содержимое ячеек');

  await browser.close();
  console.log('\nИнтерфейс: ' + results.length + ' групп проверок пройдено. Снимки: ' + out);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
