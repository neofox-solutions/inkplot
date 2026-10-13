// A failing assertion or a log of anything holding an element must print briefly, not the whole chart.
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { Axis, CartesianPlane, Chart, Cursor, DomainSeries, FlatDataSource, LinePath, LinearScale } from './index.ts';
import { LinearCurve } from './curve.ts';
import { FakePlatform } from './fake-platform.ts';
import { lightTheme } from './themes.ts';

const series = new DomainSeries({ name: 'a' }, new FlatDataSource({ data: Float64Array.from([1, 2, 3]), regularDomain: { start: 0, step: 1 } }), new LinePath(new LinearCurve()));
const plane = new CartesianPlane({ id: 'main' }, new Axis({ orientation: 'bottom' }, new LinearScale()), new Axis({ orientation: 'left' }, new LinearScale()), series);
const chart = new Chart({ theme: lightTheme }, plane, new Cursor({}));
assert.equal(inspect(plane), 'CartesianPlane#main(3)');
assert.equal(inspect(chart), 'Chart(2)');
const held = inspect({ hit: { series, plane }, state: { plane, hits: [{ series }] } });
assert(held.length < 300, `an object holding elements stays short: ${held.length} characters`);
// What a failed assert would print: it ignores custom inspect, so the elements themselves hold nothing it can follow (their links
// are private fields), and even a whole attached chart in the value comes to a page of text.
const said = (value: unknown) => { try { assert.equal(value, null); } catch (e) { return (e as Error).message; } return ''; };
assert(said({ plane }).length < 400 && said({ plane }).includes('CartesianPlane'), said({ plane }));
chart.attach(new FakePlatform({ width: 400, height: 300 })).flush();
const big = said({ plane, chart, series });
assert(big.length < 4000, `a failed assert with a live chart in the value is ${big.length} characters`);
console.log('ok inspect');
