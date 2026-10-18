/**
 * Every element class the library ships, by the name it is written under in JSON (see serialize.ts). This module names
 * every class, so importing it brings them all into a bundle: it is for tools and configuration-driven pages, and a page
 * that builds its charts in code never needs it. To add classes of your own: `{ ...registry, MyScale }`.
 */
import { CalloutAnnotation, LineAnnotation } from './annotation.ts';
import { PointAnnotations } from './pointannotations.ts';
import { Axis } from './axis.ts';
import { StemPath, BarPath } from './bars.ts';
import { BoxPath } from './boxplot.ts';
import { BoxStats } from './stats.ts';
import { Chart } from './chart.ts';
import { ChartGroup, ChartGroupItem, SharedAxis, SharedRange } from './chartgroup.ts';
import { ErrorBand, ErrorBars } from './errors.ts';
import { LinearCurve } from './curve.ts';
import { ArcCurve, BasisCurve, BumpCurve, CardinalCurve, CatmullRomCurve, MonotoneCurve, NaturalCurve, QuadraticCurve } from './curves.ts';
import { CompositeDataSource, FlatDataSource, ObjectDataSource, SyntheticDataSource } from './sources.ts';
import { LinkedData } from './linkeddata.ts';
import { Slice } from './slice.ts';
import { Decimator, LttbKernel, M4Kernel, MinMaxKernel, StrideKernel } from './decimation.ts';
import { ChartTitle, ChartTooltip } from './furniture.ts';
import { Cursor } from './cursor.ts';
import { Crosshair } from './crosshair.ts';
import { ColorKey, SizeKey } from './key.ts';
import { Legend } from './legend.ts';
import { ColorAxis, ScalarAxis } from './mapped.ts';
import { LinearTrend, LoessTrend, MeanTrend, PolynomialTrend, SinusoidalTrend } from './trend.ts';
import { GradientAreaPath, GradientLinePath } from './gradientpaths.ts';
import { HeatMap } from './heatmap.ts';
import { CircleMarker, CrossMarker, DotMarker, PlusMarker, SquareMarker } from './marker.ts';
import { BoxZoom } from './boxzoom.ts';
import { Density } from './density.ts';
import { Brush } from './brush.ts';
import { PanZoom } from './panzoom.ts';
import { Entrance } from './entrance.ts';
import { DotPattern, HatchPattern, LinePattern } from './pattern.ts';
import { ChartSummary } from './summary.ts';
import { CartesianPlane } from './plane.ts';
import { PointerListener } from './pointer.ts';
import { PolarPlane, RadarPlane } from './radial.ts';
import { AreaPath, LinePath } from './renderer.ts';
import { BandScale, LinearScale, LogScale, SqrtScale } from './scales.ts';
import type { ElementRegistry } from './serialize.ts';
import { DomainSeries, XYSeries } from './series.ts';
import { SeriesGroup } from './seriesgroup.ts';
import { WorkerBoundary } from './workerboundary.ts';
import { Stack } from './stack.ts';
import { StepCurve } from './steps.ts';
import { IntlTimeScale } from './time-intl.ts';
import { TemporalTimeScale } from './time-temporal.ts';

export const registry: ElementRegistry = {
  Chart,
  ChartGroup,
  ChartGroupItem,
  SharedRange,
  SharedAxis,
  ChartTitle,
  ChartTooltip,
  ChartSummary,
  Entrance,
  LinePattern,
  HatchPattern,
  DotPattern,
  Cursor,
  Crosshair,
  Legend,
  CartesianPlane,
  PolarPlane,
  RadarPlane,
  Axis,
  ColorAxis,
  ScalarAxis,
  ColorKey,
  SizeKey,
  LinearScale,
  LogScale,
  SqrtScale,
  BandScale,
  IntlTimeScale,
  TemporalTimeScale,
  DomainSeries,
  XYSeries,
  Stack,
  SeriesGroup,
  WorkerBoundary,
  FlatDataSource,
  ObjectDataSource,
  CompositeDataSource,
  SyntheticDataSource,
  Decimator,
  Slice,
  LinkedData,
  MinMaxKernel,
  M4Kernel,
  LttbKernel,
  StrideKernel,
  LinePath,
  AreaPath,
  LinearCurve,
  MonotoneCurve,
  NaturalCurve,
  CardinalCurve,
  CatmullRomCurve,
  BasisCurve,
  BumpCurve,
  QuadraticCurve,
  ArcCurve,
  StepCurve,
  BarPath,
  StemPath,
  BoxPath,
  BoxStats,
  Density,
  HeatMap,
  GradientLinePath,
  GradientAreaPath,
  LinearTrend,
  PolynomialTrend,
  SinusoidalTrend,
  LoessTrend,
  MeanTrend,
  ErrorBars,
  ErrorBand,
  DotMarker,
  CrossMarker,
  PlusMarker,
  CircleMarker,
  SquareMarker,
  LineAnnotation,
  CalloutAnnotation,
  PointAnnotations,
  PanZoom,
  BoxZoom,
  Brush,
  PointerListener,
};
