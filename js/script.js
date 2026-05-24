

'use strict';

/*Colour palette */
const C = {
  red:    '#ff2600',
  orange: '#ff6600',
  amber:  '#ffaa00',
  dim:    '#cc2000',
  // sequential scale for ordered bars (red → amber)
  seq: i => d3.interpolate('#ff2600', '#ffaa00')(i),
  // road user fixed colours — distinct enough to tell apart on dark bg
  roadUser: {
    'Car occupant':                    '#ff2600',
    'Motorcyclist':                    '#ff6600',
    'Pedal cyclist':                   '#ffcc00',
    'Pedestrian':                      '#4cc9f0',
    'Pick-up truck or van occupant':   '#aa44ff',
    'Bus occupant':                    '#44ddaa',
    'Heavy transport':                 '#ff88cc',
    'Other or unknown':                '#888899',
  },
  remoteness: {
    'Major Cities': '#ff2600',
    'Regional':     '#ff7700',
    'Remote':       '#ffcc00',
  },
  /* Male keeps dashboard red; Female uses cyan — distinguishable under deuteranopia */
  sex: { Male: '#ff2600', Female: '#4cc9f0' },
  fn:  { 'First Nations people': '#ff2600', 'Non-Indigenous': '#ff9900' },
};

/* Shared layout  */
const M = { top: 18, right: 16, bottom: 46, left: 62 };   // default margins

/*  Tooltip  */
const tip = d3.select('body').append('div')
  .attr('class', 'chart-tooltip')
  .style('opacity', 0)
  .style('pointer-events', 'none');

function showTip(e, title, value, extra = '') {
  tip.style('opacity', 1)
    .html(
      `<div class="tt-title">${title}</div>` +
      `<div class="tt-value">${typeof value === 'string' ? value : d3.format(',')(value)}</div>` +
      (extra ? `<div class="tt-extra">${extra}</div>` : '')
    );
  moveTip(e);
}
function moveTip(e) {
  const x = Math.min(e.clientX + 14, window.innerWidth - 220);
  const y = Math.max(e.clientY - 50, 8);
  tip.style('left', x + 'px').style('top', y + 'px');
}
function hideTip() { tip.style('opacity', 0); }

/* SVG factory */
function makeSVG(id, w, h, ml = M.left, mt = M.top) {
  d3.select(`#${id}`).selectAll('svg').remove();
  const labelEl = document.getElementById(id)?.closest('.chart-card')?.querySelector('.chart-label');
  const label   = labelEl ? labelEl.textContent : id;
  return d3.select(`#${id}`)
    .append('svg')
    .attr('role', 'img')
    .attr('aria-label', label)
    .attr('width',  w + ml + M.right)
    .attr('height', h + mt + M.bottom)
    .append('g')
    .attr('transform', `translate(${ml},${mt})`);
}

/* container inner width (excludes padding so SVG never overflows) */
function cw(id) {
  const el = document.getElementById(id);
  const cs = window.getComputedStyle(el);
  return el.clientWidth
    - parseFloat(cs.paddingLeft)
    - parseFloat(cs.paddingRight)
    - M.left - M.right;
}

/* y-gridlines helper */
function yGrid(svg, yScale, w) {
  svg.append('g').attr('class', 'grid')
    .call(d3.axisLeft(yScale).tickSize(-w).tickFormat(''))
    .call(g => g.selectAll('line').attr('stroke', 'rgba(255,80,0,0.07)').attr('stroke-dasharray', '3,4'))
    .call(g => g.select('.domain').remove());
}

/* populate <select> */
function fillSelect(id, vals, def) {
  const s = d3.select(`#${id}`);
  s.selectAll('option').remove();
  vals.forEach(v => s.append('option').attr('value', v).text(v));
  if (def != null) s.property('value', String(def));
}

/* axis label helpers */
function addYLabel(svg, label, h) {
  svg.append('text')
    .attr('transform', `rotate(-90) translate(${-h / 2}, ${-M.left + 14})`)
    .attr('text-anchor', 'middle')
    .attr('fill', 'var(--text-3)')
    .attr('font-size', '10px')
    .attr('font-family', "'JetBrains Mono', monospace")
    .attr('letter-spacing', '0.06em')
    .text(label);
}

function addXLabelHBar(svg, label, w, h, mb) {
  svg.append('text')
    .attr('x', w / 2).attr('y', h + mb - 6)
    .attr('text-anchor', 'middle')
    .attr('fill', 'var(--text-3)')
    .attr('font-size', '10px')
    .attr('font-family', "'JetBrains Mono', monospace")
    .attr('letter-spacing', '0.06em')
    .text(label);
}

/* Chart 1 & 5 year markers — updated by global year selector */
let trendRef = null;
let remoRef  = null;

/* Cross-filter state */
let rawData     = null;
let currentYear = null;
const filters   = { road_user: null, age_group: null, sex: null, remoteness: null };

/* FN chart state */
let fnMode          = 'absolute'; // 'absolute' | 'proportion'
let fnRemoteData    = null;
let fnCounterData   = null;

function updateTrendMarker(year) {
  if (!trendRef) return;
  const { svg, x, h } = trendRef;
  svg.selectAll('.year-marker').remove();
  const g = svg.append('g').attr('class', 'year-marker');
  g.append('line')
    .attr('x1', x(year)).attr('x2', x(year))
    .attr('y1', -M.top + 2).attr('y2', h)
    .attr('stroke', C.amber).attr('stroke-width', 1.8)
    .attr('stroke-dasharray', '5,3').attr('opacity', 0.55);
  const lw = 34;
  g.append('rect')
    .attr('x', x(year) - lw / 2).attr('y', -M.top + 2)
    .attr('width', lw).attr('height', 16).attr('rx', 2)
    .attr('fill', C.amber).attr('opacity', 0.9);
  g.append('text')
    .attr('x', x(year)).attr('y', -M.top + 13)
    .attr('text-anchor', 'middle')
    .attr('fill', '#1c0500').attr('font-size', '10px').attr('font-weight', '700')
    .attr('font-family', "'JetBrains Mono', monospace")
    .text(year);
}

