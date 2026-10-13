# Custom renderers, markers and curves

A series does not draw itself. It prepares **placed points** (the data after decimation, normalization and placement, in plot pixels), and its renderers draw them. Three small base classes cover the ways to extend that, from the smallest change to the largest:

| To change… | Extend | You write |
|---|---|---|
| The **shape** of a marker | `ShapeMarker` (or `LineMarker`, `DotMarker`) | One method: the path of one marker. |
| How points are **joined** | `Curve` | `line(series)` (and `area`) returning path text. |
| **What a series draws** | `SeriesRenderer` | `draw(points)`. |

Read [Custom elements](custom-elements.md) first: these are elements, with attributes, `attrTypes`, a surface and a style chain.

## A marker shape

`ShapeMarker` gives you grouping, culling, binding to mapped dimensions, a legend sample and all the styling. You say what one marker is:

```tsx live title="A diamond marker" height=260
import { Axis, CartesianPlane, Chart, LinearScale, ObjectDataSource, ShapeMarker, XYSeries, lightTheme } from 'inkplot';

class DiamondMarker extends ShapeMarker {
  /** The path of one marker centred on (x, y), `r` pixels from the centre to a corner. */
  protected shape(x: number, y: number, r: number): string {
    const f = (n: number) => n.toFixed(2);
    return `M${f(x)} ${f(y - r)}L${f(x + r)} ${f(y)}L${f(x)} ${f(y + r)}L${f(x - r)} ${f(y)}Z`;
  }
}

const rows = Array.from({ length: 12 }, (_, i) => ({ x: i, y: 5 + 4 * Math.sin(i / 2) }));

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom"><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <XYSeries x="x">
        <ObjectDataSource source={rows} value="y" channels={{ x: 'x' }} />
        <DiamondMarker size={7} />
      </XYSeries>
    </CartesianPlane>
  </Chart>
);
```

Everything else is inherited: `<DiamondMarker size={…} bind={{ fill: … }}>` can be bound to a `ColorAxis` and a `SizeAxis`, it appears in legends, and a scatter of a hundred thousand of them is a few paths. The three families differ in what they let you bind and where the series colour goes:

| Base | Is | Palette colour goes to | Bindable |
|---|---|---|---|
| `ShapeMarker` | Closed shapes, filled and stroked | the fill | stroke, strokeWidth, fill, opacity, size |
| `LineMarker` | Shapes made of strokes (a cross) | the stroke | stroke, strokeWidth, opacity, size |
| `DotMarker` | A zero-length stroke as wide as the dot | the stroke | stroke, size, opacity |

If you extend `Marker` directly instead, you also say which theme selector holds its look (`kind`), where the accent goes, which bindings are geometric (go in the path) and which are stylistic, and how a node is styled. The three families above are examples to copy.

## A curve

A `Curve` is the one child of a `LinePath` or an `AreaPath`, and does one thing: turn the placed points of a series into path text. `line(series)` gives the stroke. `area(series, baseline)` gives the shapes between the line and a baseline.

```tsx live title="Right-angle joins" height=260
import { Axis, CartesianPlane, Chart, Curve, DomainSeries, FlatDataSource, LinePath, LinearScale, lightTheme } from 'inkplot';
import type { Series } from 'inkplot';

/** Go vertical to the next point's height, then across. */
class ElbowCurve extends Curve {
  line(series: Series): string {
    const { data, count, stride } = series.points;
    let d = '', pen = false;
    for (let i = 0; i < count; i++) {
      const x = data[stride * i]!, y = data[stride * i + 1]!;
      if (x - x !== 0 || y - y !== 0) { pen = false; continue; }      // a gap lifts the pen
      d += pen ? `V${y.toFixed(2)}H${x.toFixed(2)}` : `M${x.toFixed(2)} ${y.toFixed(2)}`;
      pen = true;
    }
    return d;
  }
  area(): string {
    throw new Error('ElbowCurve draws lines; use it in a LinePath');
  }
}

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom" tickStep={1}><LinearScale /></Axis>
      <Axis orientation="left"><LinearScale /></Axis>
      <DomainSeries name="Level">
        <FlatDataSource data={[3, 5, 4, 8, 6, 7, 2]} regularDomain-start={0} regularDomain-step={1} />
        <LinePath><ElbowCurve /></LinePath>
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

Notes:

- **A gap** in the data arrives as a `NaN` placed point. Lift the pen at it; `series.attrs.gaps === 'connect'` asks you to cross it instead. `polyline(points, connect)` and `areaOutline(top, base, connect)` are the library's straight-line helpers to start from.
- **Hit testing.** A curve whose path is not straight lines through the points should also implement `trace(series, baseline)`, returning the path it draws as vertices, with the series point each belongs to (`Trace`). Pointer hits and tooltip readings are then measured against what is on screen. The right-angle curve above would do this to be exact; without it, hits follow the straight lines through the points.
- **Many curves share the work**: `curves.ts` has `StrokeCurve`, where you say only what pieces a run of points is made of, and gets the lines, areas, gaps and traces.
- Area under a curve needs `area`, which must produce a shape that closes back along the baseline: `series.baseline(value)` gives the baseline points placed like the data.

## A series renderer

When what you draw is not a path through points and not a marker, extend `SeriesRenderer`. You must implement `draw(points)`, which runs on every paint and says what the nodes look like, every time (the same rules as any element).

```tsx live title="A lollipop renderer" height=280
import { Axis, CartesianPlane, Chart, DomainSeries, FlatDataSource, LinearScale, SeriesRenderer, lightTheme } from 'inkplot';
import type { PointBuffer, PlatformNode, Surface } from 'inkplot';

