// Every message an inkplot error can carry, by code. Development builds print the message; production builds print only the code and a link
// to docs/reference/errors.md (see fail.ts), so this module is not bundled for them. `%0`, `%1` ... stand for the values given with the code.
// Codes are append-only: a code that is no longer thrown stays reserved, because messages in the wild point at it. docs/reference/errors.md is
// generated from this file (`node tools/errors.ts`).
export const messages = {
  // annotation.ts
  101: 'plane has no axis for the value',
  102: 'plane has no axis for the domain',
  // attrs.ts
  103: "attribute '%0' conflicts with '%1', which is a value",
  104: "attribute '%0': not allowed",
  105: "attribute '%0': empty name part",
  // axis.ts
  106: 'an axis on the "%0" side needs a CartesianPlane',
  107: 'an axis on the "%0" side needs a PolarPlane',
  // barchart.ts
  108: 'barChart: give the `categories` (one label for each bar), or a `domainScale`',
  // boxzoom.ts
  109: 'add a BoxZoom before PanZoom in a plane: the box has to see a press first to take it',
  // brush.ts
  110: 'add a Brush before PanZoom in a plane: the brush has to see a press first to take it',
  // bucket.ts
  111: 'maxNodes %0 leaves fewer than 2 steps for %1 bound styles',
  112: 'the binding of %0 needs an axis or a map',
  // chart.ts
  113: 'a chart has one plane or group: put several in a ChartGroup',
  114: 'chart is not attached',
  115: 'chart is already attached',
  // chartgroup.ts
  116: 'ChartGroup: the %0 items do not fit in %1 columns and %2 rows',
  117: 'ChartGroup: an item spans %0 cells along the flow, and a line has %1',
  118: 'ChartGroup: %0 has to be a whole number of at least 1',
  119: 'ChartGroupItem: span %0 is not a whole number of columns and rows',
  120: 'SharedAxis needs a sharedRef: the id of a SharedRange',
  // data.ts
  121: 'the data has no channel "%0"',
  122: 'the data says it is sorted along the domain (isSorted), but the first column asked of it is "%0", not "domain": the series and the layout of the data disagree',
  123: 'the wrap period is shorter than the domain of the data',
  124: "Expected 'domain' and 'value' as the first requested channels but got %0; %1 must be attached to a DomainSeries or compatible",
  125: '%0 needs the points ascending in the domain, but they were asked for in the order they are stored',
  // decimation.ts
  126: 'a Decimator has no room for a key',
  127: 'a Decimator was asked for a key it did not reduce',
  128: 'a Decimator needs a regular domain that ascends',
  129: 'a Decimator cannot carry channels with %0, which does not say which rows it kept (tracksRows): bind on undecimated data, or turn the Decimator off',
  // density.ts
  130: 'Density has no channel "%0" (it has %1)',
  131: 'Density: stat is one of %0 (got "%1")',
  132: 'Density: %0 bins is too many cells: use `width` or `bins` to make them fewer',
  133: 'Density: width %0 makes %1 bins along "%2": use a wider bin',
  134: 'Density: bins must be at least 1 (got %0)',
  135: 'Density: width must be above 0 (got %0)',
  136: 'Density: `by` names a dimension twice',
  137: 'Density: `by` needs at least one dimension',
  // element.ts
  138: 'element "%0" is not a %1',
  139: 'no element with id "%0"',
  140: 'element is not attached',
  141: 'element is not a child of this element',
  142: '%0: has no child %1 to replace',
  143: 'element already has a parent',
  144: '%0 is not in a chart',
  145: '%0 is not attached',
  146: '%0: child %1 should be %2, but is %3',
  147: '%0: has no child %1 (it needs %2)',
  148: '%0 has no parent',
  // gradientpaths.ts
  149: 'a gradient path needs a rectangular plane: its colour runs along a straight axis',
  // jsx-runtime.ts
  150: '<%0>: a function used as a tag must return a chart element',
  151: '<%0>: a child must be a chart element, not %1',
  // linkeddata.ts
  152: 'LinkedData has no source',
  // mapped.ts
  153: 'a linear colour ramp takes #rgb or #rrggbb stops, not "%0"',
  // node-worker.ts
  // partition.ts
  156: '%0 has no data beneath it',
  157: 'a key has no rows',
  158: 'the rows of a key are read through plan',
  159: '%0 cannot be split by a channel',
  160: 'a data transform has no source beneath it',
  // pattern.ts
  161: 'HatchPattern: angle and crossAngle must differ, and not by a half turn (got %0 and %1 degrees)',
  162: 'linePattern: the two angles must differ (got %0 and %1 degrees)',
  // pie.ts
  163: 'pieChart: the value of "%0" must be a number that is not negative, not %1',
  // plane.ts
  164: 'a floating axis needs an axis on the other orientation to cross',
  165: 'a series needs one horizontal and one vertical axis',
  166: 'too many axes without an orientation',
  // platform.ts
  167: 'StringPlatform: "%0" is not an attribute name',
  // png.ts
  168: 'toPng: the chart is attached to a platform that is not a DOM one',
  169: 'toPng: scale must be above 0',
  170: 'toPng: the canvas gave no image',
  171: 'toPng: the browser could not draw this SVG',
  // pointannotations.ts
  172: 'PointAnnotations: %0 is in a SeriesGroup, which draws a copy of it for each series, so notes cannot anchor to it',
  173: 'PointAnnotations: the plane has no series',
  // pointer.ts
  174: 'add a PointerListener before PanZoom in a plane: the listener has to see a press first to claim it',
  // radial.ts
  175: 'a series needs one angle axis and one radius axis',
  // renderer.ts
  176: 'an AreaPath has one colour: to colour it by a channel of the data, use a GradientAreaPath',
  177: 'a LinePath has one colour: to colour it by a channel of the data, use a GradientLinePath',
  // scales.ts
  178: 'LogScale: base is above 0 and not 1 (got %0)',
  // serialize.ts
  179: 'the root is a %0: JSON for a "%1" cannot be applied to it',
  180: 'an element is an object { type, attrs?, children? }',
  181: '%0"children" has to be an array',
  182: '%0%1: %2',
  183: '%0"attrs" has to be an object',
  184: '%0an element is an object { type, attrs?, children? }',
  185: '%0unknown type "%1"%2',
  186: '%0every element needs a "type", the name of a class',
  187: '%0"__proto__" is not an attribute name',
  188: '%0unknown marker "%1"',
  189: '%0a $typed value holds numbers, null (NaN), "Infinity" or "-Infinity": item %1 is %2',
  190: '%0a $typed value is { "$typed": one of %1, "data": [numbers] }',
  191: '%0$number has to be "NaN", "Infinity" or "-Infinity"',
  192: '%0%1',
  193: '%0refers to "%1", and no refs were given to look it up in',
  194: '%0a $ref has to be the name of a ref',
  195: 'the JSON is version %0.%1, which this release (reading %2.0 to %3) cannot read: it was written by %4 release. To read it as it is anyway, set its `version` to JSON_VERSION',
  196: 'the JSON has no "version", or one that is not [major, minor]: a document written by toJSON has it; one written by hand needs `version: JSON_VERSION` (now %0)',
  197: '%0the key "%1" is reserved: JSON marks references and special values with a leading $',
  198: '%0a %1 whose buffer was moved to another thread (transferred), so there is nothing to write',
  199: '%0refers to a %1 that has no id: give it one so JSON can name it',
  200: '%0a %1 cannot be written as JSON',
  201: '%0%1, which JSON cannot hold: name it in `refs` (a Refs with `auto: true` names whatever it meets)',
  202: '%0%1 is not in the registry: add it, as in { ...registry, %2 }',
  203: 'no ref named "%0"%1',
  204: 'ref "%0" already names something else',
  205: 'ref "%0": only objects and functions can be named',
  // series.ts
  206: 'plane has no axis for y',
  207: 'plane has no axis for x',
  208: 'series has not been laid out',
  209: 'series has not been projected',
  210: 'series is not in a chart',
  // seriesgroup.ts
  211: 'SeriesGroup: the data has no channel "%0"',
  212: 'SeriesGroup: over a WorkerBoundary the series are in the order of `first` or `sorted`: a function cannot go to the worker',
  213: 'SeriesGroup: %0 cannot work on the rows of a key: a data transform in a group has to extend KeyedTransform',
  214: 'SeriesGroup: a binding needs a ColorAxis or a ScalarAxis',
  // simple.ts
  215: 'lineChart: a curve is an element and has one parent, so give `curve` as a function that makes one, `() => new MonotoneCurve()`',
  // slice.ts
  216: 'a Slice with keyed set to false has to sit directly on the source, which is what it windows',
  // sources.ts
  // stack.ts
  217: "the series of a stack have to share their domain values: give the stack `align: 'gaps'` (bars) or `align: 'interpolate'` (lines, areas) to merge them",
  218: 'the series of a stack have to share their domain axis and their value axis',
  219: 'a group in a stack has to be of series with a domain and a value: it has `x`, so its series are XY',
  // stats.ts
  220: 'BoxStats has no channel "%0" (it has %1)',
  221: 'BoxStats: the outliers have no channels, only the sample (the value)',
  222: 'BoxStats: fence is a number of interquartile ranges, or "minmax"',
  // surface.ts
  223: 'wrapper() must come before the element draws anything',
  // table.ts
  224: 'readTable: no column "%0" (have %1)',
  // time-temporal.ts
  225: 'TemporalTimeScale: this runtime has no Temporal; pass one as the `temporal` attribute, or use IntlTimeScale',
  // trend.ts
  226: 'MeanTrend: smoothness is from 0 to 1 (got %0)',
  227: "kernel is 'tricube' or 'gaussian' (got \"%0\")",
  228: "LoessTrend: kernel is 'tricube' or 'gaussian' (got \"%0\")",
  229: 'LoessTrend: smoothness is from 0 to 1 (got %0)',
  230: 'SinusoidalTrend: period must be above 0 (got %0)',
  231: 'PolynomialTrend: degree is a whole number from 1 to %0 (got %1)',
  232: '%0 has no channel "%1" (it has domain)',
  233: '%0: extend must be 0 or more (got %1)',
  // web-components.ts
  234: '<%0> is already defined for something else',
  235: "attribute '%0': '%1' is not valid JSON",
  236: "attribute '%0': '%1' is not a number",
  237: "%0: '%1' and '%2' differ only in case",
  // webworker.ts
  // worker.ts
  239: 'serveWorker: there is no worker scope to listen on: run it in a worker, or give it a `port`',
  // workerboundary.ts
  240: 'WorkerBoundary: %0',
  241: 'WorkerBoundary: the worker could not be sent a %0: %1',
  242: 'WorkerBoundary: "%0" is backed by a SharedArrayBuffer: set `shared` to share it with the worker (the page has to be cross-origin isolated)',
  243: 'WorkerBoundary: "%0" was moved to a worker (`transfer`) and is not here any more: give each boundary its own array, or leave `transfer` off to copy it',
  244: 'WorkerBoundary: an array of the description was moved to a worker (`transfer`) and is not here any more: give each boundary its own array, or leave `transfer` off to copy it',
  245: 'WorkerBoundary: what is inside has to be a data source or transform',
  // workerhost.ts
  246: 'a fill by key needs the boundary to have been given a partition',
  247: 'fill before attach',
  248: 'the boundary holds something that is not a data source or transform',
  249: 'the stages inside the boundary cannot be split by a channel: each has to extend KeyedTransform',
  // workers.ts
  250: 'DataCloneError: %0 cannot be sent to a worker: only plain objects, arrays and typed arrays can',
  251: 'DataCloneError: a %0 cannot be sent to a worker',
  // attrs.ts, dimension.ts, element.ts
  252: "attribute '%0' conflicts with '%0-…', which are nested values",
  253: "attribute '%0' is given twice",
  254: '%0: child 0 should be Scale, but is %1',
  255: '%0: has no child 0 (it needs Scale)',
  256: 'an element cannot be added inside itself or beneath its own child',
  // node-worker.ts, webworker.ts
  257: 'the worker failed: %0',
  258: 'the worker exited with code %0',
  259: 'a message from the worker could not be read',
} as const satisfies Record<number, string>;