/* CHART 1 — National Trend  (animated line + area) */
function drawTrend(data) {
  const w = cw('chart-trend');
  const h = Math.round(Math.min(360, w * 0.42));
  const svg = makeSVG('chart-trend', w, h, M.left, 48);

  const hasFilter = Object.values(filters).some(v => v != null);
  const x = d3.scaleLinear().domain([2011, 2021]).range([0, w]);
  const y = d3.scaleLinear()
    .domain([0, d3.max(data, d => d.hospitalisations) * 1.08])
    .nice().range([h, 0]);

  yGrid(svg, y, w);
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${h})`)
    .call(d3.axisBottom(x).tickFormat(d3.format('d')).ticks(11));
  svg.append('g').attr('class', 'axis')
    .call(d3.axisLeft(y).tickFormat(d => d3.format('.2s')(d)));
  addYLabel(svg, 'HOSPITALISATIONS', h);

  /* gradient def */
  const defs = svg.append('defs');
  const grad = defs.append('linearGradient')
    .attr('id', 'trend-fill').attr('gradientUnits', 'userSpaceOnUse')
    .attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', h);
  grad.append('stop').attr('offset', '0%')
    .attr('stop-color', C.orange).attr('stop-opacity', 0.28);
  grad.append('stop').attr('offset', '100%')
    .attr('stop-color', C.orange).attr('stop-opacity', 0);

  /* area */
  const area = d3.area()
    .x(d => x(d.year)).y0(h).y1(d => y(d.hospitalisations))
    .curve(d3.curveCatmullRom.alpha(0.5));
  svg.append('path').datum(data).attr('fill', 'url(#trend-fill)').attr('d', area);

  /* line — draw animation */
  const line = d3.line()
    .x(d => x(d.year)).y(d => y(d.hospitalisations))
    .curve(d3.curveCatmullRom.alpha(0.5));

  const path = svg.append('path').datum(data)
    .attr('fill', 'none').attr('stroke', C.orange)
    .attr('stroke-width', 2.5).attr('d', line);

  const len = path.node().getTotalLength();
  path.attr('stroke-dasharray', len).attr('stroke-dashoffset', len)
    .transition().duration(2200).ease(d3.easeCubicInOut)
    .attr('stroke-dashoffset', 0);

  /* dots */
  const base2011 = data.find(r => r.year === 2011)?.hospitalisations;
  svg.selectAll('.dot').data(data).join('circle')
    .attr('cx', d => x(d.year)).attr('cy', d => y(d.hospitalisations))
    .attr('r', 0).attr('fill', C.amber)
    .attr('stroke', C.red).attr('stroke-width', 1.5)
    .on('mouseover', (e, d) => {
      d3.select(e.currentTarget).transition().duration(120).attr('r', 7);
      const extra = base2011 && d.year !== 2011
        ? `${d3.format('+.1%')((d.hospitalisations - base2011) / base2011)} vs 2011`
        : 'baseline year';
      showTip(e, String(d.year), d.hospitalisations, extra);
    })
    .on('mousemove', moveTip)
    .on('mouseout', (e) => {
      d3.select(e.currentTarget).transition().duration(120).attr('r', 5);
      hideTip();
    })
    .transition().delay((_, i) => 2000 + i * 70).duration(300).attr('r', 5);

  /* annotations */
  const ann = (yr, label, dy = -14) => {
    const d = data.find(r => r.year === yr);
    if (!d) return;
    const g = svg.append('g').style('opacity', 0);
    g.append('line')
      .attr('x1', x(yr)).attr('x2', x(yr))
      .attr('y1', y(d.hospitalisations) + dy).attr('y2', y(d.hospitalisations) - 2)
      .attr('stroke', C.red).attr('stroke-width', 1).attr('stroke-dasharray', '3,2');
    const xPos = x(yr);
    const anchor = xPos > w * 0.75 ? 'end' : xPos < w * 0.25 ? 'start' : 'middle';
    g.append('text')
      .attr('x', xPos).attr('y', y(d.hospitalisations) + dy - 5)
      .attr('text-anchor', anchor).attr('fill', C.red)
      .attr('font-size', '10px').attr('font-weight', '700').text(label);
    g.transition().delay(2600).duration(400).style('opacity', 1);
  };
  if (!hasFilter) {
    ann(2021, 'Peak: 38,875', -36);
    ann(2020, 'COVID-19 ↓', -36);
  }

  /* regulation-change break markers */
  const regBreak = (yr, label) => {
    const xPos = x(yr);
    const g = svg.append('g').style('opacity', 0);
    g.append('line')
      .attr('x1', xPos).attr('x2', xPos)
      .attr('y1', 0).attr('y2', h)
      .attr('stroke', '#ffffff').attr('stroke-width', 1.2)
      .attr('stroke-dasharray', '5,4').attr('opacity', 0.30);
    g.append('text')
      .attr('transform', `translate(${xPos + 4}, ${h - 8}) rotate(-90)`)
      .attr('fill', '#cccccc').attr('font-size', '9px').attr('opacity', 0.65)
      .text(label);
    g.transition().delay(2600).duration(400).style('opacity', 1);
  };
  if (!hasFilter) {
    regBreak(2012, 'Regulation change');
    regBreak(2017, 'Regulation change');
  }

  trendRef = { svg, x, h };
}

function updateRemoMarker(year) {
  if (!remoRef) return;
  const { svg, x, h } = remoRef;
  svg.selectAll('.year-marker').remove();
  const g = svg.append('g').attr('class', 'year-marker');
  g.append('line')
    .attr('x1', x(year)).attr('x2', x(year))
    .attr('y1', -M.top + 2).attr('y2', h)
    .attr('stroke', C.amber).attr('stroke-width', 1.8)
    .attr('stroke-dasharray', '5,3').attr('opacity', 0.55);
  const lw = 34;
  g.append('rect')
    .attr('x', x(year) - lw / 2).attr('y', -M.top + 2)
    .attr('width', lw).attr('height', 16).attr('rx', 2)
    .attr('fill', C.amber).attr('opacity', 0.9);
  g.append('text')
    .attr('x', x(year)).attr('y', -M.top + 13)
    .attr('text-anchor', 'middle')
    .attr('fill', '#1c0500').attr('font-size', '10px').attr('font-weight', '700')
    .attr('font-family', "'JetBrains Mono', monospace")
    .text(year);
}

/* CHART 2 — Road Users  (horizontal bar, animated, year filter)*/
function drawRoadUsers(data, year) {
  const rows = data.filter(d => d.year === year)
    .sort((a, b) => b.hospitalisations - a.hospitalisations);
  const total = d3.sum(rows, d => d.hospitalisations);

  const container = document.getElementById('chart-road-users');
  const _cs1 = window.getComputedStyle(container);
  const totalW = container.clientWidth - parseFloat(_cs1.paddingLeft) - parseFloat(_cs1.paddingRight);
  const ml = 180, mr = 80, mt = 10, mb = 30;
  const w = totalW - ml - mr;
  const bH = 34, gap = 8;
  const h = rows.length * (bH + gap) - gap;

  d3.select('#chart-road-users').selectAll('svg').remove();
  const svg = d3.select('#chart-road-users').append('svg')
    .attr('role', 'img').attr('aria-label', 'Hospitalisations by Road User Type')
    .attr('width', totalW).attr('height', h + mt + mb)
    .append('g').attr('transform', `translate(${ml},${mt})`);

  const x = d3.scaleLinear()
    .domain([0, d3.max(rows, d => d.hospitalisations) * 1.12])
    .range([0, w]);

  const y = d3.scaleBand()
    .domain(rows.map(d => d.road_user))
    .range([0, h]).padding(gap / (bH + gap));

  /* vertical gridlines */
  svg.append('g').attr('class', 'grid')
    .attr('transform', `translate(0,${h})`)
    .call(d3.axisBottom(x).tickSize(-h).tickFormat(''))
    .call(g => g.selectAll('line').attr('stroke', 'rgba(255,80,0,0.07)').attr('stroke-dasharray', '3,4'))
    .call(g => g.select('.domain').remove());

  /* x-axis with ticks + label */
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${h})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat(d => d3.format('.2s')(d)));
  addXLabelHBar(svg, 'HOSPITALISATIONS', w, h, mb);

  /* y-axis labels */
  svg.append('g').attr('class', 'axis')
    .call(d3.axisLeft(y).tickSize(0))
    .call(g => g.select('.domain').remove())
    .selectAll('text')
    .attr('x', -8).attr('fill', '#c49285').attr('font-size', '12px');

  /* bars */
  const ruOpacity = d => !filters.road_user || filters.road_user === d.road_user ? 0.82 : 0.2;

  svg.selectAll('.bar').data(rows).join('rect')
    .attr('class', 'bar')
    .attr('y', d => y(d.road_user))
    .attr('height', y.bandwidth()).attr('rx', 2)
    .attr('fill', d => C.roadUser[d.road_user] || C.orange)
    .attr('opacity', ruOpacity)
    .style('cursor', 'pointer')
    .attr('x', 0).attr('width', 0)
    .on('click', (e, d) => {
      filters.road_user = filters.road_user === d.road_user ? null : d.road_user;
      redrawNational(currentYear);
    })
    .on('mouseover', (e, d) => {
      d3.select(e.currentTarget).attr('opacity', 1);
      showTip(e, d.road_user, d.hospitalisations,
        `${d3.format('.1%')(d.hospitalisations / total)} of total in ${year}`);
    })
    .on('mousemove', moveTip)
    .on('mouseout', (e, d) => { d3.select(e.currentTarget).attr('opacity', ruOpacity(d)); hideTip(); })
    .transition().duration(700).ease(d3.easeExpOut)
    .attr('width', d => x(d.hospitalisations));

  /* value labels + delta vs prior year */
  svg.selectAll('.blabel').data(rows).join('text')
    .attr('class', 'blabel')
    .attr('x', d => x(d.hospitalisations) + 6)
    .attr('y', d => y(d.road_user) + y.bandwidth() / 2 + 4)
    .attr('font-family', "'JetBrains Mono', monospace")
    .style('opacity', 0)
    .each(function(d) {
      const sel = d3.select(this);
      sel.append('tspan').attr('fill', C.amber).attr('font-size', '11px')
        .text(d3.format(',')(d.hospitalisations));
      const prev = data.find(r => r.road_user === d.road_user && r.year === year - 1);
      if (prev) {
        const pct = (d.hospitalisations - prev.hospitalisations) / prev.hospitalisations;
        sel.append('tspan')
          .attr('fill', pct >= 0 ? '#ff7733' : '#66cc66')
          .attr('font-size', '9px').attr('dx', 5)
          .text((pct >= 0 ? '▲' : '▼') + d3.format('.1%')(Math.abs(pct)));
      }
    })
    .transition().delay(560).duration(280).style('opacity', 1);
}

/*CHART 3 — Age & Sex  (grouped bar, year filter)*/
const AGE_ORDER = ['0-7', '8-16', '17-25', '26-39', '40-64', '65-74', '75+'];

function drawAgeSex(data, year) {
  const rows = data.filter(d => d.year === year);
  const w = cw('chart-age-sex');
  const h = Math.round(Math.min(340, w * 0.4));
  const svg = makeSVG('chart-age-sex', w, h);

  const x0 = d3.scaleBand().domain(AGE_ORDER).range([0, w])
    .paddingInner(0.28).paddingOuter(0.05);
  const x1 = d3.scaleBand().domain(['Male', 'Female'])
    .range([0, x0.bandwidth()]).padding(0.06);
  const y = d3.scaleLinear()
    .domain([0, d3.max(rows, d => d.hospitalisations) * 1.22])
    .nice().range([h, 0]);

  yGrid(svg, y, w);
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${h})`)
    .call(d3.axisBottom(x0));
  svg.append('g').attr('class', 'axis')
    .call(d3.axisLeft(y).tickFormat(d => d3.format('.2s')(d)));
  addYLabel(svg, 'HOSPITALISATIONS', h);

  const grouped = d3.group(rows, d => d.age_group);

  AGE_ORDER.forEach(age => {
    const ag = grouped.get(age) || [];
    ['Male', 'Female'].forEach(sex => {
      const d = ag.find(r => r.sex === sex);
      if (!d) return;
      const agOpacity = (!filters.age_group || filters.age_group === age) &&
                        (!filters.sex        || filters.sex        === sex) ? 0.82 : 0.2;
      svg.append('rect')
        .attr('x', x0(age) + x1(sex))
        .attr('y', h).attr('width', x1.bandwidth()).attr('height', 0).attr('rx', 2)
        .attr('fill', C.sex[sex]).attr('opacity', agOpacity)
        .style('cursor', 'pointer')
        .on('click', () => {
          const bothActive = filters.age_group === age && filters.sex === sex;
          filters.age_group = bothActive ? null : age;
          filters.sex = bothActive ? null : sex;
          redrawNational(currentYear);
        })
        .on('mouseover', (e) => {
          d3.select(e.currentTarget).attr('opacity', 1);
          showTip(e, `${age} — ${sex}`, d.hospitalisations, 'Click to filter by age + sex');
        })
        .on('mousemove', moveTip)
        .on('mouseout', (e) => { d3.select(e.currentTarget).attr('opacity', agOpacity); hideTip(); })
        .transition().duration(580).ease(d3.easeBackOut.overshoot(0.5))
        .attr('y', y(d.hospitalisations))
        .attr('height', h - y(d.hospitalisations));

      /* value label above bar */
      svg.append('text')
        .attr('x', x0(age) + x1(sex) + x1.bandwidth() / 2)
        .attr('y', h)
        .attr('text-anchor', 'middle')
        .attr('fill', C.sex[sex])
        .attr('font-size', '8px')
        .attr('font-family', "'JetBrains Mono', monospace")
        .attr('opacity', 0)
        .text(d3.format('.2s')(d.hospitalisations))
        .transition().duration(580).ease(d3.easeBackOut.overshoot(0.5))
        .attr('y', y(d.hospitalisations) - 4)
        .attr('opacity', agOpacity);
    });
  });

  /* legend — clickable for sex cross-filter */
  document.getElementById('legend-age-sex').innerHTML =
    ['Male', 'Female'].map(s => {
      const active = filters.sex === s;
      const dimmed = filters.sex && !active;
      return `<div class="legend-item legend-item--clickable"
                   role="button" tabindex="0"
                   aria-pressed="${active}"
                   aria-label="${active ? 'Remove' : 'Filter by'} ${s}"
                   onclick="toggleSexFilter('${s}')"
                   onkeydown="if(event.key==='Enter'||event.key===' '){toggleSexFilter('${s}');event.preventDefault();}"
                   style="cursor:pointer;opacity:${dimmed ? 0.3 : 1};
                          outline:${active ? '1px solid ' + C.sex[s] : 'none'};
                          border-radius:3px;padding:2px 6px;">
        <div class="legend-swatch" style="background:${C.sex[s]}"></div>
        <span>${s}</span>
      </div>`;
    }).join('');
}

