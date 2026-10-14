// Locale: a chart's `locale` writes tick labels and readings in that language's way; an axis' own wins; none keeps plain digits.
import assert from 'node:assert/strict';
import { Chart, CartesianPlane, Axis, LinearScale, DomainSeries, FlatDataSource, ObjectDataSource, LinePath, LinearCurve, IntlTimeScale } from './index.ts';
import { lightTheme } from './themes.ts';
import { FakePlatform } from './fake-platform.ts';
import { test } from 'vite-plus/test';

test("locale", () => {
const build = (chart: { locale?: string }, axis: { locale?: string; format?: (v: number) => string } = {}) => {
  const y = new Axis({ orientation: 'left', ...axis }, new LinearScale());
  const c = new Chart({ theme: lightTheme, ...chart }, new CartesianPlane({}, new Axis({}, new LinearScale()), y,
    new DomainSeries({}, new FlatDataSource({ data: [1200.5, 2400, 3600.25] }), new LinePath({}, new LinearCurve()))));
  const p = new FakePlatform({ width: 400, height: 300 });
  c.attach(p).flush();
  const labels = [...p.toString().matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!);
  return { y, labels };
};

{
  const plain = build({});
  assert(plain.labels.includes('2000') || plain.labels.includes('2500'), `plain digits: ${plain.labels.join()}`);
  assert(plain.y.formatValue(1234.5) === '1234.5');
  const de = build({ locale: 'de' });
  assert(de.labels.some((l) => /\d\.\d{3}/.test(l)), `German grouping with a point: ${de.labels.join()}`);
  assert.equal(de.y.formatValue(1234.5), '1.234,5', 'readings too');
  assert.equal(de.y.formatValue(1234567.8), '1.234.568');
  assert.equal(build({ locale: 'de' }, { locale: 'en' }).y.formatValue(1234.5), '1,234.5', 'the axis beats the chart');
  assert.equal(build({ locale: 'de' }, { format: (v) => `<${v}>` }).y.formatValue(5), '<5>', 'format beats both');
}
{
  const month = (locale: string | undefined) => {
    const x = new Axis({}, new IntlTimeScale({ timeZone: 'UTC' }));
    const c = new Chart({ theme: lightTheme, locale }, new CartesianPlane({}, x, new Axis({}, new LinearScale()),
      new DomainSeries({}, new ObjectDataSource({ source: [[Date.UTC(2024, 0, 1), 1], [Date.UTC(2024, 5, 1), 2], [Date.UTC(2024, 11, 1), 3]], domain: (r: number[]) => r[0]!, value: (r: number[]) => r[1]! }), new LinePath({}, new LinearCurve()))));
    const p = new FakePlatform({ width: 600, height: 300 });
    c.attach(p).flush();
    return p.toString();
  };
  assert(/janv|févr|mars|avr|mai|juin|juil|sept|oct|déc/i.test(month('fr')), 'French month names from the chart locale');
  assert(/Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/.test(month('en')));
}
});
