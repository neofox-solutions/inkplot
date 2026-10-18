// Serialization: the registry, what attributes may hold, refs, reading errors that say where, and changing a live tree.
import { LinearCurve } from './curve.ts';
import { lightTheme, darkTheme } from './themes.ts';
import assert from 'node:assert/strict';
import { hasOwn } from './attrs.ts';
import { readdirSync, readFileSync } from 'node:fs';
import * as L from './index.ts';
import {
  Chart,
  CartesianPlane,
  PolarPlane,
  Axis,
  LinearScale,
  DomainSeries,
  LinePath,
  AreaPath,
  BarPath,
  FlatDataSource,
  ObjectDataSource,
  Decimator,
  MinMaxKernel,
  Stack,
  ChartTitle,
  ChartTooltip,
  Cursor,
  Crosshair,
  LineAnnotation,
  PanZoom,
  PointerListener,
  ColorAxis,
  ColorKey,
  CircleMarker,
  ChartElement,
  Refs,
  registry,
  toJSON,
  fromJSON,
  applyJSON,
  toSvgString,
  type ElementJSON,
  type ElementRegistry,
} from './index.ts';
import { test } from 'vite-plus/test';

test('serialize', () => {
  // ── Every concrete element class the library exports is in the registry, so a new class cannot be forgotten.
  {
    const abstract = new Set<string>();
    for (const file of readdirSync(new URL('./', import.meta.url)).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      for (const m of readFileSync(new URL(file, import.meta.url), 'utf8').matchAll(/export abstract class (\w+)/g)) abstract.add(m[1]!);
    }
    const missing = Object.entries(L)
      .filter(
        ([name, v]) => typeof v === 'function' && v.prototype instanceof ChartElement && !abstract.has(name) && !hasOwn(registry, name),
      )
      .map(([n]) => n);
    assert.deepEqual(missing, [], 'concrete classes missing from registry.ts');
    for (const [name, ctor] of Object.entries(registry))
      assert.equal((ctor as { name: string }).name, name, `${name} is registered under its own name`);
    assert(abstract.has('Series') && !hasOwn(registry, 'Series'));
  }

  const size = { width: 480, height: 320 };
  /** Clip ids count up across charts in a process, so they differ between two charts that draw the same. */
  const same = (svg: string) => svg.replace(/clip\d+/g, 'clip').replace(/grad\d+/g, 'grad');

  // ── Refs.
  {
    const f = () => 1,
      o = { a: 1 };
    const refs = new Refs({ f });
    assert.equal(refs.get('f'), f);
    assert.equal(refs.nameOf(f), 'f');
    assert.equal(refs.nameOf(o), undefined);
    refs.set('alias', f);
    assert.equal(refs.nameOf(f), 'f', 'the first name stands, the second also reads back');
    assert.equal(refs.get('alias'), f);
    assert.throws(() => refs.set('f', o), /already names something else/);
    assert.throws(() => refs.set('n', 3), /only objects and functions/);
    assert.throws(() => refs.get('nope'), /no ref named "nope" \(known: f, alias\)/);
    assert.equal(refs.adopt(o, 'rows'), 'rows');
    assert.equal(refs.adopt(o, 'other'), 'rows', 'a value is only named once');
    assert.equal(refs.adopt([], 'rows'), 'rows2', 'names stay unique');
    assert.equal(new Refs().adopt(f), 'ref');
    refs.forget('rows');
    assert.equal(refs.has('rows'), false);
    assert.equal(refs.nameOf(o), undefined, 'a forgotten value is nameless again');
    assert.equal(refs.adopt(o, 'rows'), 'rows', 'and its name can be taken again');
    refs.forget('alias');
    assert.equal(refs.nameOf(f), 'f', 'forgetting one of two names leaves the other');
  }

  // ── Values: plain data, numbers JSON has no word for, typed arrays with gaps, elements by id.
  {
    const axis = new Axis({ id: 'x', orientation: 'bottom' }, new LinearScale());
    const source = new FlatDataSource({ data: new Float64Array([1, NaN, -Infinity, 4]), regularDomain: { start: 0, step: 1 } });
    const series = new DomainSeries(
      { name: 'a', domainAxis: axis, hit: { radius: 4 }, style: { seriesLine: { dash: '4 2' } } },
      source,
      new LinePath({ strokeWidth: Infinity }, new LinearCurve()),
    );
    const plane = new CartesianPlane({}, axis, new Axis({ orientation: 'left' }, new LinearScale()), series);
    const json = toJSON(new Chart({ theme: lightTheme }, plane), registry);
    const text = JSON.stringify(json);
    const parsed = JSON.parse(text) as ElementJSON;
    const s = parsed.children![0]!.children![2]!;
    assert.equal(s.type, 'DomainSeries');
    assert.equal(s.attrs!.domainAxis, 'x', 'an element is its id');
    assert.deepEqual(s.attrs!.hit, { radius: 4 });
    assert.deepEqual(s.children![0]!.attrs!.data, { $typed: 'Float64Array', data: [1, null, '-Infinity', 4] });
    assert.deepEqual(s.children![1]!.attrs, { strokeWidth: { $number: 'Infinity' } });
    const back = fromJSON<Chart>(parsed, registry);
    const src = [...[...[...back][0]!][2]!][0] as FlatDataSource;
    const data = src.attrs.data as Float64Array;
    assert(data instanceof Float64Array);
    assert.deepEqual([data[0], data[1], data[2], data[3]], [1, NaN, -Infinity, 4]);
    assert.equal(([...[...[...back][0]!][2]!][1] as LinePath).attrs.strokeWidth, Infinity);
    // Elements without an id cannot be named; the message says which attribute.
    const anon = new Axis({ orientation: 'bottom' }, new LinearScale());
    const bad = new Chart(
      { theme: lightTheme },
      new CartesianPlane(
        {},
        anon,
        new Axis({ orientation: 'left' }, new LinearScale()),
        new DomainSeries({ domainAxis: anon }, new FlatDataSource({ data: Float64Array.of(1) }), new LinePath(new LinearCurve())),
      ),
    );
    assert.throws(() => toJSON(bad, registry), /children\[0\]\.children\[2\]\.attrs\.domainAxis: refers to a Axis that has no id/);
  }

  // ── Code and data by reference; the line between data and configuration; named themes read back as the same object.
  {
    const format = (v: number) => v.toFixed(1),
      rows = Array.from({ length: 5 }, (_, i) => ({ x: i, y: i * i }));
    const make = () =>
      new Chart(
        { theme: lightTheme, onFlush: () => {} },
        new CartesianPlane(
          {},
          new Axis({ orientation: 'bottom', format }, new LinearScale()),
          new Axis({ orientation: 'left' }, new LinearScale()),
          new DomainSeries({}, new ObjectDataSource({ source: rows, domain: 'x', value: 'y' }), new LinePath(new LinearCurve())),
        ),
      );
    assert.throws(() => toJSON(make(), registry), /attrs\.onFlush: a function, which JSON cannot hold: name it in `refs`/);
    assert.throws(
      () => toJSON(make(), registry, { refs: new Refs() }),
      /attrs\.onFlush: a function/,
      'refs that do not name it do not help',
    );
    const refs = new Refs({ lightTheme }, { auto: true });
    const json = toJSON(make(), registry, { refs, inlineLimit: 3 });
    assert.deepEqual(json.attrs!.theme, { $ref: 'lightTheme' }, 'a named theme is a name');
    assert.deepEqual(json.attrs!.onFlush, { $ref: 'onFlush' });
    assert.deepEqual(json.children![0]!.children![0]!.attrs!.format, { $ref: 'format' }, 'named after the attribute');
    assert.deepEqual(
      json.children![0]!.children![2]!.children![0]!.attrs!.source,
      { $ref: 'source' },
      'more than the inline limit: data, by reference',
    );
    assert.deepEqual([...refs.names].sort(), ['format', 'lightTheme', 'onFlush', 'source']);
    const roundTrip = fromJSON<Chart>(JSON.parse(JSON.stringify(json)), registry, { refs });
    assert.equal(roundTrip.attrs.theme, lightTheme);
    assert.equal(([...[...roundTrip][0]!][0] as Axis).attrs.format, format);
    assert.equal(([...[...[...roundTrip][0]!][2]!][0] as ObjectDataSource).attrs.source, rows, 'the very array, not a copy of it');
    // Without the table, reading says what it was looking for and where.
    assert.throws(() => fromJSON(json, registry), /attrs\.theme: refers to "lightTheme", and no refs were given/);
    assert.throws(
      () => fromJSON(json, registry, { refs: new Refs({ lightTheme }) }),
      /attrs\.onFlush: no ref named "onFlush" \(known: lightTheme\)/,
    );
    // Under the limit the rows are written out, and read back as an equal copy.
    const inline = toJSON(make(), registry, { refs: new Refs({ lightTheme }, { auto: true }) });
    assert.deepEqual(inline.children![0]!.children![2]!.children![0]!.attrs!.source, rows);
  }

  // ── Reading says where it went wrong.
  {
    const ok: ElementJSON = {
      type: 'Chart',
      attrs: { theme: { $ref: 't' } },
      children: [
        { type: 'CartesianPlane', children: [{ type: 'Axis', attrs: { orientation: 'bottom' }, children: [{ type: 'LinearScale' }] }] },
      ],
    };
    const opts = { refs: new Refs({ t: lightTheme }) };
    assert(fromJSON(ok, registry, opts) instanceof Chart);
    const at = (mutate: (j: ElementJSON) => void) => {
      const j = JSON.parse(JSON.stringify(ok)) as typeof ok;
      mutate(j);
      return () => fromJSON(j, registry, opts);
    };
    assert.throws(
      at((j) => {
        j.children![0]!.children![0]!.children![0]!.type = 'LinearScal';
      }),
      /children\[0\]\.children\[0\]\.children\[0\]: unknown type "LinearScal" \(did you mean LinearScale/,
    );
    assert.throws(
      at((j) => {
        j.children![0]!.children![0]!.attrs = { format: { $ref: 'x' } };
      }),
      /children\[0\]\.children\[0\]\.attrs\.format: no ref named "x"/,
    );
    assert.throws(
      at((j) => {
        j.children![0]!.children![0]!.attrs = { a: { $wat: 1 } };
      }),
      /attrs\.a: unknown marker "\$wat"/,
    );
    assert.throws(
      at((j) => {
        j.children![0]!.children![0]!.attrs = { a: { $number: 'many' } };
      }),
      /\$number has to be/,
    );
    assert.throws(
      at((j) => {
        j.children![0]!.children![0]!.attrs = { a: { $typed: 'Nope', data: [] } };
      }),
      /\$typed value is/,
    );
    assert.throws(
      at((j) => {
        (j as unknown as { children: unknown }).children = 'x';
      }),
      /"children" has to be an array/,
    );
    assert.throws(
      at((j) => {
        delete (j as Partial<ElementJSON>).type;
      }),
      /needs a "type"/,
    );
    assert.throws(() => fromJSON(null as unknown as ElementJSON, registry), /an element is an object/);
    assert.throws(() => fromJSON({ type: 'toString' }, registry), /unknown type "toString"/, 'the registry is not the Object prototype');
    // Reserved keys cannot be written by accident; classes of your own need registering.
    const reserved = new Chart({ theme: lightTheme, meta: { $x: 1 } as never });
    assert.throws(() => toJSON(reserved, registry, { refs: new Refs({ lightTheme }) }), /the key "\$x" is reserved/);
    class Mine extends ChartElement<Chart, [], {}> {}
    const withMine = new Chart({ theme: lightTheme }, ...([] as never[]));
    withMine.append(new Mine({}) as never);
    assert.throws(
      () => toJSON(withMine, registry, { refs: new Refs({ lightTheme }) }),
      /children\[0\]: Mine is not in the registry: add it, as in \{ \.\.\.registry, Mine \}/,
    );
    const custom: ElementRegistry = { ...registry, Mine };
    const j = toJSON(withMine, custom, { refs: new Refs({ lightTheme }) });
    assert.equal(j.children![0]!.type, 'Mine');
    assert([...fromJSON<Chart>(j, custom, { refs: new Refs({ lightTheme }) })][0] instanceof Mine);
  }

  // ── A whole chart survives: features from every corner of the library draw the same after a trip through JSON text.
  function everything() {
    const ys = Float64Array.from({ length: 60 }, (_, i) => Math.sin(i / 6) * 4 + (i % 17 === 0 ? NaN : 5));
    const d = new Axis({ id: 'd', orientation: 'bottom', title: 'x', min: 0, max: 59 }, new LinearScale());
    const v = new Axis({ id: 'v', orientation: 'left', title: 'y', nice: true }, new LinearScale());
    const heat = new ColorAxis({ id: 'heat' }, new LinearScale());
    const line = new DomainSeries(
      { name: 'raw', hit: 'line' },
      new Decimator({}, new MinMaxKernel(), new FlatDataSource({ data: ys, regularDomain: { start: 0, step: 1 } })),
      new LinePath({ stroke: 'teal' }, new LinearCurve()),
    );
    const dots = new DomainSeries(
      { name: 'dots', hit: false },
      new ObjectDataSource({
        source: [
          { t: 3, y: 6, c: 1 },
          { t: 30, y: 2, c: 9 },
        ],
        domain: 't',
        value: 'y',
        channels: { c: 'c' },
      }),
      new CircleMarker({ bind: { fill: { axis: heat, channel: 'c' } } }),
    );
    const bars = [
      new DomainSeries(
        { name: 'p' },
        new FlatDataSource({ data: Float64Array.of(1, 2, 3), regularDomain: { start: 10, step: 1 } }),
        new BarPath({}),
      ),
      new DomainSeries(
        { name: 'q' },
        new FlatDataSource({ data: Float64Array.of(3, 1, 2), regularDomain: { start: 10, step: 1 } }),
        new AreaPath({}, new LinearCurve()),
      ),
    ];
    return new Chart(
      { theme: lightTheme, padding: { top: 20 } },
      new CartesianPlane(
        { frame: true },
        d,
        v,
        line,
        dots,
        new Stack({ mode: 'stack' }, ...bars),
        new LineAnnotation({ value: 4 }),
        new PointerListener({ dragThreshold: 5 }),
        new PanZoom({ along: 'x' }),
      ),
      heat,
      new ColorKey({ dimension: heat }),
      new ChartTitle({ text: 'All of it' }),
      new Cursor({ mode: 'shared' }, new Crosshair({ lines: 'first' }), new ChartTooltip({})),
    );
  }
  {
    const refs = new Refs({ lightTheme, darkTheme });
    const json = toJSON(everything(), registry, { refs });
    const wire = JSON.parse(JSON.stringify(json)) as ElementJSON;
    assert.deepEqual(wire, json, 'plain JSON: text and back changes nothing');
    const copy = fromJSON<Chart>(wire, registry, { refs });
    assert.equal(same(toSvgString(copy, size)), same(toSvgString(everything(), size)), 'the copy draws what the original draws');
    assert.deepEqual(toJSON(copy, registry, { refs }), json, 'and writes the same JSON');
    // The polar plane and the rest of the shapes of a tree too.
    const polar = new Chart(
      { theme: darkTheme },
      new PolarPlane(
        {},
        new Axis({ orientation: 'angle', min: 0, max: 3 }, new LinearScale()),
        new Axis({ orientation: 'radius' }, new LinearScale()),
        new DomainSeries({}, new FlatDataSource({ data: Float64Array.of(1, 3, 2), regularDomain: { start: 0, step: 1 } }), new BarPath({})),
      ),
    );
    assert.equal(same(toSvgString(fromJSON(toJSON(polar, registry, { refs }), registry, { refs }), size)), same(toSvgString(polar, size)));
    assert.equal(JSON.stringify(json).includes('Float64Array'), true);
  }

  // ── applyJSON changes a live tree to match, and only as much as differs.
  {
    const rows = [
      { x: 0, y: 1 },
      { x: 1, y: 3 },
    ];
    const make = () => {
      const source = new ObjectDataSource({ source: rows, domain: 'x', value: 'y' });
      const line = new LinePath({ stroke: 'teal' }, new LinearCurve());
      const plane = new CartesianPlane(
        {},
        new Axis({ id: 'x', orientation: 'bottom' }, new LinearScale()),
        new Axis({ id: 'y', orientation: 'left' }, new LinearScale()),
        new DomainSeries({ name: 's' }, source, line),
      );
      const chart = new Chart({ theme: lightTheme, width: 400, height: 300 }, plane);
      return { chart, plane, source, line };
    };
    const refs = new Refs({ lightTheme });
    const t = make();
    const platform = new L.StringPlatform({ width: 400, height: 300 });
    t.chart.attach(platform);
    t.chart.flush();
    const edit = (f: (j: ElementJSON) => void) => {
      const j = toJSON(t.chart, registry, { refs });
      f(j);
      return j;
    };
    const plane = (j: ElementJSON) => j.children![0]!;
    const series = (j: ElementJSON) => plane(j).children![2]!;

    // Nothing changed, nothing written: not an attribute, not a fill.
    applyJSON(
      t.chart,
      edit(() => {}),
      registry,
      { refs },
    );
    const quiet = t.chart.flush();
    assert.deepEqual([quiet.attributeWrites, quiet.filled], [0, 0], 'applying what is already there does nothing');
    assert.equal(t.source.attrs.source, rows, 'an unchanged inline value is not replaced by a copy of itself');

    // An attribute changes, one is removed, one is added: the same elements, drawn differently.
    applyJSON(
      t.chart,
      edit((j) => {
        series(j).children![1]!.attrs = { stroke: 'crimson', strokeWidth: 3 };
        series(j).attrs = {};
        j.attrs = { ...j.attrs, width: 320 };
      }),
      registry,
      { refs },
    );
    t.chart.flush();
    assert.equal(t.line.attrs.stroke, 'crimson');
    assert.equal(t.line.attrs.strokeWidth, 3);
    assert.equal(t.chart.attrs.width, 320);
    assert.equal(t.plane.series[0]!.attrs.name, undefined, 'removed from the JSON, removed from the element');
    assert(platform.toString().includes('stroke="crimson"'));

    // Children: a renderer's type changes (replaced in place), one is added at the end, one taken away.
    applyJSON(
      t.chart,
      edit((j) => {
        series(j).children![1]!.type = 'AreaPath';
        plane(j).children!.push({ type: 'LineAnnotation', attrs: { value: 2 } });
      }),
      registry,
      { refs },
    );
    t.chart.flush();
    const kinds = () => [...t.plane].map((c) => c.constructor.name);
    assert.deepEqual(kinds(), ['Axis', 'Axis', 'DomainSeries', 'LineAnnotation']);
    assert.equal([...t.plane.series[0]!][1]!.constructor.name, 'AreaPath');
    assert(platform.toString().includes('class') || platform.toString().includes('<path'));
    applyJSON(
      t.chart,
      edit((j) => {
        plane(j).children!.pop();
      }),
      registry,
      { refs },
    );
    t.chart.flush();
    assert.deepEqual(kinds(), ['Axis', 'Axis', 'DomainSeries']);

    // A bad edit changes nothing at all, wherever in the tree it is: not the attributes before it, not the children.
    const before = JSON.stringify(toJSON(t.chart, registry, { refs }));
    assert.throws(
      () =>
        applyJSON(
          t.chart,
          edit((j) => {
            j.attrs = { ...j.attrs, width: 100 };
            plane(j).children!.push({ type: 'LineAnnotation', attrs: { value: { $ref: 'missing' } } });
          }),
          registry,
          { refs },
        ),
      /children\[3\]\.attrs\.value: no ref named "missing"/,
    );
    assert.throws(
      () =>
        applyJSON(
          t.chart,
          edit((j) => {
            j.attrs = { ...j.attrs, width: 100 };
            series(j).type = 'Nonsense';
          }),
          registry,
          { refs },
        ),
      /unknown type "Nonsense"/,
    );
    assert.equal(JSON.stringify(toJSON(t.chart, registry, { refs })), before, 'unchanged');
    assert.throws(() => applyJSON(t.chart, { type: 'PolarPlane' }, registry), /the root is a Chart/);
    assert.throws(() => applyJSON(t.chart, null as never, registry), /an element is an object/);

    // Key order in the JSON does not matter to what counts as changed.
    const j = edit(() => {});
    const stir = (o: unknown): unknown =>
      Array.isArray(o)
        ? o.map(stir)
        : o && typeof o === 'object'
          ? Object.fromEntries(
              Object.entries(o)
                .reverse()
                .map(([k, v]) => [k, stir(v)]),
            )
          : o;
    applyJSON(t.chart, stir(j) as ElementJSON, registry, { refs });
    const calm = t.chart.flush();
    assert.deepEqual([calm.attributeWrites, calm.filled], [0, 0], 'reordered keys are the same JSON');
    // The attached chart keeps its platform and keeps drawing through all of it.
    assert(t.chart.isAttached);
    t.chart.detach();
  }
});