/*CHART 4 — State  (horizontal bar, year filter)*/
function drawStates(data, year) {
  const rows = data.filter(d => d.year === year)
    .sort((a, b) => b.cases - a.cases);

  const container = document.getElementById('chart-states');
  const _cs2 = window.getComputedStyle(container);
  const totalW = container.clientWidth - parseFloat(_cs2.paddingLeft) - parseFloat(_cs2.paddingRight);
  const ml = 52, mr = 80, mt = 8, mb = 45;
  const w = totalW - ml - mr;
  const bH = 38, gap = 7;
  const h = rows.length * (bH + gap) - gap;

  d3.select('#chart-states').selectAll('svg').remove();
  const svg = d3.select('#chart-states').append('svg')
    .attr('role', 'img').attr('aria-label', 'Hospitalisations by State / Territory')
    .attr('width', totalW).attr('height', h + mt + mb)
    .append('g').attr('transform', `translate(${ml},${mt})`);

  const x = d3.scaleLinear()
    .domain([0, d3.max(rows, d => d.cases) * 1.12]).range([0, w]);
  const y = d3.scaleBand()
    .domain(rows.map(d => d.state)).range([0, h])
    .padding(gap / (bH + gap));

  /* vertical gridlines */
  svg.append('g').attr('class', 'grid')
    .attr('transform', `translate(0,${h})`)
    .call(d3.axisBottom(x).tickSize(-h).tickFormat(''))
    .call(g => g.selectAll('line').attr('stroke', 'rgba(255,80,0,0.07)').attr('stroke-dasharray', '3,4'))
    .call(g => g.select('.domain').remove());

  /* x-axis with ticks + label */
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${h})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat(d => d3.format('.2s')(d)));
  addXLabelHBar(svg, 'HOSPITALISATIONS (EXCL. IN-HOSPITAL DEATHS)', w, h, mb);

  svg.append('g').attr('class', 'axis')
    .call(d3.axisLeft(y).tickSize(0))
    .call(g => g.select('.domain').remove())
    .selectAll('text')
    .attr('x', -8).attr('fill', '#c49285')
    .attr('font-size', '13px').attr('font-weight', '700');

  svg.selectAll('.bar').data(rows).join('rect')
    .attr('class', 'bar')
    .attr('y', d => y(d.state)).attr('height', y.bandwidth()).attr('rx', 2)
    .attr('fill', (_, i) => C.seq(i / (rows.length - 1)))
    .attr('opacity', 0.82).attr('x', 0).attr('width', 0)
    .on('mouseover', (e, d) => {
      d3.select(e.currentTarget).attr('opacity', 1);
      showTip(e, `${d.state} — ${year}`, d.cases);
    })
    .on('mousemove', moveTip)
    .on('mouseout', (e) => { d3.select(e.currentTarget).attr('opacity', 0.82); hideTip(); })
    .transition().duration(680).ease(d3.easeExpOut)
    .attr('width', d => x(d.cases));

  svg.selectAll('.blabel').data(rows).join('text')
    .attr('class', 'blabel')
    .attr('x', d => x(d.cases) + 6)
    .attr('y', d => y(d.state) + y.bandwidth() / 2 + 4)
    .attr('font-family', "'JetBrains Mono', monospace")
    .style('opacity', 0)
    .each(function(d) {
      const sel = d3.select(this);
      sel.append('tspan').attr('fill', C.amber).attr('font-size', '11px')
        .text(d3.format(',')(d.cases));
      const prev = data.find(r => r.state === d.state && r.year === year - 1);
      if (prev) {
        const pct = (d.cases - prev.cases) / prev.cases;
        sel.append('tspan')
          .attr('fill', pct >= 0 ? '#ff7733' : '#66cc66')
          .attr('font-size', '9px').attr('dx', 5)
          .text((pct >= 0 ? '▲' : '▼') + d3.format('.1%')(Math.abs(pct)));
      }
    })
    .transition().delay(550).duration(280).style('opacity', 1);
}