/** A stem from zero up to each point, with a dot on the end. */
class Lollipop extends SeriesRenderer {
  #look() {
    const a = this.attrs;
    return this.styleFor(['seriesLine', 'line'], { color: a.stroke, width: a.strokeWidth, opacity: a.opacity }, { color: this.requireParent().accentColor });
  }
  override get swatch(): string { return this.#look().color; }
  override get reach(): number { return 5; }                       // pixels beyond the points that the dots reach

  protected draw(points: Readonly<PointBuffer>): void {
    const s = this.surface, look = this.#look(), series = this.requireParent();
    const zero = series.baseline(0);                                // where value 0 is, placed like the points
    const { data, count, stride } = points;
    let stems = '', dots = '';
    for (let i = 0; i < count; i++) {
      const x = data[stride * i]!, y = data[stride * i + 1]!;
      if (x - x !== 0 || y - y !== 0) continue;                      // skip gaps
      stems += `M${x.toFixed(2)} ${zero.data[zero.stride * i + 1]!.toFixed(2)}V${y.toFixed(2)}`;
      dots += `M${x.toFixed(2)} ${y.toFixed(2)}h0`;
    }
    const stem = s.node('stems', 'path');
    s.set(stem, 'd', stems);
    s.set(stem, 'fill', 'none');
    s.set(stem, 'stroke', look.color);
    s.set(stem, 'stroke-width', look.width);
    const dot = s.node('dots', 'path');
    s.set(dot, 'd', dots);
    s.set(dot, 'fill', 'none');
    s.set(dot, 'stroke', look.color);
    s.set(dot, 'stroke-width', 10);
    s.set(dot, 'stroke-linecap', 'round');
  }

  override sample(s: Surface, parent: PlatformNode, key: string, width: number, height: number): void {
    const n = s.node(key, 'path', { parent });
    s.set(n, 'd', `M${width / 2} ${height}V${height / 2}`);
    s.set(n, 'stroke', this.#look().color);
    s.set(n, 'stroke-width', 2);
    s.set(n, 'fill', 'none');
  }
}

export default () => (
  <Chart theme={lightTheme}>
    <CartesianPlane>
      <Axis orientation="bottom" tickStep={1}><LinearScale /></Axis>
      <Axis orientation="left" include={[0]}><LinearScale /></Axis>
      <DomainSeries name="Count">
        <FlatDataSource data={[4, 7, 3, 9, 5, 8]} regularDomain-start={0} regularDomain-step={1} />
        <Lollipop />
      </DomainSeries>
    </CartesianPlane>
  </Chart>
);
```

What a renderer can tell the series, by overriding a getter (all optional):

| Member | Tells |
|---|---|
| `swatch` | The one colour that stands for what it draws, for keys and tooltips. |
| `sample(surface, parent, key, width, height)` | Draws a small picture of itself for a legend entry. |
| `includes` | Values the value axis must reach whatever the data says (bars: their baseline). |
| `reach` | Pixels it draws beyond its points, so axes leave room for them. |
| `spans` | Half its width along the domain, as a fraction of the gap between points (bars). |
| `hitMode`, `shapes()`, `trace()` | How a pointer should measure against it: `'shape'` and the shapes it drew, or the line it traced. |
| `bindings`, `stepsPerBinding` | Bound dimensions; see the markers' source for the quantizing machinery. |

For anything that varies per point by a bound dimension, extending a marker is much easier than writing this by hand: it does the culling and grouping.

## Where they go

A renderer or marker is a series child, so no registration is needed to use it. Add it to JSON and the adapters as in [Custom elements](custom-elements.md#registering).
