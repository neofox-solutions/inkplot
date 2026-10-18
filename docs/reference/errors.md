# Error codes

A development build of inkplot throws errors with a full message: `[inkplot 144] X is not in a chart`. A production build leaves the messages out to keep the bundle small, and throws `Minified inkplot error: https://inkplot.neofox.solutions/errors#144` instead, with the values the message mentions in brackets after the link. Find the code here.

In a message, `%0`, `%1` … stand for those values, in order. To see the full messages while you debug a production build, run the build in development mode (see [Compatibility](../guide/compatibility.md)).

## 101

```text
plane has no axis for the value
```

First thrown in annotation.ts.

## 102

```text
plane has no axis for the domain
```

First thrown in annotation.ts.

## 103

```text
attribute '%0' conflicts with '%1', which is a value
```

First thrown in attrs.ts.

## 104

```text
attribute '%0': not allowed
```

First thrown in attrs.ts.

## 105

```text
attribute '%0': empty name part
```

First thrown in attrs.ts.

## 106

```text
an axis on the "%0" side needs a CartesianPlane
```

First thrown in axis.ts.

## 107

```text
an axis on the "%0" side needs a PolarPlane
```

First thrown in axis.ts.

## 108

```text
barChart: give the `categories` (one label for each bar), or a `domainScale`
```

First thrown in barchart.ts.

## 109

```text
add a BoxZoom before PanZoom in a plane: the box has to see a press first to take it
```

First thrown in boxzoom.ts.

## 110

```text
add a Brush before PanZoom in a plane: the brush has to see a press first to take it
```

First thrown in brush.ts.

## 111

```text
maxNodes %0 leaves fewer than 2 steps for %1 bound styles
```

First thrown in bucket.ts.

## 112

```text
the binding of %0 needs an axis or a map
```

First thrown in bucket.ts.

## 113

```text
a chart has one plane or group: put several in a ChartGroup
```

First thrown in chart.ts.

## 114

```text
chart is not attached
```

First thrown in chart.ts.

## 115

```text
chart is already attached
```

First thrown in chart.ts.

## 116

```text
ChartGroup: the %0 items do not fit in %1 columns and %2 rows
```

First thrown in chartgroup.ts.

## 117

```text
ChartGroup: an item spans %0 cells along the flow, and a line has %1
```

First thrown in chartgroup.ts.

## 118

```text
ChartGroup: %0 has to be a whole number of at least 1
```

First thrown in chartgroup.ts.

## 119

```text
ChartGroupItem: span %0 is not a whole number of columns and rows
```

First thrown in chartgroup.ts.

## 120

```text
SharedAxis needs a sharedRef: the id of a SharedRange
```

First thrown in chartgroup.ts.

## 121

```text
the data has no channel "%0"
```

First thrown in data.ts.

## 122

```text
the data says it is sorted along the domain (isSorted), but the first column asked of it is "%0", not "domain": the series and the layout of the data disagree
```

First thrown in data.ts.

## 123

```text
the wrap period is shorter than the domain of the data
```

First thrown in data.ts.

## 124

```text
Expected 'domain' and 'value' as the first requested channels but got %0; %1 must be attached to a DomainSeries or compatible
```

First thrown in data.ts.

## 125

```text
%0 needs the points ascending in the domain, but they were asked for in the order they are stored
```

First thrown in data.ts.

## 126

```text
a Decimator has no room for a key
```

First thrown in decimation.ts.

## 127

```text
a Decimator was asked for a key it did not reduce
```

First thrown in decimation.ts.

## 128

```text
a Decimator needs a regular domain that ascends
```

First thrown in decimation.ts.

## 129

```text
a Decimator cannot carry channels with %0, which does not say which rows it kept (tracksRows): bind on undecimated data, or turn the Decimator off
```

First thrown in decimation.ts.

## 130

```text
Density has no channel "%0" (it has %1)
```

First thrown in density.ts.

## 131

```text
Density: stat is one of %0 (got "%1")
```

First thrown in density.ts.

## 132

```text
Density: %0 bins is too many cells: use `width` or `bins` to make them fewer
```

First thrown in density.ts.

## 133

```text
Density: width %0 makes %1 bins along "%2": use a wider bin
```

First thrown in density.ts.

## 134

```text
Density: bins must be at least 1 (got %0)
```

First thrown in density.ts.

## 135

```text
Density: width must be above 0 (got %0)
```

First thrown in density.ts.

## 136

```text
Density: `by` names a dimension twice
```

