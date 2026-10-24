// Axis-aligned paths: every plane draws a run of moves along one axis in its own terms, and the path agrees with `place`.
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { walkAligned } from './aligned.ts';
import { Axis, CartesianPlane, Chart, LinearScale, PolarPlane, RadarPlane, StringPlatform, type Plane } from './index.ts';
import { lightTheme } from './themes.ts';

test('aligned', () => {
  const near = (a: number, b: number, tol = 0.02, what = '') => assert(Math.abs(a - b) <= tol, `${what} ${a} is not ${b}`);
  const lin = () => new LinearScale();
  function show(plane: Plane, size = 400) {
    const chart = new Chart({ theme: lightTheme, width: size, height: size }, plane);
    chart.attach(new StringPlatform({ width: size, height: size }));
    chart.flush();
  }
  /** The vertices of a path as `[command, numbers]` in order. */
  const parse = (d: string) =>
    [...d.matchAll(/([MLHVAZ])([^MLHVAZ]*)/g)].map((m) => [m[1]!, (m[2]!.match(/-?[\d.]+/g) ?? []).map(Number)] as const);
  /** The pixel position of a pair of fractions, by the plane's own `place`. */
  const placed = (plane: Plane, first: Axis, second: Axis, a: number, b: number): [number, number] => {
    const p = { data: new Float64Array([a, b]), stride: 2, count: 1 };
    plane.place(p, first, second);
    return [p.data[0]!, p.data[1]!];
  };
  const flat = (...v: number[][]) => Float64Array.from(v.flat());

  // ── The walk: gaps lift the pen, moves that go on the same way are one, a closed run comes back by a move of its own.
  {
    const log: string[] = [];
    const sink = {
      begin: (a: number, b: number) => log.push(`begin ${a},${b}`),
      to: (_pa: number, _pb: number, a: number, b: number, along: number, closing: boolean) =>
        log.push(`${closing ? 'close' : 'to'} ${a},${b} along ${along}`),
      finish: (closed: boolean) => log.push(closed ? 'end closed' : 'end'),
    };
    walkAligned(flat([0, 0], [0.5, 0], [1, 0], [1, 1], [1, 1], [NaN, 3], [2, 2], [2, 3]), 8, false, sink);
    assert.deepEqual(log, ['begin 0,0', 'to 1,0 along 0', 'to 1,1 along 1', 'end', 'begin 2,2', 'to 2,3 along 1', 'end']);
    log.length = 0;
    walkAligned(flat([0, 0], [0, 1], [1, 1], [1, 0]), 4, true, sink);
    assert.deepEqual(log, ['begin 0,0', 'to 0,1 along 1', 'to 1,1 along 0', 'to 1,0 along 1', 'close 0,0 along 0', 'end closed']);
    log.length = 0;
    walkAligned(flat([0, 0], [1, 0], [0, 0]), 3, false, sink);
    assert.deepEqual(log, ['begin 0,0', 'to 1,0 along 0', 'to 0,0 along 0', 'end'], 'going back is a move of its own, not a continuation');
    log.length = 0;
    walkAligned(flat([0, 0], [1, 1]), 2, false, sink);
    assert.deepEqual(log, ['begin 0,0', 'to 1,1 along 2', 'end'], 'a move along both is reported as such');
  }

  // ── A rectangle plane: H and V, in either orientation, and the corners are where `place` puts them.
  for (const [o1, o2] of [
    ['bottom', 'left'],
    ['left', 'bottom'],
    ['top', 'right'],
  ] as const) {
    const first = new Axis({ orientation: o1, min: 0, max: 1 }, lin()),
      second = new Axis({ orientation: o2, min: 0, max: 1 }, lin());
    const plane = new CartesianPlane({}, first, second);
    show(plane);
    const bar = flat([0.2, 0.1], [0.2, 0.8], [0.6, 0.8], [0.6, 0.1]);
    const d = plane.alignedPath(bar, 4, first, second, true);
    const cmds = parse(d);
    assert.deepEqual(
      cmds.map((c) => c[0]),
      ['M', 'V', 'H', 'V', 'Z'].map((c, i) => (o1 === 'bottom' || o1 === 'top' ? c : i > 0 && i < 4 ? (c === 'V' ? 'H' : 'V') : c)),
      `${o1}/${o2}: a bar is a start, three straight moves and a close; got ${d}`,
    );
    const corners = [
      [0.2, 0.1],
      [0.2, 0.8],
      [0.6, 0.8],
      [0.6, 0.1],
    ].map(([a, b]) => placed(plane, first, second, a!, b!));
    near(cmds[0]![1][0]!, corners[0]![0], 0.01, 'start x');
    near(cmds[0]![1][1]!, corners[0]![1], 0.01, 'start y');
    // The end of each move is the corner `place` gives (an H sets x, a V sets y).
    let [x, y] = corners[0]!;
    for (let k = 1; k <= 3; k++) {
      const cmd = cmds[k]!;
      if (cmd[0] === 'H') x = cmd[1][0]!;
      else y = cmd[1][0]!;
      near(x, corners[k]![0], 0.01, `corner ${k} x`);
      near(y, corners[k]![1], 0.01, `corner ${k} y`);
    }
    // A line that goes on the same way is one move; a gap lifts the pen.
    assert.equal(parse(plane.alignedPath(flat([0, 0.5], [0.5, 0.5], [1, 0.5]), 3, first, second)).length, 2, 'collinear vertices merge');
    assert.equal(
      parse(plane.alignedPath(flat([0, 0.5], [0.5, 0.5], [NaN, NaN], [0.7, 0.2], [0.7, 0.9]), 5, first, second)).filter((c) => c[0] === 'M')
        .length,
      2,
    );
    assert.equal(plane.alignedPath(flat([NaN, 0.5]), 1, first, second), '', 'nothing real, nothing drawn');
  }

  // ── A polar plane: along the angle an arc round the middle, along the radius a spoke.
  {
    const angle = new Axis({ orientation: 'angle', min: 0, max: 1 }, lin()),
      radius = new Axis({ orientation: 'radius', min: 0, max: 1 }, lin());
    const plane = new PolarPlane({}, angle, radius);
    show(plane);
    const R = plane.radius,
      cx = plane.rect.width / 2,
      cy = plane.rect.height / 2;
    // A ring segment, as a pie slice or a polar bar is: radius 0.4 to 0.9, angle a quarter to a half turn.
    const slice = flat([0.25, 0.4], [0.25, 0.9], [0.5, 0.9], [0.5, 0.4]);
    const cmds = parse(plane.alignedPath(slice, 4, angle, radius, true));
    assert.deepEqual(
      cmds.map((c) => c[0]),
      ['M', 'L', 'A', 'L', 'A', 'Z'],
      'out along a spoke, round the rim, back along a spoke, round the inside',
    );
    const arcs = cmds.filter((c) => c[0] === 'A');
    near(arcs[0]![1][0]!, R * 0.9, 0.02, 'outer radius');
    near(arcs[1]![1][0]!, R * 0.4, 0.02, 'inner radius');
    assert.equal(arcs[0]![1][4], 1, 'clockwise out, the way the angle runs');
    assert.equal(arcs[1]![1][4], 0, 'and back the other way');
    // The arc ends are where `place` puts them.
    const end = placed(plane, angle, radius, 0.5, 0.9);
    near(arcs[0]![1][5]!, end[0], 0.02);
    near(arcs[0]![1][6]!, end[1], 0.02);
    near(Math.hypot(arcs[0]![1][5]! - cx, arcs[0]![1][6]! - cy), R * 0.9, 0.02, 'on the circle');

    // The value on the angle (a ring of segments): the same, with the axes the other way round.
    const ring = flat([0.2, 0.1], [0.8, 0.1], [0.8, 0.3], [0.2, 0.3]);
    const cmds2 = parse(plane.alignedPath(ring, 4, radius, angle, true));
    assert.deepEqual(
      cmds2.map((c) => c[0]),
      ['M', 'L', 'A', 'L', 'A', 'Z'],
    );

    // A whole turn: two arcs of half a turn each, ending where they began, not none at all.
    const turn = parse(plane.alignedPath(flat([0, 0.5], [1, 0.5]), 2, angle, radius));
    assert.deepEqual(
      turn.map((c) => c[0]),
      ['M', 'A', 'A'],
    );
    near(turn[2]![1][5]!, turn[0]![1][0]!, 0.02, 'a turn ends where it began (x)');
    near(turn[2]![1][6]!, turn[0]![1][1]!, 0.02, 'a turn ends where it began (y)');
    // Going back is the other way round the circle.
    const back = parse(plane.alignedPath(flat([0.75, 0.5], [0.25, 0.5]), 2, angle, radius));
    assert.equal(back[1]![1][4], 0, 'anticlockwise');
    // Not aligned: a chord.
    assert.deepEqual(
      parse(plane.alignedPath(flat([0.1, 0.2], [0.4, 0.8]), 2, angle, radius)).map((c) => c[0]),
      ['M', 'L'],
    );
  }

  // ── A radar plane: a move along the angle is a chord through each spoke it passes.
  {
    const angle = new Axis({ orientation: 'angle', min: 0, max: 4, tickCount: 5, nice: false }, lin()),
      radius = new Axis({ orientation: 'radius', min: 0, max: 1 }, lin());
    const plane = new RadarPlane({}, angle, radius);
    show(plane);
    const d = parse(plane.alignedPath(flat([0.1, 0.6], [0.9, 0.6]), 2, angle, radius));
    assert(
      d.every((c, i) => (i === 0 ? c[0] === 'M' : c[0] === 'L')),
      'chords only',
    );
    const spokes = [0.25, 0.5, 0.75];
    assert.equal(d.length, 1 + spokes.length + 1, 'a vertex at each spoke between the ends, and the end');
    spokes.forEach((s, i) => {
      const [x, y] = placed(plane, angle, radius, s, 0.6);
      near(d[i + 1]![1][0]!, x, 0.02, `spoke ${i} x`);
      near(d[i + 1]![1][1]!, y, 0.02, `spoke ${i} y`);
    });
    const down = parse(plane.alignedPath(flat([0.9, 0.6], [0.1, 0.6]), 2, angle, radius));
    const [sx, sy] = placed(plane, angle, radius, 0.75, 0.6);
    near(down[1]![1][0]!, sx, 0.02, 'the other way, the nearest spoke first (x)');
    near(down[1]![1][1]!, sy, 0.02, 'the other way, the nearest spoke first (y)');
  }
});
