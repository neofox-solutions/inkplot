// Time scales: calendar ticks, labels that follow the tick, time zones and daylight saving, and both adapters agreeing.
import { LinearCurve } from './curve.ts';
import { lightTheme } from './themes.ts';
import assert from 'node:assert/strict';
import {
  Chart, CartesianPlane, Axis, LinearScale, DomainSeries, LinePath, ObjectDataSource, StringPlatform, IntlTimeScale, TemporalTimeScale, TimeScale,
  fromJSON, registry, toJSON, PanZoom, Refs,
} from './index.ts';
import { test } from 'vite-plus/test';

test("time", () => {
const T = (y: number, mo: number, d = 1, h = 0, mi = 0, s = 0, ms = 0) => Date.UTC(y, mo - 1, d, h, mi, s, ms);
const HOUR = 3600000, DAY = 24 * HOUR;
const factories = { Intl: (a: object) => new IntlTimeScale(a), Temporal: (a: object) => new TemporalTimeScale(a) } as const;
type Make = (typeof factories)[keyof typeof factories];
const ticksOf = (s: TimeScale, a: number, b: number, n = 6) => s.ticks({ min: a, max: b }, n);
const labelsOf = (s: TimeScale, a: number, b: number, n = 6) => s.labels(ticksOf(s, a, b, n));

for (const [name, make] of Object.entries(factories) as [string, Make][]) {
  const utc = make({}), ny = make({ timeZone: 'America/New_York' });

  // ── Minutes read as a time, and the tick that begins a day reads as a date.
  {
    const l = labelsOf(utc, T(2024, 6, 11, 22), T(2024, 6, 11, 22, 50));
    assert(l.every((x) => /^22:\d\d$/.test(x)), `${name}: ${l.join()}`);
    assert.deepEqual(l.slice(0, 3), ['22:00', '22:05', '22:10']);
    assert.deepEqual(labelsOf(utc, T(2024, 6, 10, 22), T(2024, 6, 12, 22)), ['Jun 11', '06:00', '12:00', '18:00', 'Jun 12', '06:00', '12:00', '18:00'], `${name}: hours with midnights`);
    assert.deepEqual(labelsOf(utc, T(2024, 1, 1), T(2025, 1, 1)), ['2024', 'Apr', 'Jul', 'Oct', '2025'], `${name}: months, and the new year`);
    assert.deepEqual(labelsOf(utc, T(1990, 1, 1), T(2090, 7, 1)), ['2000', '2020', '2040', '2060', '2080'], `${name}: years in nice steps`);
    const ms = labelsOf(utc, 1000, 1900);
    assert.deepEqual([ms[0], ms[1]], ['00:00:01.000', '00:00:01.200'], `${name}: sub-second`);
    assert.deepEqual(labelsOf(utc, T(2024, 6, 11, 22, 0, 0), T(2024, 6, 11, 22, 0, 30), 6)[1], '22:00:05');
    assert.deepEqual(ticksOf(utc, T(2020, 1, 1), T(2021, 1, 1), 1).length >= 1, true);
  }

  // ── Weeks start on the day they are told to.
  {
    const mondays = ticksOf(utc, T(2024, 6, 3), T(2024, 7, 8), 5);
    assert(mondays.length >= 4 && mondays.every((t) => new Date(t).getUTCDay() === 1), `${name}: ${mondays.map((t) => new Date(t).toISOString()).join()}`);
    assert(ticksOf(make({ weekStart: 0 }), T(2024, 6, 3), T(2024, 7, 8), 5).every((t) => new Date(t).getUTCDay() === 0), 'Sundays');
  }

  // ── Zones: midnight is the zone's, and a day is as long as the clocks make it.
  {
    const day = ticksOf(ny, T(2024, 6, 10, 12), T(2024, 6, 14, 12), 4);
    assert.deepEqual(day.slice(0, 2), [T(2024, 6, 11, 4), T(2024, 6, 12, 4)], `${name}: New York midnight is 04:00 UTC in June`);
    const spring = ticksOf(ny, T(2024, 3, 8, 12), T(2024, 3, 13, 12), 5);
    assert.deepEqual(spring.slice(1).map((t, i) => (t - spring[i]!) / HOUR), [24, 23, 24, 24].slice(0, spring.length - 1), `${name}: the day the clocks go forward has 23 hours`);
    const fall = ticksOf(ny, T(2024, 11, 1, 12), T(2024, 11, 6, 12), 5);
    assert(fall.slice(1).some((t, i) => t - fall[i]! === 25 * HOUR), `${name}: and 25 when they go back`);
    assert.deepEqual(labelsOf(ny, T(2024, 3, 9, 12), T(2024, 3, 12, 12), 3).slice(0, 3), ['Mar 10', 'Mar 11', 'Mar 12']);

    const india = make({ timeZone: 'Asia/Kolkata' }), h = ticksOf(india, T(2024, 6, 11, 0), T(2024, 6, 11, 6), 6);
    assert(h.every((t) => new Date(t).getUTCMinutes() === 30), `${name}: Kolkata hours begin at :30 UTC`);
    assert(india.labels(h).every((x) => /^\d\d:00$/.test(x)), `${name}: and read :00`);
    assert.deepEqual(labelsOf(make({ timeZone: 'Asia/Kathmandu' }), T(2024, 6, 11, 0), T(2024, 6, 11, 6), 6)[0], '06:00', 'a +05:45 zone');

    const lord = make({ timeZone: 'Australia/Lord_Howe' }), lh = ticksOf(lord, T(2024, 4, 6, 12), T(2024, 4, 6, 18), 6);   // the clocks go back half an hour on 7 April
    assert(lord.labels(lh).every((x) => /^(\d\d:00|Apr 7)$/.test(x)), `${name}: ${lord.labels(lh).join()}`);
    assert(lh.every((v, i) => i === 0 || v > lh[i - 1]!), 'in order');
    assert(make({ timeZone: 'local' }).labels([T(2024, 6, 11)]).length === 1, 'local is accepted');
  }

  // ── The reading of an instant, in the locale and with formats replaced.
  {
    assert.equal(utc.label(T(2024, 6, 11, 22, 10, 5)), 'Jun 11, 2024, 22:10:05 UTC');
    assert.equal(ny.label(T(2024, 3, 10, 12, 30)), 'Mar 10, 2024, 08:30:00 EDT');
    assert(make({ locale: 'de-DE' }).label(T(2024, 6, 11, 22))!.startsWith('11.'), 'a German date');
    const custom = make({ formats: { day: { day: '2-digit' } } });
    assert.deepEqual(labelsOf(custom, T(2024, 6, 10, 22), T(2024, 6, 12, 22)).filter((x) => /^\d\d$/.test(x)), ['11', '12']);
  }

  // ── `nice` rounds out to the ticks, and ticks stay inside the range.
  {
    assert.deepEqual(utc.nice({ min: T(2024, 6, 11, 22, 3), max: T(2024, 6, 11, 22, 47) }), { min: T(2024, 6, 11, 22), max: T(2024, 6, 11, 23) });
    const r = { min: T(2024, 2, 13, 5), max: T(2024, 9, 2, 17) }, n = utc.nice(r);
    assert(n.min <= r.min && n.max >= r.max && new Date(n.min).getUTCDate() === 1 && new Date(n.max).getUTCDate() === 1, 'month ends');
    assert.deepEqual(utc.nice({ min: 5, max: 5 }), { min: 5, max: 5 });
    assert.deepEqual(utc.ticks({ min: 5, max: 5 }, 5), []);
    for (const t of ticksOf(ny, T(2024, 1, 1), T(2024, 12, 1))) assert(t >= T(2024, 1, 1) && t <= T(2024, 12, 1));
  }
}

// ── The two agree: the same ticks and the same words, for any zone and any span.
{
  const zones = ['UTC', 'America/New_York', 'Europe/London', 'Asia/Kolkata', 'Australia/Lord_Howe', 'Asia/Kathmandu', 'Pacific/Chatham', 'Australia/Sydney'];
  let seed = 7;
  const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  let checked = 0;
  for (let k = 0; k < 400; k++) {
    const zone = zones[k % zones.length]!, a = T(1970, 1, 1) + rand() * 70 * 365 * DAY, span = Math.exp(Math.log(2000) + rand() * (Math.log(40 * 365 * DAY) - Math.log(2000)));
    const i = new IntlTimeScale({ timeZone: zone }), t = new TemporalTimeScale({ timeZone: zone });
    const ti = ticksOf(i, a, a + span, 4 + (k % 7)), tt = ticksOf(t, a, a + span, 4 + (k % 7));
    assert.deepEqual(ti, tt, `${zone} ${new Date(a).toISOString()} +${span}`);
    assert.deepEqual(i.labels(ti), t.labels(tt));
    assert.deepEqual(i.nice({ min: a, max: a + span }), t.nice({ min: a, max: a + span }));
    checked += ti.length;
  }
  assert(checked > 1500);
}

// ── On an axis: ISO strings as data, labels from the whole set, hand-made ticks, `format`, panning through the levels, and JSON.
{
  const rows = [0, 1, 2, 3, 4, 5].map((i) => ({ at: new Date(T(2024, 6, 10, 18) + i * 6 * HOUR).toISOString(), y: [3, 5, 4, 6, 2, 5][i]! }));
  const source = new ObjectDataSource({ source: rows, domain: (r: { at: string; y: number }) => Date.parse(r.at), value: 'y' });
  const x = new Axis({ orientation: 'bottom' }, new IntlTimeScale({ timeZone: 'Europe/London' }));
  const plane = new CartesianPlane({}, x, new Axis({ orientation: 'left' }, new LinearScale()), new DomainSeries({}, source, new LinePath(new LinearCurve())), new PanZoom({}));
  const chart = new Chart({ theme: lightTheme, width: 600, height: 300 }, plane);
  const platform = new StringPlatform({ width: 600, height: 300 });
  chart.attach(platform);
  chart.flush();
  const ticks = x.getTicks(500);
  assert(ticks.length >= 4 && ticks.every((tk) => tk.value >= x.range.min && tk.value <= x.range.max));
  assert(ticks.some((tk) => tk.label === 'Jun 11'), `a midnight (London, BST) says its date: ${ticks.map((tk) => tk.label).join()}`);
  assert(ticks.some((tk) => /^\d\d:00$/.test(tk.label)));
  assert(platform.toString().includes('>Jun 11<'), 'drawn');
  assert.equal(x.formatValue(T(2024, 6, 11, 12)), 'Jun 11, 2024, 13:00:00 GMT+1', 'a reading is in the zone');

  const hand = new Axis({ orientation: 'bottom', min: T(2024, 6, 10), max: T(2024, 6, 13), ticks: [T(2024, 6, 10, 12), T(2024, 6, 11), T(2024, 6, 12)] }, new IntlTimeScale());
  mountOnly(hand);
  assert.deepEqual(hand.getTicks(400).map((tk) => tk.label), ['12:00', 'Jun 11', 'Jun 12'], 'hand-made ticks get labels in context');
  const fmt = new Axis({ orientation: 'bottom', min: T(2024, 6, 10), max: T(2024, 6, 13), format: (v: number) => String(new Date(v).getUTCDate()) }, new IntlTimeScale());
  mountOnly(fmt);
  assert(fmt.getTicks(400).every((tk) => /^\d+$/.test(tk.label)), 'an axis format beats the scale');
  const step = new Axis({ orientation: 'bottom', min: T(2024, 6, 10), max: T(2024, 6, 11), tickStep: 6 * HOUR }, new IntlTimeScale());
  mountOnly(step);
  assert.deepEqual(step.getTicks(400).map((tk) => tk.label), ['Jun 10', '06:00', '12:00', '18:00', 'Jun 11']);

  const refs = new Refs({}, { auto: true });   // the ISO-string reader is a function, which JSON holds by name
  const json = JSON.parse(JSON.stringify(toJSON(chart, registry, { refs })));
  assert(JSON.stringify(json).includes('"timeZone":"Europe/London"'));
  const back = fromJSON<Chart>(json, registry, { refs });
  assert.deepEqual(JSON.parse(JSON.stringify(toJSON(back, registry, { refs }))), json, 'round trip');
}
function mountOnly(a: Axis) {
  const chart = new Chart({ theme: lightTheme, width: 400, height: 300 }, new CartesianPlane({}, a, new Axis({ orientation: 'left' }, new LinearScale()), new DomainSeries({}, new ObjectDataSource({ source: [{ x: 0, y: 1 }], domain: 'x', value: 'y' }), new LinePath(new LinearCurve()))));
  chart.attach(new StringPlatform({ width: 400, height: 300 }));
  chart.flush();
}

// ── A runtime without Temporal says what to do; a stand-in can be given.
{
  const real = (globalThis as { Temporal?: unknown }).Temporal;
  (globalThis as { Temporal?: unknown }).Temporal = undefined;
  try {
    assert.throws(() => new TemporalTimeScale({}).ticks({ min: 0, max: DAY }, 5), /no Temporal/);
    assert.equal(new TemporalTimeScale({ temporal: real as never }).ticks({ min: 0, max: DAY }, 5).length > 0, true);
  } finally { (globalThis as { Temporal?: unknown }).Temporal = real; }
}
});
