/**
 * inkplot.
 *
 * Conventions
 *  - Erasable TypeScript only, so Node can run it directly.
 *  - Members are `private` unless another class genuinely needs them. Where elements have to talk to
 *    each other (a plane driving its series, a series driving its axes) the methods are public, named
 *    without an underscore, and documented as protocol under an "Engine protocol" comment.
 *  - A parent declares its children as a tuple type, so order and arity are checked by the compiler.
 */

export { type Extent, type Insets, type LayoutRequest, type Rect, type Side, type Size } from './geometry.ts';
export {
  type ArrangeEvent,
  type AttachEvent,
  type ChartEvent,
  type ChartEventInit,
  type ChartKeyEvent,
  type ChartPointerEvent,
  EVENT_ARRANGE,
  EVENT_ATTACH,
  EVENT_FOCUS,
  EVENT_HOVER,
  EVENT_KEY,
  EVENT_MEASURE,
  EVENT_PAINT,
  EVENT_POINTER,
  EventBase,
  type FocusEvent,
  type Hit,
  type HoverEvent,
  type MeasureEvent,
  type PaintEvent,
} from './events.ts';
export {
  type FontSpec,
  type Platform,
  type PlatformNode,
  type RawFocus,
  type RawKey,
  type RawPointer,
  StringPlatform,
  type StringPlatformOptions,
  type SvgTag,
  type TextMeasurer,
  type Unsubscribe,
  estimateTextWidth,
} from './platform.ts';
export { type DOMContainer, DOMPlatform, type DOMPlatformOptions } from './dom-platform.ts';
export { type Counters, type NodeOptions, type Placement, type StageName, Surface } from './surface.ts';
export {
  type AnyElement,
  type BaseAttributes,
  ChartElement,
  type ElementArgs,
  type ElementClass,
  type ElementRef,
  type FixedIndex,
  type Meta,
  type VariadicChild,
  childrenOfType,
  closestAncestorOfType,
  descendantsOfType,
  findById,
  findNearest,
  findClosestOfType,
  firstDescendantOfType,
  resolveRef,
  walk,
} from './element.ts';
export { IntlTimeScale, type IntlTimeScaleAttributes } from './time-intl.ts';
export { TemporalTimeScale, type TemporalLike, type TemporalTimeScaleAttributes, type ZonedLike } from './time-temporal.ts';
export { TimeScale, type TimeRank, type TimeScaleAttributes, type TimeUnit } from './time.ts';
export { Scale, type ScaleAttributes } from './scale.ts';
export { BandScale, type BandScaleAttributes, LinearScale, LogScale, type LogScaleAttributes, SqrtScale } from './scales.ts';
export { Dimension, type DimensionAttributes, type Tick } from './dimension.ts';
export {
  Axis,
  type AxisAttributes,
  type AxisOrientation,
  type CartesianOrientation,
  type PolarOrientation,
  type Ruler,
  type TitleSpot,
} from './axis.ts';
export { applyText } from './text.ts';
export {
  type AxisMetrics,
  type BaseTheme,
  type LineProps,
  type MarkerMetrics,
  type Roots,
  type SelectorName,
  type Selectors,
  type ShapeProps,
  type TextProps,
  type Theme,
  extendTheme,
  resolveStyle,
} from './theme.ts';
export { accessibleDarkTheme, accessibleTheme, darkTheme, lightTheme } from './themes.ts';
export {
  type DataNode,
  DataSource,
  type DataSourceAttributes,
  type DataStage,
  DataTransform,
  type FillPlan,
  type FillResult,
  type PlanContext,
  type PointBuffer,
  type PointView,
  rowRange,
} from './data.ts';
export {
  type Column,
  CompositeDataSource,
  type CompositeDataSourceAttributes,
  type Field,
  FlatDataSource,
  type FlatDataSourceAttributes,
  ObjectDataSource,
  type ObjectDataSourceAttributes,
  SyntheticDataSource,
  type SyntheticDataSourceAttributes,
} from './sources.ts';
export {
  DecimationKernel,
  Decimator,
  type DecimatorAttributes,
  LttbKernel,
  M4Kernel,
  MinMaxKernel,
  type KeyedResult,
  type KeyedRows,
  type ReduceResult,
  StrideKernel,
} from './decimation.ts';
export {
  AreaPath,
  type AreaPathAttributes,
  LinePath,
  type LinePathAttributes,
  type AnchorSet,
  type PolygonSet,
  type ResolvedBinding,
  type Trace,
  SeriesRenderer,
  type SeriesRendererAttributes,
  type StyleBindable,
} from './renderer.ts';
export { Curve, type CurveAttributes, LinearCurve, areaOutline, polyline } from './curve.ts';
export {
  ArcCurve,
  type ArcCurveAttributes,
  BasisCurve,
  BumpCurve,
  type BumpCurveAttributes,
  CardinalCurve,
  type CardinalCurveAttributes,
  CatmullRomCurve,
  type CatmullRomCurveAttributes,
  MonotoneCurve,
  NaturalCurve,
  QuadraticCurve,
  StrokeCurve,
  type Pen,
} from './curves.ts';
export { StepCurve, type StepCurveAttributes, type StepMode, type Stepped, stepLines } from './steps.ts';
export { BoxPath, type BoxPathAttributes } from './boxplot.ts';
export { BoxStats, type BoxStatsAttributes } from './stats.ts';
export { quantile } from './quantile.ts';
export { Density, type DensityAttributes, type Stat } from './density.ts';
export { ErrorBand, type ErrorBandAttributes, ErrorBars, type ErrorBarsAttributes } from './errors.ts';
export { barShift } from './bars.ts';
export {
  StemPath,
  type StemPathAttributes,
  BarPath,
  type BarPathAttributes,
  BarRenderer,
  type BarRendererAttributes,
  type BarOptions,
  barShapes,
  stemLines,
} from './bars.ts';
export { SeriesGroup, type SeriesGroupAttributes, type GroupBinding } from './seriesgroup.ts';
export { WorkerBoundary, type WorkerBoundaryAttributes } from './workerboundary.ts';
export { createHost, type HostOptions } from './workerhost.ts';
export { WebWorker, type WebWorkerOptions } from './webworker.ts';
export { NullWorker, LoopbackWorker, cloneMessage, type WorkerHandler, type LoopbackOptions } from './workers.ts';
export type { Envelope, FromWorker, ToWorker, WorkerLike, WorkerMeta } from './workerproto.ts';
export { Stack, type StackAttributes, type StackAlign, type StackMode, type Layout, alignRows, layOut } from './stack.ts';
export {
  DomainSeries,
  type DomainSeriesAttributes,
  type Drawn,
  type Rows,
  Series,
  type SeriesHolder,
  type StackLayer,
  seriesOf,
  paintSample,
  type SampleCache,
  type SeriesAttributes,
  type SeriesChildren,
  XYSeries,
  type XYSeriesAttributes,
} from './series.ts';
export {
  CartesianPlane,
  type CartesianPlaneAttributes,
  Plane,
  type PlaneAttributes,
  type PlaneChildMap,
  type PlaneChildren,
} from './plane.ts';
export {
  PolarPlane,
  type PolarPlaneAttributes,
  RadarPlane,
  type RadarPlaneAttributes,
  RadialPlane,
  type RadialPlaneAttributes,
} from './radial.ts';
export { type PngHost, type PngOptions, svgToPng, toPng } from './png.ts';
export { BoxZoom, type BoxZoomAttributes } from './boxzoom.ts';
export { Brush, type BrushAttributes, type BrushRange, type BrushSelection } from './brush.ts';
export { DEFAULT_PANZOOM_KEYS, PanZoom, type PanZoomAction, type PanZoomAttributes, type PanZoomKeys } from './panzoom.ts';
export { type ChartFacts, ChartSummary, type ChartSummaryAttributes, englishSummary } from './summary.ts';
export { type AriaDefaults, hideFromAssistive, writeAria } from './aria.ts';
export { drawFocusRing, makeTabStop, pressesButton } from './focus.ts';
export { type Table, type TableOptions, readTable } from './table.ts';
export { InputHost, InteractiveElement, inputOf } from './input.ts';
export {
  Chart,
  type ChartAttributes,
  type Describer,
  type ChartChildMap,
  type ChartChildren,
  type FlushStats,
  type SvgOptions,
  toSvgString,
} from './chart.ts';
export {
  type Binding,
  type Bindings,
  type BoundDimension,
  ColorAxis,
  type ColorAxisAttributes,
  type ColorRampName,
  MappedDimension,
  type MappedDimensionAttributes,
  ScalarAxis,
  type ScalarAxisAttributes,
} from './mapped.ts';
export { Legend, type LegendAttributes } from './legend.ts';
export { ColorKey, Key, SizeKey, type ColorKeyAttributes, type KeyAttributes, type KeyOrientation, type SizeKeyAttributes } from './key.ts';
export {
  Trendline,
  LinearTrend,
  PolynomialTrend,
  SinusoidalTrend,
  LoessTrend,
  MeanTrend,
  type LinearTrendAttributes,
  type LoessTrendAttributes,
  type MeanTrendAttributes,
  type PolynomialTrendAttributes,
  type SinusoidalTrendAttributes,
  type TrendFit,
  type TrendModel,
  type TrendlineAttributes,
} from './trend.ts';
export { HeatMap, type HeatMapAttributes, type HeatMapBindable } from './heatmap.ts';
export {
  GradientAreaPath,
  type GradientAreaPathAttributes,
  type GradientAreaPathBindable,
  GradientLinePath,
  type GradientLinePathAttributes,
  type GradientLinePathBindable,
} from './gradientpaths.ts';
export {
  CircleMarker,
  CrossMarker,
  DotMarker,
  LineMarker,
  Marker,
  PlusMarker,
  ShapeMarker,
  SquareMarker,
  type DotMarkerAttributes,
  type DotMarkerBindable,
  type LineMarkerBindable,
  type MarkerAttributes,
  type MarkerStyle,
  type ShapeMarkerBindable,
} from './marker.ts';
export {
  type HitMode,
  type HitOptions,
  hitAcross,
  hitAll,
  hitPlane,
  hitTest,
  insideArea,
  insideTrace,
  interpolate,
  interpolateAll,
  nearest,
  nearestPoint,
  nearestSegment,
  nearestShape,
  nearestTraced,
  pointHit,
} from './hit.ts';
export { type DragInfo, PointerListener, type PointerListenerAttributes, type PointerInfo } from './pointer.ts';
export { type CalloutLook, calloutSize, clearCallout, paintCallout } from './callout.ts';
export {
  Cursor,
  type CursorAction,
  type CursorAttributes,
  type CursorChild,
  type CursorChildMap,
  type CursorKeys,
  type CursorState,
  DEFAULT_CURSOR_KEYS,
} from './cursor.ts';
export { Crosshair, type CrosshairAttributes } from './crosshair.ts';
export {
  ChartGroup,
  ChartGroupItem,
  SharedAxis,
  SharedRange,
  type Edges,
  type ChartGroupAttributes,
  type ChartGroupItemAttributes,
  type Justify,
} from './chartgroup.ts';
export { ChartTitle, type ChartTitleAttributes, ChartTooltip, type ChartTooltipAttributes, type TitleRole } from './furniture.ts';
export {
  CalloutAnnotation,
  type CalloutAnnotationAttributes,
  LineAnnotation,
  type LineAnnotationAttributes,
  type LineAnnotationCommon,
} from './annotation.ts';
export { Entrance, type EntranceAttributes } from './entrance.ts';
export {
  Pattern,
  LinePattern,
  HatchPattern,
  DotPattern,
  linePattern,
  dotPattern,
  checkerboard,
  type PatternAttributes,
  type LinePatternAttributes,
  type HatchPatternAttributes,
  type DotPatternAttributes,
  type LinePatternOptions,
  type DotPatternOptions,
} from './pattern.ts';
export type { PaintProvider } from './element.ts';
export { type PointAnnotationsAttributes, PointAnnotations, type PointWords } from './pointannotations.ts';
export { LINE_HEIGHT, measureBlock, paintLines } from './text.ts';
export {
  type ElementJSON,
  type ElementRegistry,
  JSON_VERSION,
  type JSONVersion,
  Refs,
  type SerializeOptions,
  applyJSON,
  fromJSON,
  toJSON,
} from './serialize.ts';
export { registry } from './registry.ts';
export { type LineChartOptions, lineChart } from './simple.ts';
export type { ChartShortcutOptions, SeriesInput } from './shortcut.ts';
export { type BarChartOptions, barChart } from './barchart.ts';
export { Slice, type SliceAttributes } from './slice.ts';
export { LinkedData, type LinkedDataAttributes } from './linkeddata.ts';
export { type PieChartOptions, type PieSlice, pieChart } from './pie.ts';
export { type MoveViewOptions, moveView, parseEasing } from './viewtween.ts';
export {
  AUTO,
  BOOLEAN,
  NUMBER,
  STRING,
  type AttrTypes,
  type AttrTypesFor,
  type Coerce,
  type ExpandOptions,
  expandAttributes,
} from './attrs.ts';