/*CHART 5 — Remoteness  (stacked area, animated)*/
function drawRemoteness(data) {
  const keys = ['Major Cities', 'Regional', 'Remote'];
  const years = [...new Set(data.map(d => d.year))].sort((a, b) => a - b);

  const pivoted = years.map(yr => {
    const o = { year: yr };
    keys.forEach(k => {
      o[k] = data.find(d => d.year === yr && d.remoteness === k)?.hospitalisations ?? 0;
    });
    return o;
  });

  const stacked = d3.stack().keys(keys)(pivoted);
  const w = cw('chart-remoteness');
  const h = Math.round(Math.min(340, w * 0.42));
  const svg = makeSVG('chart-remoteness', w, h);

  const x = d3.scaleLinear().domain([2011, 2021]).range([0, w]);
  const y = d3.scaleLinear()
    .domain([0, d3.max(stacked[stacked.length - 1], d => d[1]) * 1.04])
    .nice().range([h, 0]);

  yGrid(svg, y, w);
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${h})`)
    .call(d3.axisBottom(x).tickFormat(d3.format('d')).ticks(11));
  svg.append('g').attr('class', 'axis')
    .call(d3.axisLeft(y).tickFormat(d => d3.format('.2s')(d)));
  addYLabel(svg, 'HOSPITALISATIONS', h);

  const area = d3.area()
    .x(d => x(d.data.year)).y0(d => y(d[0])).y1(d => y(d[1]))
    .curve(d3.curveCatmullRom.alpha(0.5));

  stacked.forEach(layer => {
    /* clip-path reveal animation per layer */
    const clipId = 'clip-rem-' + layer.key.replace(/\s+/g, '-');
    const defs = svg.append('defs');
    const clipRect = defs.append('clipPath').attr('id', clipId)
      .append('rect').attr('x', 0).attr('y', 0).attr('width', 0).attr('height', h + 20);

    const isActive = !filters.remoteness || filters.remoteness === layer.key;
    const remOpacity = isActive ? 0.72 : 0.2;
    svg.append('path').datum(layer)
      .attr('fill', C.remoteness[layer.key]).attr('opacity', remOpacity)
      .style('cursor', 'pointer')
      .attr('clip-path', `url(#${clipId})`)
      .attr('d', area)
      .on('click', () => {
        filters.remoteness = filters.remoteness === layer.key ? null : layer.key;
        redrawNational(currentYear);
      })
      .on('mousemove', (e, d) => {
        /* find nearest year by x */
        const mx = e.offsetX - M.left;
        const yr = Math.round(x.invert(mx));
        const pt = pivoted.find(p => p.year === yr);
        if (pt) showTip(e, `${layer.key} — ${yr}`, pt[layer.key]);
      })
      .on('mouseout', hideTip);

    clipRect.transition().duration(2000).ease(d3.easeCubicInOut).attr('width', w);
  });

  /* legend — clickable to filter */
  document.getElementById('legend-remoteness').innerHTML =
    keys.map(k => {
      const active = filters.remoteness === k;
      const dimmed = filters.remoteness && !active;
      return `<div class="legend-item legend-item--clickable"
                   role="button" tabindex="0"
                   aria-pressed="${active}"
                   onclick="toggleRemoFilter('${k}')"
                   onkeydown="if(event.key==='Enter'||event.key===' '){toggleRemoFilter('${k}');event.preventDefault();}"
                   style="cursor:pointer;opacity:${dimmed ? 0.3 : 1};
                          outline:${active ? '1px solid ' + C.remoteness[k] : 'none'};
                          border-radius:3px;padding:2px 6px;">
        <div class="legend-swatch" style="background:${C.remoteness[k]}"></div>
        <span>${k}</span>
      </div>`;
    }).join('');

  remoRef = { svg, x, h };
}