First thrown in density.ts.

## 137

```text
Density: `by` needs at least one dimension
```

First thrown in density.ts.

## 138

```text
element "%0" is not a %1
```

First thrown in element.ts.

## 139

```text
no element with id "%0"
```

First thrown in element.ts.

## 140

```text
element is not attached
```

First thrown in element.ts.

## 141

```text
element is not a child of this element
```

First thrown in element.ts.

## 142

```text
%0: has no child %1 to replace
```

First thrown in element.ts.

## 143

```text
element already has a parent
```

First thrown in element.ts.

## 144

```text
%0 is not in a chart
```

First thrown in element.ts.

## 145

```text
%0 is not attached
```

First thrown in element.ts.

## 146

```text
%0: child %1 should be %2, but is %3
```

First thrown in element.ts.

## 147

```text
%0: has no child %1 (it needs %2)
```

First thrown in element.ts.

## 148

```text
%0 has no parent
```

First thrown in element.ts.

## 149

```text
a gradient path needs a rectangular plane: its colour runs along a straight axis
```

First thrown in gradientpaths.ts.

## 150

```text
<%0>: a function used as a tag must return a chart element
```

First thrown in jsx-runtime.ts.

## 151

```text
<%0>: a child must be a chart element, not %1
```

First thrown in jsx-runtime.ts.

## 152

```text
LinkedData has no source
```

First thrown in linkeddata.ts.

## 153

```text
a linear colour ramp takes #rgb or #rrggbb stops, not "%0"
```

First thrown in mapped.ts.

## 156

```text
%0 has no data beneath it
```

First thrown in partition.ts.

## 157

```text
a key has no rows
```

First thrown in partition.ts.

## 158

```text
the rows of a key are read through plan
```

First thrown in partition.ts.

## 159

```text
%0 cannot be split by a channel
```

First thrown in partition.ts.

## 160

```text
a data transform has no source beneath it
```

First thrown in partition.ts.

## 161

```text
HatchPattern: angle and crossAngle must differ, and not by a half turn (got %0 and %1 degrees)
```

First thrown in pattern.ts.

## 162

```text
linePattern: the two angles must differ (got %0 and %1 degrees)
```

First thrown in pattern.ts.

## 163

```text
pieChart: the value of "%0" must be a number that is not negative, not %1
```

First thrown in pie.ts.

## 164

```text
a floating axis needs an axis on the other orientation to cross
```

First thrown in plane.ts.

## 165

```text
a series needs one horizontal and one vertical axis
```

First thrown in plane.ts.

## 166

```text
too many axes without an orientation
```

First thrown in plane.ts.

## 167

```text
StringPlatform: "%0" is not an attribute name
```

First thrown in platform.ts.

## 168

```text
toPng: the chart is attached to a platform that is not a DOM one
```

First thrown in png.ts.

## 169

```text
toPng: scale must be above 0
```

First thrown in png.ts.

## 170

```text
toPng: the canvas gave no image
```

First thrown in png.ts.

## 171

```text
toPng: the browser could not draw this SVG
```

First thrown in png.ts.

## 172

```text
PointAnnotations: %0 is in a SeriesGroup, which draws a copy of it for each series, so notes cannot anchor to it
```

First thrown in pointannotations.ts.

## 173

```text
PointAnnotations: the plane has no series
```

First thrown in pointannotations.ts.

## 174

```text
add a PointerListener before PanZoom in a plane: the listener has to see a press first to claim it
```

First thrown in pointer.ts.

## 175

```text
a series needs one angle axis and one radius axis
```

First thrown in radial.ts.

## 176

```text
an AreaPath has one colour: to colour it by a channel of the data, use a GradientAreaPath
```

First thrown in renderer.ts.

## 177

```text
a LinePath has one colour: to colour it by a channel of the data, use a GradientLinePath
```

First thrown in renderer.ts.

## 178

```text
LogScale: base is above 0 and not 1 (got %0)
```

First thrown in scales.ts.

## 179

```text
the root is a %0: JSON for a "%1" cannot be applied to it
```

First thrown in serialize.ts.

## 180

```text
an element is an object { type, attrs?, children? }
```

First thrown in serialize.ts.

## 181

```text
%0"children" has to be an array
```

First thrown in serialize.ts.

## 182

```text
%0%1: %2
```

First thrown in serialize.ts.

## 183

```text
%0"attrs" has to be an object
```

First thrown in serialize.ts.

## 184

```text
%0an element is an object { type, attrs?, children? }
```

