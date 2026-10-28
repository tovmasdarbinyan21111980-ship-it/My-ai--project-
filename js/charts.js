/* Графики на чистом SVG: линии (динамика) и столбцы (отклонения). Без библиотек. */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function niceTicks(min, max, count) {
    if (min === max) { min -= 1; max += 1; }
    const raw = (max - min) / (count - 1);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / mag;
    const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
    return ticks;
  }

  /** Общая раскладка: оси, сетка, подписи месяцев, подсказка. Возвращает рабочий контекст. */
  function frame(host, opt, domain) {
    host.textContent = '';
    host.classList.add('chart');
    const W = Math.max(280, host.clientWidth || 320);
    const H = W < 480 ? 250 : 320;
    const ticks = niceTicks(domain[0], domain[1], W < 480 ? 5 : 6);
    const labels = ticks.map(opt.axisFmt);
    const mt = 12, mb = 26, mr = 10;
    const ml = Math.max(34, Math.max(...labels.map((l) => l.length)) * 6.2 + 12);
    const pw = W - ml - mr, ph = H - mt - mb;
    const lo = ticks[0], hi = ticks[ticks.length - 1];
    const n = opt.categories.length;
    const band = pw / n;
    const X = (i) => ml + (i + 0.5) * band;
    const Y = (v) => mt + ph - ((v - lo) / (hi - lo)) * ph;

    const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': opt.label, class: 'chart-svg' }, host);
    svg.style.height = H + 'px';
    ticks.forEach((t, i) => {
      el('line', { x1: ml, x2: W - mr, y1: Y(t), y2: Y(t), class: t === 0 ? 'zero' : 'grid' }, svg);
      const tx = el('text', { x: ml - 8, y: Y(t) + 3.5, 'text-anchor': 'end', class: 'tick' }, svg);
      tx.textContent = labels[i];
    });
    opt.categories.forEach((c, i) => {
      if (band < 24 && i % 2 === 1) return;
      const tx = el('text', { x: X(i), y: H - 8, 'text-anchor': 'middle', class: 'tick' }, svg);
      tx.textContent = c;
    });

    const tip = document.createElement('div');
    tip.className = 'tip';
    tip.hidden = true;
    host.appendChild(tip);

    function showTip(i) {
      const info = opt.tip(i);
      tip.textContent = '';
      const t = document.createElement('div');
      t.className = 'tip-title';
      t.textContent = info.title;
      tip.appendChild(t);
      for (const r of info.rows) {
        const row = document.createElement('div');
        row.className = 'tip-row';
        const sw = document.createElement('span');
        sw.className = 'sw ' + r.cls;
        const name = document.createElement('span');
        name.className = 'tip-name';
        name.textContent = r.label;
        const val = document.createElement('span');
        val.className = 'tip-val ' + (r.tone || '');
        val.textContent = r.value;
        row.append(sw, name, val);
        tip.appendChild(row);
      }
      tip.hidden = false;
      const w = tip.offsetWidth;
      let left = X(i) + 14;
      if (left + w > W - 4) left = X(i) - w - 14;
      tip.style.left = Math.max(4, left) + 'px';
      tip.style.top = mt + 4 + 'px';
    }

    function interact(onMove, onLeave) {
      const hit = el('rect', { x: ml, y: mt, width: pw, height: ph, fill: 'transparent', class: 'hit' }, svg);
      const at = (e) => {
        const r = svg.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * W;
        return Math.max(0, Math.min(n - 1, Math.floor((x - ml) / band)));
      };
      hit.addEventListener('pointermove', (e) => { const i = at(e); onMove(i); showTip(i); });
      hit.addEventListener('pointerdown', (e) => { const i = at(e); onMove(i); showTip(i); });
      hit.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { onLeave(); tip.hidden = true; } });
    }

    return { svg, W, H, ml, mt, pw, ph, band, X, Y, interact, n };
  }

  function domainOf(values, includeZero) {
    const v = values.filter((x) => x != null && Number.isFinite(x));
    if (!v.length) return null;
    let min = Math.min(...v), max = Math.max(...v);
    if (includeZero) { min = Math.min(min, 0); max = Math.max(max, 0); }
    const pad = (max - min || Math.abs(max) || 1) * 0.08;
    return [includeZero && min >= 0 ? 0 : min - pad, max + pad];
  }

  function empty(host, text) {
    host.textContent = '';
    const p = document.createElement('p');
    p.className = 'chart-empty';
    p.textContent = text;
    host.appendChild(p);
  }

  /** opt: { categories, series:[{id,label,cls,values}], axisFmt, label, tip(i), zero? } */
  function line(host, opt) {
    const dom = domainOf(opt.series.flatMap((s) => s.values), opt.zero);
    if (!dom) return empty(host, 'Нет данных для отображения');
    const f = frame(host, opt, dom);
    for (const s of [...opt.series].reverse()) { // факт рисуется последним — поверх остальных
      let d = '';
      let pen = false;
      s.values.forEach((v, i) => {
        if (v == null) { pen = false; return; }
        d += (pen ? 'L' : 'M') + f.X(i).toFixed(1) + ' ' + f.Y(v).toFixed(1);
        pen = true;
      });
      if (d) el('path', { d, class: 'line ' + s.cls, fill: 'none' }, f.svg);
      if (s.id === 'fact') s.values.forEach((v, i) => { if (v != null) el('circle', { cx: f.X(i), cy: f.Y(v), r: 3.2, class: 'dot ' + s.cls }, f.svg); });
    }
    const guide = el('line', { y1: f.mt, y2: f.mt + f.ph, class: 'guide', visibility: 'hidden' }, f.svg);
    const marks = opt.series.map((s) => el('circle', { r: 5, class: 'mark ' + s.cls, visibility: 'hidden' }, f.svg));
    f.interact(
      (i) => {
        guide.setAttribute('x1', f.X(i)); guide.setAttribute('x2', f.X(i)); guide.setAttribute('visibility', 'visible');
        opt.series.forEach((s, k) => {
          const v = s.values[i];
          marks[k].setAttribute('visibility', v == null ? 'hidden' : 'visible');
          if (v != null) { marks[k].setAttribute('cx', f.X(i)); marks[k].setAttribute('cy', f.Y(v)); }
        });
      },
      () => { guide.setAttribute('visibility', 'hidden'); marks.forEach((m) => m.setAttribute('visibility', 'hidden')); }
    );
  }

  /** Сгруппированные столбцы от нулевой линии. opt как у line(). */
  function bars(host, opt) {
    const dom = domainOf(opt.series.flatMap((s) => s.values), true);
    if (!dom) return empty(host, 'Нет данных для сравнения');
    const f = frame(host, opt, dom);
    const group = Math.min(f.band * 0.72, 40);
    const bw = group / opt.series.length;
    const y0 = f.Y(0);
    opt.series.forEach((s, k) => {
      s.values.forEach((v, i) => {
        if (v == null) return;
        const y = f.Y(v);
        el('rect', { x: f.X(i) - group / 2 + k * bw + 0.5, y: Math.min(y, y0), width: Math.max(1, bw - 1), height: Math.max(1, Math.abs(y - y0)), class: 'bar ' + s.cls }, f.svg);
      });
    });
    const band = el('rect', { y: f.mt, width: f.band, height: f.ph, class: 'band', visibility: 'hidden' }, f.svg);
    f.interact(
      (i) => { band.setAttribute('x', f.X(i) - f.band / 2); band.setAttribute('visibility', 'visible'); },
      () => band.setAttribute('visibility', 'hidden')
    );
  }

  (root.HPD = root.HPD || {}).charts = { line, bars };
})(typeof self !== 'undefined' ? self : this);