/* CHART 6a — FN vs Non-Indigenous by Remoteness  (grouped bar, proportion toggle)*/
function drawFN(data, year) {
  const rows = data.filter(d => d.year === year);
  const remCats = ['Major Cities', 'Regional', 'Remote'];
  const statuses = ['First Nations people', 'Non-Indigenous'];

  const groupTotals = {};
  statuses.forEach(st => {
    groupTotals[st] = d3.sum(rows.filter(r => r.fn_status === st), r => r.val) || 1;
  });
  const getValue = d => fnMode === 'proportion' ? d.val / groupTotals[d.fn_status] : d.val;
  const allVals = rows.map(getValue);

  /* sync toggle button state */
  const btn = document.getElementById('fn-remoteness-toggle');
  if (btn) {
    btn.textContent = fnMode === 'proportion' ? 'Abs Count' : '% of Group';
    btn.classList.toggle('active', fnMode === 'proportion');
    btn.onclick = () => {
      fnMode = fnMode === 'absolute' ? 'proportion' : 'absolute';
      drawFN(fnRemoteData, currentYear);
      drawFNCounterparty(fnCounterData, currentYear);
    };
  }

  const w = cw('chart-fn');
  const h = Math.round(Math.min(320, w * 0.38));
  const svg = makeSVG('chart-fn', w, h);

  const x0 = d3.scaleBand().domain(remCats).range([0, w])
    .paddingInner(0.32).paddingOuter(0.1);
  const x1 = d3.scaleBand().domain(statuses)
    .range([0, x0.bandwidth()]).padding(0.08);
  const y = d3.scaleLinear()
    .domain([0, d3.max(allVals) * 1.12]).nice().range([h, 0]);

  yGrid(svg, y, w);
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${h})`)
    .call(d3.axisBottom(x0));
  svg.append('g').attr('class', 'axis')
    .call(d3.axisLeft(y).tickFormat(d => fnMode === 'proportion' ? d3.format('.0%')(d) : d3.format(',')(d)));
  addYLabel(svg, fnMode === 'proportion' ? '% OF GROUP TOTAL' : 'HOSPITALISATIONS', h);

  remCats.forEach(rem => {
    statuses.forEach(st => {
      const d = rows.find(r => r.remoteness === rem && r.fn_status === st);
      if (!d) return;
      const val = getValue(d);
      svg.append('rect')
        .attr('x', x0(rem) + x1(st)).attr('y', h)
        .attr('width', x1.bandwidth()).attr('height', 0).attr('rx', 2)
        .attr('fill', C.fn[st]).attr('opacity', 0.82)
        .on('mouseover', (e) => {
          d3.select(e.currentTarget).attr('opacity', 1);
          const extra = fnMode === 'proportion'
            ? `${d3.format('.1%')(val)} of ${st === 'First Nations people' ? 'FN' : 'non-Indigenous'} total`
            : `${d3.format('.1%')(d.val / groupTotals[st])} of group total`;
          showTip(e, `${rem} — ${st}`, fnMode === 'proportion' ? d3.format('.1%')(val) : d.val, extra);
        })
        .on('mousemove', moveTip)
        .on('mouseout', (e) => { d3.select(e.currentTarget).attr('opacity', 0.82); hideTip(); })
        .transition().duration(600).ease(d3.easeBackOut.overshoot(0.5))
        .attr('y', y(val))
        .attr('height', h - y(val));
    });
  });

  document.getElementById('legend-fn').innerHTML =
    statuses.map(s =>
      `<div class="legend-item">
        <div class="legend-swatch" style="background:${C.fn[s]}"></div>
        <span>${s}</span>
      </div>`).join('');
}

/*CHART 6b — First Nations trend line */
function drawFNTrend(data) {
  const years = [...new Set(data.map(d => d.year))].sort((a, b) => a - b);
  const totals = years.map(yr => ({
    year: yr,
    fn: d3.sum(data.filter(d => d.year === yr && d.fn_status === 'First Nations people'), d => d.val),
  }));

  const w = cw('chart-fn-trend');
  const h = Math.round(Math.min(300, w * 0.36));
  const svg = makeSVG('chart-fn-trend', w, h);

  const x = d3.scaleLinear().domain([2011, 2021]).range([0, w]);
  const y = d3.scaleLinear()
    .domain([0, d3.max(totals, d => d.fn) * 1.15]).nice().range([h, 0]);

  /* gradient fill */
  const defs = svg.append('defs');
  const grad = defs.append('linearGradient')
    .attr('id', 'fn-fill').attr('gradientUnits', 'userSpaceOnUse')
    .attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', h);
  grad.append('stop').attr('offset', '0%').attr('stop-color', C.red).attr('stop-opacity', 0.3);
  grad.append('stop').attr('offset', '100%').attr('stop-color', C.red).attr('stop-opacity', 0);

  const area = d3.area().x(d => x(d.year)).y0(h).y1(d => y(d.fn))
    .curve(d3.curveCatmullRom.alpha(0.5));
  svg.append('path').datum(totals).attr('fill', 'url(#fn-fill)').attr('d', area);

  yGrid(svg, y, w);
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${h})`)
    .call(d3.axisBottom(x).tickFormat(d3.format('d')).ticks(11));
  svg.append('g').attr('class', 'axis')
    .call(d3.axisLeft(y).tickFormat(d => d3.format(',')(d)));
  addYLabel(svg, 'HOSPITALISATIONS', h);

  const line = d3.line().x(d => x(d.year)).y(d => y(d.fn))
    .curve(d3.curveCatmullRom.alpha(0.5));
  const path = svg.append('path').datum(totals)
    .attr('fill', 'none').attr('stroke', C.red).attr('stroke-width', 2.5).attr('d', line);

  const len = path.node().getTotalLength();
  path.attr('stroke-dasharray', len).attr('stroke-dashoffset', len)
    .transition().duration(2000).ease(d3.easeCubicInOut).attr('stroke-dashoffset', 0);

  svg.selectAll('.dot-fn').data(totals).join('circle')
    .attr('cx', d => x(d.year)).attr('cy', d => y(d.fn))
    .attr('r', 0).attr('fill', C.amber).attr('stroke', C.red).attr('stroke-width', 1.5)
    .on('mouseover', (e, d) => {
      d3.select(e.currentTarget).transition().duration(100).attr('r', 7);
      showTip(e, `First Nations — ${d.year}`, d.fn);
    })
    .on('mousemove', moveTip)
    .on('mouseout', (e) => {
      d3.select(e.currentTarget).transition().duration(100).attr('r', 5);
      hideTip();
    })
    .transition().delay((_, i) => 1900 + i * 70).duration(280).attr('r', 5);

  /* growth annotation */
  const first = totals[0], last = totals[totals.length - 1];
  const growth = (last.fn - first.fn) / first.fn;
  const g = svg.append('g').style('opacity', 0);
  g.append('text')
    .attr('x', x(last.year)).attr('y', y(last.fn) - 14)
    .attr('text-anchor', 'end').attr('fill', C.amber)
    .attr('font-size', '12px').attr('font-weight', '700')
    .text(`+${d3.format('.0%')(growth)} since 2011`);
  g.transition().delay(2300).duration(400).style('opacity', 1);
}