First thrown in serialize.ts.

## 185

```text
%0unknown type "%1"%2
```

First thrown in serialize.ts.

## 186

```text
%0every element needs a "type", the name of a class
```

First thrown in serialize.ts.

## 187

```text
%0"__proto__" is not an attribute name
```

First thrown in serialize.ts.

## 188

```text
%0unknown marker "%1"
```

First thrown in serialize.ts.

## 189

```text
%0a $typed value holds numbers, null (NaN), "Infinity" or "-Infinity": item %1 is %2
```

First thrown in serialize.ts.

## 190

```text
%0a $typed value is { "$typed": one of %1, "data": [numbers] }
```

First thrown in serialize.ts.

## 191

```text
%0$number has to be "NaN", "Infinity" or "-Infinity"
```

First thrown in serialize.ts.

## 192

```text
%0%1
```

First thrown in serialize.ts.

## 193

```text
%0refers to "%1", and no refs were given to look it up in
```

First thrown in serialize.ts.

## 194

```text
%0a $ref has to be the name of a ref
```

First thrown in serialize.ts.

## 195

```text
the JSON is version %0.%1, which this release (reading %2.0 to %3) cannot read: it was written by %4 release. To read it as it is anyway, set its `version` to JSON_VERSION
```

First thrown in serialize.ts.

## 196

```text
the JSON has no "version", or one that is not [major, minor]: a document written by toJSON has it; one written by hand needs `version: JSON_VERSION` (now %0)
```

First thrown in serialize.ts.

## 197

```text
%0the key "%1" is reserved: JSON marks references and special values with a leading $
```

First thrown in serialize.ts.

## 198

```text
%0a %1 whose buffer was moved to another thread (transferred), so there is nothing to write
```

First thrown in serialize.ts.

## 199

```text
%0refers to a %1 that has no id: give it one so JSON can name it
```

First thrown in serialize.ts.

## 200

```text
%0a %1 cannot be written as JSON
```

First thrown in serialize.ts.

## 201

```text
%0%1, which JSON cannot hold: name it in `refs` (a Refs with `auto: true` names whatever it meets)
```

First thrown in serialize.ts.

## 202

```text
%0%1 is not in the registry: add it, as in { ...registry, %2 }
```

First thrown in serialize.ts.

## 203

```text
no ref named "%0"%1
```

First thrown in serialize.ts.

## 204

```text
ref "%0" already names something else
```

First thrown in serialize.ts.

## 205

```text
ref "%0": only objects and functions can be named
```

First thrown in serialize.ts.

## 206

```text
plane has no axis for y
```

First thrown in series.ts.

## 207

```text
plane has no axis for x
```

First thrown in series.ts.

## 208

```text
series has not been laid out
```

First thrown in series.ts.

## 209

```text
series has not been projected
```

First thrown in series.ts.

## 210

```text
series is not in a chart
```

First thrown in series.ts.

## 211

```text
SeriesGroup: the data has no channel "%0"
```

First thrown in seriesgroup.ts.

## 212

```text
SeriesGroup: over a WorkerBoundary the series are in the order of `first` or `sorted`: a function cannot go to the worker
```

First thrown in seriesgroup.ts.

## 213

```text
SeriesGroup: %0 cannot work on the rows of a key: a data transform in a group has to extend KeyedTransform
```

First thrown in seriesgroup.ts.

## 214

```text
SeriesGroup: a binding needs a ColorAxis or a ScalarAxis
```

First thrown in seriesgroup.ts.

## 215

```text
lineChart: a curve is an element and has one parent, so give `curve` as a function that makes one, `() => new MonotoneCurve()`
```

First thrown in simple.ts.

## 216

```text
a Slice with keyed set to false has to sit directly on the source, which is what it windows
```

First thrown in slice.ts.

## 217

```text
the series of a stack have to share their domain values: give the stack `align: 'gaps'` (bars) or `align: 'interpolate'` (lines, areas) to merge them
```

First thrown in stack.ts.

## 218

```text
the series of a stack have to share their domain axis and their value axis
```

First thrown in stack.ts.

## 219

```text
a group in a stack has to be of series with a domain and a value: it has `x`, so its series are XY
```

First thrown in stack.ts.

## 220

```text
BoxStats has no channel "%0" (it has %1)
```

First thrown in stats.ts.

## 221

```text
BoxStats: the outliers have no channels, only the sample (the value)
```

First thrown in stats.ts.

## 222

