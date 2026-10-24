/* oxlint-disable typescript/no-non-null-assertion -- flat [first, second] vertex buffers walked in steps of two: every index is bounded by `count` */
// Axis-aligned paths: a run of vertices in which each is reached from the one before by moving along one axis only, as the outline of a bar
// (up the edge, across the top, down the other edge) or a step line is. A plane draws such a run in its own terms: a Cartesian plane with
// `H` and `V`, a polar one with arcs along the angle and lines along the radius, a radar one with chords through its spokes. This is the walk
// they share: it reads the vertices, lifts the pen at a gap, merges moves that go on the same way, and tells the plane what it has to draw.

/** Which coordinate a move changes: the first axis, the second, or (not aligned) both. */
export type Along = 0 | 1 | 2;

/** What a plane writes as a run of vertices is walked. All numbers are the vertices' own: fractions of the first and second axis. */
export interface AlignedSink {
  /** A run starts at this vertex. */
  begin(a: number, b: number): void;
  /**
   * The run goes from (pa, pb) to (a, b), along the first axis (`0`), the second (`1`), or both (`2`: a plane draws a straight chord).
   * `closing` is the last move of a closed run, back to where it started; it is the shape's own edge, so it is drawn unless the plane's
   * `Z` would draw the very same thing.
   */
  to(pa: number, pb: number, a: number, b: number, along: Along, closing: boolean): void;
  /** The run is over. `closed`: it was a closed shape, so the pen comes back to where it began. */
  finish(closed: boolean): void;
}

const alongOf = (pa: number, pb: number, a: number, b: number): Along => (b === pb ? 0 : a === pa ? 1 : 2);

/**
 * Walk `count` vertices, `[first, second]` a pair, in order. A vertex with a coordinate that is not a number ends the run there, and the
 * next real one starts a new run, so a gap in the data lifts the pen. Moves that continue the same way along the same axis are one move, and a
 * vertex that is where the run already is, is skipped. With `closed` each run is joined back to its first vertex by a move of its own, which
 * is a straight chord for a plane that draws chords and an arc for one that draws arcs.
 */
export function walkAligned(coords: ArrayLike<number>, count: number, closed: boolean, sink: AlignedSink): void {
  let started = false;
  // The start of the run, the end of what has been handed to the sink, and the end of the move still being extended.
  let sa = 0,
    sb = 0,
    pa = 0,
    pb = 0,
    qa = 0,
    qb = 0;
  let along: Along | -1 = -1,
    dir = 0;
  const flush = () => {
    if (along === -1) return;
    sink.to(pa, pb, qa, qb, along, false);
    pa = qa;
    pb = qb;
    along = -1;
  };
  const end = () => {
    if (!started) return;
    flush();
    if (closed && (pa !== sa || pb !== sb)) sink.to(pa, pb, sa, sb, alongOf(pa, pb, sa, sb), true);
    sink.finish(closed);
    started = false;
  };
  for (let i = 0; i < count; i++) {
    const a = coords[2 * i]!,
      b = coords[2 * i + 1]!;
    if (!(Number.isFinite(a) && Number.isFinite(b))) {
      end();
      continue;
    }
    if (!started) {
      sink.begin(a, b);
      sa = pa = qa = a;
      sb = pb = qb = b;
      started = true;
      continue;
    }
    if (a === qa && b === qb) continue;
    const kind = alongOf(qa, qb, a, b),
      d = kind === 0 ? Math.sign(a - qa) : kind === 1 ? Math.sign(b - qb) : 0;
    if (kind !== 2 && kind === along && d === dir) {
      qa = a;
      qb = b;
      continue;
    }
    flush();
    along = kind;
    dir = d;
    qa = a;
    qb = b;
  }
  end();
}