/*CHART 6c — FN vs Non-Indigenous by Counterparty (grouped bar) */
const CP_LABEL = {
  'Car, pick-up truck or van':        'Car / Truck',
  'Fixed or stationary object':       'Fixed Object',
  'Non-collision transport accident': 'Non-collision',
  'Other':                            'Other',
};

function drawFNCounterparty(data, year) {
  const rows = data.filter(d => d.year === year);
  const cats = ['Car, pick-up truck or van', 'Fixed or stationary object',
                'Non-collision transport accident', 'Other'];
  const statuses = ['First Nations people', 'Non-Indigenous'];

  const groupTotals = {};
  statuses.forEach(st => {
    groupTotals[st] = d3.sum(rows.filter(r => r.fn_status === st), r => r.val) || 1;
  });
  const getValue = d => fnMode === 'proportion' ? d.val / groupTotals[d.fn_status] : d.val;
  const allVals = rows.map(getValue);

  /* sync toggle button */
  const btn = document.getElementById('fn-counterparty-toggle');
  if (btn) {
    btn.textContent = fnMode === 'proportion' ? 'Abs Count' : '% of Group';
    btn.classList.toggle('active', fnMode === 'proportion');
  }

  const w = cw('chart-fn-counterparty');
  const h = Math.round(Math.min(320, w * 0.38));
  const svg = makeSVG('chart-fn-counterparty', w, h);

  const x0 = d3.scaleBand().domain(cats).range([0, w])
    .paddingInner(0.32).paddingOuter(0.1);
  const x1 = d3.scaleBand().domain(statuses)
    .range([0, x0.bandwidth()]).padding(0.08);
  const y = d3.scaleLinear()
    .domain([0, d3.max(allVals) * 1.12]).nice().range([h, 0]);

  yGrid(svg, y, w);
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${h})`)
    .call(d3.axisBottom(x0).tickFormat(k => CP_LABEL[k]));
  svg.append('g').attr('class', 'axis')
    .call(d3.axisLeft(y).tickFormat(d => fnMode === 'proportion' ? d3.format('.0%')(d) : d3.format(',')(d)));
  addYLabel(svg, fnMode === 'proportion' ? '% OF GROUP TOTAL' : 'HOSPITALISATIONS', h);

  cats.forEach(cat => {
    statuses.forEach(st => {
      const d = rows.find(r => r.counterparty === cat && r.fn_status === st);
      if (!d) return;
      const val = getValue(d);
      svg.append('rect')
        .attr('x', x0(cat) + x1(st)).attr('y', h)
        .attr('width', x1.bandwidth()).attr('height', 0).attr('rx', 2)
        .attr('fill', C.fn[st]).attr('opacity', 0.82)
        .on('mouseover', (e) => {
          d3.select(e.currentTarget).attr('opacity', 1);
          const extra = `${d3.format('.1%')(d.val / groupTotals[st])} of group total`;
          showTip(e, `${CP_LABEL[cat]} — ${st}`,
            fnMode === 'proportion' ? d3.format('.1%')(val) : d.val, extra);
        })
        .on('mousemove', moveTip)
        .on('mouseout', (e) => { d3.select(e.currentTarget).attr('opacity', 0.82); hideTip(); })
        .transition().duration(600).ease(d3.easeBackOut.overshoot(0.5))
        .attr('y', y(val))
        .attr('height', h - y(val));
    });
  });

  document.getElementById('legend-fn-counterparty').innerHTML =
    statuses.map(s =>
      `<div class="legend-item">
        <div class="legend-swatch" style="background:${C.fn[s]}"></div>
        <span>${s}</span>
      </div>`).join('');
}

/*SCROLL REVEAL*/
const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

/*SCROLL PROGRESS BAR*/
window.addEventListener('scroll', () => {
  const bar = document.getElementById('progress-bar');
  const scrolled = window.scrollY;
  const total = document.body.scrollHeight - window.innerHeight;
  bar.style.width = (scrolled / total * 100) + '%';
  /* navbar shadow */
  document.getElementById('navbar').classList.toggle('scrolled', scrolled > 20);
}, { passive: true });

/* HERO COUNTER ANIMATION */
function animateCounter(el, target, duration = 2000) {
  const start = performance.now();
  const fmt = d3.format(',');
  function step(now) {
    const t = Math.min((now - start) / duration, 1);
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;  // easeInOut
    el.textContent = fmt(Math.round(ease * target));
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ── Cross-filter engine ─────────────────────────────────────────────────── */

function filteredExcept(...excludeKeys) {
  return rawData.filter(d =>
    Object.entries(filters).every(([k, v]) =>
      excludeKeys.includes(k) || v == null || d[k] === v
    )
  );
}

function redrawNational(year) {
  /* Trend sees fully filtered data */
  const trend = Array.from(
    d3.rollup(filteredExcept(), v => d3.sum(v, d => d.hospitalisations), d => d.year),
    ([yr, h]) => ({ year: yr, hospitalisations: h })
  ).sort((a, b) => a.year - b.year);

  /* Each chart sees data filtered by every dimension EXCEPT its own */
  const roadUser = [];
  d3.rollup(filteredExcept('road_user'), v => d3.sum(v, d => d.hospitalisations), d => d.year, d => d.road_user)
    .forEach((m, yr) => m.forEach((h, ru) => roadUser.push({ year: yr, road_user: ru, hospitalisations: h })));

  const ageSex = [];
  d3.rollup(filteredExcept('age_group', 'sex'), v => d3.sum(v, d => d.hospitalisations), d => d.year, d => d.age_group, d => d.sex)
    .forEach((m1, yr) => m1.forEach((m2, ag) => m2.forEach((h, s) =>
      ageSex.push({ year: yr, age_group: ag, sex: s, hospitalisations: h }))));

  const remoteness = [];
  d3.rollup(filteredExcept('remoteness'), v => d3.sum(v, d => d.hospitalisations), d => d.year, d => d.remoteness)
    .forEach((m, yr) => m.forEach((h, rem) =>
      remoteness.push({ year: yr, remoteness: rem, hospitalisations: h })));

  drawTrend(trend);
  updateTrendMarker(year);
  drawRoadUsers(roadUser, year);
  drawAgeSex(ageSex, year);
  drawRemoteness(remoteness);
  updateRemoMarker(year);
  updateFilterBadges();
}

function updateFilterBadges() {
  const labelMap = { road_user: 'Road User', age_group: 'Age Group', sex: 'Sex', remoteness: 'Remoteness' };
  const active = Object.entries(filters).filter(([, v]) => v != null);
  const el = document.getElementById('filter-chips');
  if (el) {
    el.innerHTML = active.map(([k, v]) =>
      `<span class="filter-chip">${labelMap[k]}: <strong>${v}</strong>` +
      ` <button class="chip-x" aria-label="Remove ${labelMap[k]} filter" onclick="clearFilter('${k}')">✕</button></span>`
    ).join('');
  }
  const btn = document.getElementById('clear-all-filters');
  if (btn) btn.style.display = active.length ? '' : 'none';
}

window.clearFilter = function(key) {
  filters[key] = null;
  redrawNational(currentYear);
};

window.toggleSexFilter = function(s) {
  filters.sex = filters.sex === s ? null : s;
  redrawNational(currentYear);
};

window.clearAllFilters = function() {
  Object.keys(filters).forEach(k => filters[k] = null);
  redrawNational(currentYear);
};

window.toggleRemoFilter = function(k) {
  filters.remoteness = filters.remoteness === k ? null : k;
  redrawNational(currentYear);
};

/* MAIN — load all data, draw charts, wire selectors */
async function main() {
  try {
    /* load everything in parallel */
    const [raw, stateData, fnRemote, fnCounterparty] = await Promise.all([
      d3.csv('../data/National/national_total.csv', d => ({
        year:             +d['Calendar year'],
        remoteness:       d['ABS remoteness area'],
        age_group:        d['Age group'],
        sex:              d['Sex'],
        road_user:        d['Road user'],
        hospitalisations: +d['Sum(Hospitalisations)'],
      })),
      d3.csv('../data/State/state_annual.csv',
        d => ({ year: +d['calendar year'], state: d['state or territory'], cases: +d['Sum(count of cases excluding died in hospitals within 30 days)'] })),
      d3.csv('../data/FN/fn_by_remoteness.csv',
        d => ({ year: +d['Calendar year'], fn_status: d['First Nations status'], remoteness: d['ABS remoteness area'],
                val: +d['Sum(Hospitalisations)'] })),
      d3.csv('../data/FN/fn_by_counterparty.csv',
        d => ({ year: +d['Calendar year'], fn_status: d['First Nations status'],
                counterparty: d['Counterparty'], val: +d['Sum(Hospitalisations)'] })),
    ]);

    /* store raw for cross-filter engine — drop rows with unclassified dimensions */
    rawData = raw.filter(d => d.remoteness !== 'Missing' && d.age_group !== 'Missing');
    fnRemoteData  = fnRemote;
    fnCounterData = fnCounterparty;
    const years = [...new Set(raw.map(d => d.year))].sort((a, b) => a - b);
    const latest = Math.max(...years);
    currentYear = latest;

    /*  Hero counter  */
    animateCounter(document.getElementById('hero-counter'), d3.sum(raw, d => d.hospitalisations));

    /*  Static non-national chart  */
    drawFNTrend(fnRemote);

    /* Global year selector */
    fillSelect('global-year', years, latest);

    /* Initial draw — national charts + year-dependent charts */
    redrawNational(latest);
    drawStates(stateData, latest);
    drawFN(fnRemote, latest);
    drawFNCounterparty(fnCounterparty, latest);

    /* Hamburger nav toggle */
    const hamburger = document.getElementById('hamburger');
    const navLinks  = document.getElementById('nav-links');
    if (hamburger && navLinks) {
      hamburger.addEventListener('click', () => {
        const expanded = hamburger.getAttribute('aria-expanded') === 'true';
        hamburger.setAttribute('aria-expanded', String(!expanded));
        navLinks.classList.toggle('open', !expanded);
      });
      navLinks.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
          hamburger.setAttribute('aria-expanded', 'false');
          navLinks.classList.remove('open');
        });
      });
    }

    d3.select('#global-year').on('change', function () {
      currentYear = +this.value;
      redrawNational(currentYear);
      drawStates(stateData, currentYear);
      drawFN(fnRemote, currentYear);
      drawFNCounterparty(fnCounterparty, currentYear);
    });

    /* Responsive resize */
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        redrawNational(currentYear);
        drawStates(stateData, currentYear);
        drawFN(fnRemote, currentYear);
        drawFNCounterparty(fnCounterparty, currentYear);
        drawFNTrend(fnRemote);
      }, 220);
    });

  } catch (err) {
    console.error('Data load error:', err);
    document.body.insertAdjacentHTML('afterbegin',
      `<div style="position:fixed;top:60px;left:50%;transform:translateX(-50%);
        background:#1c0500;border:1px solid #ff2600;color:#ffaa00;padding:1rem 2rem;
        font-family:monospace;z-index:999;border-radius:3px;">
        Could not load data. Please serve this site from a local HTTP server
        (e.g. VS Code Live Server).
      </div>`);
  }
}

main();