```text
BoxStats: fence is a number of interquartile ranges, or "minmax"
```

First thrown in stats.ts.

## 223

```text
wrapper() must come before the element draws anything
```

First thrown in surface.ts.

## 224

```text
readTable: no column "%0" (have %1)
```

First thrown in table.ts.

## 225

```text
TemporalTimeScale: this runtime has no Temporal; pass one as the `temporal` attribute, or use IntlTimeScale
```

First thrown in time-temporal.ts.

## 226

```text
MeanTrend: smoothness is from 0 to 1 (got %0)
```

First thrown in trend.ts.

## 227

```text
kernel is 'tricube' or 'gaussian' (got "%0")
```

First thrown in trend.ts.

## 228

```text
LoessTrend: kernel is 'tricube' or 'gaussian' (got "%0")
```

First thrown in trend.ts.

## 229

```text
LoessTrend: smoothness is from 0 to 1 (got %0)
```

First thrown in trend.ts.

## 230

```text
SinusoidalTrend: period must be above 0 (got %0)
```

First thrown in trend.ts.

## 231

```text
PolynomialTrend: degree is a whole number from 1 to %0 (got %1)
```

First thrown in trend.ts.

## 232

```text
%0 has no channel "%1" (it has domain)
```

First thrown in trend.ts.

## 233

```text
%0: extend must be 0 or more (got %1)
```

First thrown in trend.ts.

## 234

```text
<%0> is already defined for something else
```

First thrown in web-components.ts.

## 235

```text
attribute '%0': '%1' is not valid JSON
```

First thrown in web-components.ts.

## 236

```text
attribute '%0': '%1' is not a number
```

First thrown in web-components.ts.

## 237

```text
%0: '%1' and '%2' differ only in case
```

First thrown in web-components.ts.

## 239

```text
serveWorker: there is no worker scope to listen on: run it in a worker, or give it a `port`
```

First thrown in worker.ts.

## 240

```text
WorkerBoundary: %0
```

First thrown in workerboundary.ts.

## 241

```text
WorkerBoundary: the worker could not be sent a %0: %1
```

First thrown in workerboundary.ts.

## 242

```text
WorkerBoundary: "%0" is backed by a SharedArrayBuffer: set `shared` to share it with the worker (the page has to be cross-origin isolated)
```

First thrown in workerboundary.ts.

## 243

```text
WorkerBoundary: "%0" was moved to a worker (`transfer`) and is not here any more: give each boundary its own array, or leave `transfer` off to copy it
```

First thrown in workerboundary.ts.

## 244

```text
WorkerBoundary: an array of the description was moved to a worker (`transfer`) and is not here any more: give each boundary its own array, or leave `transfer` off to copy it
```

First thrown in workerboundary.ts.

## 245

```text
WorkerBoundary: what is inside has to be a data source or transform
```

First thrown in workerboundary.ts.

## 246

```text
a fill by key needs the boundary to have been given a partition
```

First thrown in workerhost.ts.

## 247

```text
fill before attach
```

First thrown in workerhost.ts.

## 248

```text
the boundary holds something that is not a data source or transform
```

First thrown in workerhost.ts.

## 249

```text
the stages inside the boundary cannot be split by a channel: each has to extend KeyedTransform
```

First thrown in workerhost.ts.

## 250

```text
DataCloneError: %0 cannot be sent to a worker: only plain objects, arrays and typed arrays can
```

First thrown in workers.ts.

## 251

```text
DataCloneError: a %0 cannot be sent to a worker
```

First thrown in workers.ts.

## 252

```text
attribute '%0' conflicts with '%0-…', which are nested values
```

First thrown in attrs.ts, dimension.ts, element.ts.

## 253

```text
attribute '%0' is given twice
```

First thrown in attrs.ts, dimension.ts, element.ts.

## 254

```text
%0: child 0 should be Scale, but is %1
```

First thrown in attrs.ts, dimension.ts, element.ts.

## 255

```text
%0: has no child 0 (it needs Scale)
```

First thrown in attrs.ts, dimension.ts, element.ts.

## 256

```text
an element cannot be added inside itself or beneath its own child
```

First thrown in attrs.ts, dimension.ts, element.ts.

## 257

```text
the worker failed: %0
```

First thrown in node-worker.ts, webworker.ts.

## 258

```text
the worker exited with code %0
```

First thrown in node-worker.ts, webworker.ts.

## 259

```text
a message from the worker could not be read
```

First thrown in node-worker.ts, webworker.ts.
