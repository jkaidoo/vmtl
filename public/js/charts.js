'use strict';
// VMTL.charts — dependency-free, theme-aware, interactive SVG chart toolkit.
// Every builder returns an HTML string; call VMTL.charts.bind(container) once the
// markup is in the DOM to wire tooltips, hover highlights and click → `chartselect`
// events (bubbling CustomEvent with { id, index, item, category, kind }).
(function () {
  const VMTL = (window.VMTL = window.VMTL || {});
  const esc = (s) => (VMTL.esc ? VMTL.esc(s) : String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const PALETTE = ['var(--primary)', 'var(--info)', 'var(--violet)', 'var(--warning)', 'var(--danger)', 'var(--success)', '#0ea5a3', '#db2777'];

  const reg = {};
  let seq = 0;
  const nid = () => 'ch' + (++seq);
  function reset() { for (const k in reg) delete reg[k]; }

  // ---- formatting ----------------------------------------------------------
  function fmtVal(v, kind) {
    if (v == null) return '—';
    if (kind === 'currency') return VMTL.fmtCedis(v);
    if (kind === 'decimal') return VMTL.fmtDecimal(v, 1);
    if (kind === 'duration') return VMTL.fmtDuration(v);
    return VMTL.fmtNumber(v);
  }
  function compact(v) {
    v = num(v); const a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k';
    return String(Math.round(v * 10) / 10);
  }
  function axisLabel(v, kind) { return (kind === 'currency' ? '₵' : '') + compact(v); }
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const f = v / p; const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * p;
  }
  function shortLabel(l) {
    const m = /^(\d{4})-(\d{2})$/.exec(l);
    if (m) return +m[2] === 1 ? `${MON[0]} '${m[1].slice(2)}` : MON[+m[2] - 1];
    return l.length > 8 ? l.slice(0, 7) + '…' : l;
  }

  // ---- tooltip singleton ---------------------------------------------------
  let tipEl;
  function tip() { if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'chart-tip'; document.body.appendChild(tipEl); } return tipEl; }
  function showTip(html, x, y) {
    const t = tip(); t.innerHTML = html; t.classList.add('on');
    const r = t.getBoundingClientRect();
    let left = x - r.width / 2; left = Math.max(8, Math.min(left, window.innerWidth - r.width - 8));
    let top = y - r.height - 14; if (top < 8) top = y + 18;
    t.style.left = left + 'px'; t.style.top = top + 'px';
  }
  function hideTip() { if (tipEl) tipEl.classList.remove('on'); }
  const basicTip = (it, kind) => `<div class="tt-l">${esc(it.label)}</div><div class="tt-v">${fmtVal(it.value, kind)}</div>`;

  function emptyBox(h) { return `<div class="ch-empty" style="min-height:${h || 120}px">No data for this range.</div>`; }

  // ---- area / line chart ---------------------------------------------------
  function smooth(pts) {
    if (pts.length < 2) return pts.length ? `M ${pts[0].x} ${pts[0].y}` : '';
    if (pts.length === 2) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L ${pts[1].x.toFixed(1)} ${pts[1].y.toFixed(1)}`;
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || pts[i + 1];
      const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d;
  }
  function areaLine(rows, opts = {}) {
    const series = (rows || []).map((d) => ({
      label: String(d.label ?? d.period ?? ''),
      value: num(d.value ?? (opts.valueKey ? d[opts.valueKey] : undefined) ?? d.trips ?? d.cost),
      raw: d,
    }));
    if (!series.length) return emptyBox(opts.height || 240);
    const id = opts.id || nid();
    const W = 640, H = opts.height || 240, padL = 46, padR = 16, padT = 16, padB = 28;
    const iw = W - padL - padR, ih = H - padT - padB;
    const maxV = niceMax(Math.max(1, ...series.map((s) => s.value)));
    const n = series.length;
    const X = (i) => (n === 1 ? padL + iw / 2 : padL + (i / (n - 1)) * iw);
    const Y = (v) => padT + ih - (v / maxV) * ih;
    const pts = series.map((s, i) => ({ x: X(i), y: Y(s.value), ...s }));
    const linePath = smooth(pts);
    const areaPath = `${linePath} L ${pts[n - 1].x.toFixed(1)} ${padT + ih} L ${pts[0].x.toFixed(1)} ${padT + ih} Z`;
    const color = opts.color || 'var(--primary)';
    const gid = id + '_g';
    const ticks = 4; let grid = '';
    for (let t = 0; t <= ticks; t++) {
      const val = (maxV * t) / ticks; const y = Y(val);
      grid += `<line class="ch-grid" x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}"/>`;
      grid += `<text class="ch-axis" x="${padL - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${esc(axisLabel(val, opts.kind))}</text>`;
    }
    const step = Math.ceil(n / 8); let xl = '';
    series.forEach((s, i) => { if (i % step === 0 || i === n - 1) xl += `<text class="ch-axis" x="${X(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(shortLabel(s.label))}</text>`; });
    let hits = '', dots = '';
    pts.forEach((p, i) => {
      const half = (n === 1 ? iw / 2 : iw / (n - 1) / 2) + 2;
      hits += `<rect class="ch-hit" x="${(p.x - half).toFixed(1)}" y="${padT}" width="${(half * 2).toFixed(1)}" height="${ih}" data-i="${i}"/>`;
      dots += `<circle class="ch-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" data-i="${i}"/>`;
    });
    reg[id] = { items: series.map((s) => ({ label: s.label, value: s.value, raw: s.raw })), kind: opts.kind, category: opts.category };
    return `<svg class="ch ch-area" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || 'Trend chart')}" data-chart="${id}">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.26"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <g class="ch-grids">${grid}</g>
      <path class="ch-fill" d="${areaPath}" fill="url(#${gid})"/>
      <path class="ch-line" pathLength="1" d="${linePath}" stroke="${color}"/>
      <line class="ch-guide" x1="0" y1="${padT}" x2="0" y2="${padT + ih}" style="display:none"/>
      <g class="ch-dots" style="color:${color}">${dots}</g>
      <g class="ch-xlabels">${xl}</g>
      <g class="ch-hits">${hits}</g>
    </svg>`;
  }

  // ---- donut ---------------------------------------------------------------
  function donut(segs, opts = {}) {
    const segments = (segs || [])
      .map((s, i) => ({ label: String(s.label), value: num(s.value), color: s.color || PALETTE[i % PALETTE.length], raw: s }))
      .filter((s) => s.value > 0);
    if (!segments.length) return emptyBox(opts.height || 180);
    const id = opts.id || nid();
    const total = segments.reduce((a, s) => a + s.value, 0);
    const size = 180, r = 68, cx = size / 2, cy = size / 2, C = 2 * Math.PI * r, sw = 20;
    let off = 0, arcs = '';
    segments.forEach((s, i) => {
      const len = (s.value / total) * C;
      arcs += `<circle class="ch-seg" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${sw}" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" data-i="${i}" transform="rotate(-90 ${cx} ${cy})"/>`;
      off += len;
    });
    reg[id] = { items: segments.map((s) => ({ label: s.label, value: s.value, raw: s.raw, pct: Math.round((s.value / total) * 100) })), kind: opts.kind, category: opts.category };
    const legend = segments.map((s, i) => `<button type="button" class="ch-leg" data-i="${i}"><span class="ch-sw" style="background:${s.color}"></span><span class="ch-leg-l">${esc(s.label)}</span><span class="ch-leg-v tnum">${fmtVal(s.value, opts.kind)}</span></button>`).join('');
    return `<div class="ch-donut-wrap" data-chart="${id}">
      <svg class="ch ch-donut" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(opts.label || 'Breakdown')}">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="${sw}"/>
        ${arcs}
        <text class="ch-donut-c1" x="${cx}" y="${cy - 1}" text-anchor="middle">${esc(opts.center != null ? opts.center : fmtVal(total, opts.kind))}</text>
        <text class="ch-donut-c2" x="${cx}" y="${cy + 17}" text-anchor="middle">${esc(opts.centerLabel || 'Total')}</text>
      </svg>
      <div class="ch-legend">${legend}</div>
    </div>`;
  }

  // ---- horizontal bars -----------------------------------------------------
  function hbars(rows, opts = {}) {
    const lk = opts.labelKey || 'label', vk = opts.valueKey || 'value';
    let data = (rows || []).map((r) => ({ label: String(r[lk]), value: num(r[vk]), raw: r }));
    if (!data.length) return emptyBox(opts.height || 80);
    if (opts.sort !== false) data.sort((a, b) => b.value - a.value);
    data = data.slice(0, opts.limit || 10);
    const max = Math.max(1, ...data.map((r) => r.value));
    const color = opts.color || 'var(--primary)';
    const clickable = opts.clickable !== false;
    const cid = opts.id || nid();
    reg[cid] = { items: data.map((r) => ({ label: r.label, value: r.value, raw: r.raw })), kind: opts.kind, category: opts.category, clickable };
    const body = data.map((r, i) => {
      const w = Math.max(2, Math.round((r.value / max) * 100));
      return `<button type="button" class="ch-bar${clickable ? '' : ' static'}" data-i="${i}"${clickable ? '' : ' tabindex="-1"'}><span class="ch-bar-head"><span class="ch-bar-l">${esc(r.label)}</span><span class="ch-bar-v tnum">${fmtVal(r.value, opts.kind)}</span></span><span class="ch-bar-track"><span class="ch-bar-fill" style="width:${w}%;background:${color}"></span></span></button>`;
    }).join('');
    return `<div class="ch-bars" data-chart="${cid}">${body}</div>`;
  }

  // ---- heat strip ----------------------------------------------------------
  function heatStrip(cells, opts = {}) {
    const vk = opts.valueKey || 'value';
    const data = (cells || []).map((c) => ({ label: String(c.label), value: num(c[vk] ?? c.value), raw: c }));
    if (!data.length) return emptyBox(opts.height || 90);
    const id2 = opts.id || nid();
    const max = Math.max(1, ...data.map((c) => c.value));
    reg[id2] = { items: data.map((c) => ({ label: c.label, value: c.value, raw: c.raw })), kind: opts.kind, category: opts.category };
    const cols = opts.cols || data.length;
    const body = data.map((c, i) => {
      const t = c.value / max;
      const tickTxt = opts.tick ? opts.tick(c.label, i) : '';
      return `<button type="button" class="ch-cell" data-i="${i}" style="--t:${t.toFixed(3)}" aria-label="${esc(c.label)}">${tickTxt ? `<span class="ch-cell-x">${esc(tickTxt)}</span>` : ''}</button>`;
    }).join('');
    return `<div class="ch-heat" data-chart="${id2}" style="--cols:${cols}">${body}</div>`;
  }

  // ---- sparkline -----------------------------------------------------------
  function sparkline(values, opts = {}) {
    const v = (values || []).map(num);
    if (v.length < 2) return '';
    const W = opts.width || 96, H = opts.height || 28, p = 2;
    const max = Math.max(...v), min = Math.min(...v), rng = max - min || 1;
    const X = (i) => p + (i / (v.length - 1)) * (W - 2 * p);
    const Y = (val) => p + (1 - (val - min) / rng) * (H - 2 * p);
    const pts = v.map((val, i) => `${X(i).toFixed(1)},${Y(val).toFixed(1)}`).join(' ');
    const color = opts.color || 'var(--primary)';
    const last = `${X(v.length - 1).toFixed(1)}`, lastY = `${Y(v[v.length - 1]).toFixed(1)}`;
    return `<svg class="ch-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${last}" cy="${lastY}" r="2.2" fill="${color}"/></svg>`;
  }

  // ---- bind ----------------------------------------------------------------
  function emit(node, cid, i) {
    const data = reg[cid]; if (!data) return;
    node.dispatchEvent(new CustomEvent('chartselect', { bubbles: true, detail: { id: cid, index: i, item: data.items[i], category: data.category, kind: data.kind } }));
  }
  function bind(root) {
    root = root || document;
    root.querySelectorAll('svg.ch-area[data-chart]').forEach((svg) => {
      const cid = svg.getAttribute('data-chart'); const data = reg[cid]; if (!data) return;
      const guide = svg.querySelector('.ch-guide'); const dots = [...svg.querySelectorAll('.ch-dot')];
      const clear = () => { guide.style.display = 'none'; dots.forEach((d) => d.classList.remove('on')); hideTip(); };
      svg.querySelectorAll('.ch-hit').forEach((h) => {
        const i = +h.dataset.i;
        const move = (e) => {
          dots.forEach((d) => d.classList.remove('on'));
          const dot = dots[i];
          if (dot) { dot.classList.add('on'); const x = dot.getAttribute('cx'); guide.setAttribute('x1', x); guide.setAttribute('x2', x); guide.style.display = 'block'; }
          showTip(basicTip(data.items[i], data.kind), e.clientX, e.clientY);
        };
        h.addEventListener('mouseenter', move);
        h.addEventListener('mousemove', move);
        h.addEventListener('click', () => emit(svg, cid, i));
      });
      svg.addEventListener('mouseleave', clear);
    });
    root.querySelectorAll('.ch-donut-wrap[data-chart]').forEach((wrap) => {
      const cid = wrap.getAttribute('data-chart'); const data = reg[cid]; if (!data) return;
      const segsEl = [...wrap.querySelectorAll('.ch-seg')]; const legs = [...wrap.querySelectorAll('.ch-leg')];
      const c1 = wrap.querySelector('.ch-donut-c1'), c2 = wrap.querySelector('.ch-donut-c2');
      const base1 = c1.textContent, base2 = c2.textContent;
      const focus = (i, on) => {
        segsEl.forEach((s, j) => { s.classList.toggle('dim', on && j !== i); s.classList.toggle('hot', on && j === i); });
        legs.forEach((l, j) => l.classList.toggle('hot', on && j === i));
        if (on) { const it = data.items[i]; c1.textContent = fmtVal(it.value, data.kind); c2.textContent = `${it.label} · ${it.pct}%`; }
        else { c1.textContent = base1; c2.textContent = base2; }
      };
      segsEl.forEach((s) => {
        const i = +s.dataset.i;
        s.addEventListener('mouseenter', (e) => { focus(i, true); showTip(`<div class="tt-l">${esc(data.items[i].label)}</div><div class="tt-v">${fmtVal(data.items[i].value, data.kind)} · ${data.items[i].pct}%</div>`, e.clientX, e.clientY); });
        s.addEventListener('mousemove', (e) => showTip(`<div class="tt-l">${esc(data.items[i].label)}</div><div class="tt-v">${fmtVal(data.items[i].value, data.kind)} · ${data.items[i].pct}%</div>`, e.clientX, e.clientY));
        s.addEventListener('mouseleave', () => { focus(i, false); hideTip(); });
        s.addEventListener('click', () => emit(wrap, cid, i));
      });
      legs.forEach((l) => {
        const i = +l.dataset.i;
        l.addEventListener('mouseenter', () => focus(i, true));
        l.addEventListener('mouseleave', () => focus(i, false));
        l.addEventListener('click', () => emit(wrap, cid, i));
      });
    });
    root.querySelectorAll('.ch-heat[data-chart]').forEach((heat) => {
      const cid = heat.getAttribute('data-chart'); const data = reg[cid]; if (!data) return;
      heat.querySelectorAll('.ch-cell').forEach((c) => {
        const i = +c.dataset.i;
        c.addEventListener('mouseenter', (e) => showTip(basicTip(data.items[i], data.kind), e.clientX, e.clientY));
        c.addEventListener('mousemove', (e) => showTip(basicTip(data.items[i], data.kind), e.clientX, e.clientY));
        c.addEventListener('mouseleave', hideTip);
        c.addEventListener('click', () => emit(heat, cid, i));
      });
    });
    root.querySelectorAll('.ch-bars[data-chart]').forEach((bars) => {
      const cid = bars.getAttribute('data-chart'); const data = reg[cid]; if (!data) return;
      bars.querySelectorAll('.ch-bar').forEach((b) => {
        const i = +b.dataset.i;
        if (data.clickable) b.addEventListener('click', () => emit(bars, cid, i));
      });
    });
  }

  VMTL.charts = { areaLine, donut, hbars, heatStrip, sparkline, bind, reset, fmtVal, PALETTE };
})();
