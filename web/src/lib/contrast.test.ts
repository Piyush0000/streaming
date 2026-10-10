import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error - plain JS config, no types
import config from '../../tailwind.config.js';

function lin(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function lum(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const colors = config.theme.extend.colors as Record<string, any>;
const surfaces = {
  base: colors.base as string,
  panel: colors.panel as string,
  hover: colors.hover as string,
  'accent-soft': colors.accent.soft as string,
};

test('body text tokens are AA (4.5:1) on every surface', () => {
  for (const [tn, fg] of Object.entries(colors.text as Record<string, string>)) {
    for (const [sn, bg] of Object.entries(surfaces)) {
      assert.ok(contrast(fg, bg) >= 4.5, `text-${tn} on ${sn} = ${contrast(fg, bg).toFixed(2)}`);
    }
  }
});

test('status colours used as text (success / warning / red-400 danger / blue-400 accent) are AA on surfaces', () => {
  // index.css overrides .text-accent -> #60a5fa and .text-danger -> #f87171 for exactly this reason.
  const text = { success: colors.success as string, warning: colors.warning as string, danger: '#f87171', accent: '#60a5fa' };
  for (const [tn, fg] of Object.entries(text)) {
    for (const [sn, bg] of Object.entries(surfaces)) {
      assert.ok(contrast(fg, bg) >= 4.5, `${tn} on ${sn} = ${contrast(fg, bg).toFixed(2)}`);
    }
  }
});

test('white text on solid button fills is AA', () => {
  // .bg-accent -> #2563eb, hover #1d4ed8, .bg-danger -> #dc2626; order-ticket CTAs use #15803d / #b91c1c.
  for (const fill of ['#2563eb', '#1d4ed8', '#dc2626', '#15803d', '#b91c1c', '#9f1239']) {
    assert.ok(contrast('#ffffff', fill) >= 4.5, `white on ${fill} = ${contrast('#ffffff', fill).toFixed(2)}`);
  }
});

test('the raw accent / success / danger tokens are NOT safe behind white text (documents why the overrides exist)', () => {
  assert.ok(contrast('#ffffff', colors.accent.DEFAULT) < 4.5);
  assert.ok(contrast('#ffffff', colors.success) < 4.5);
});
