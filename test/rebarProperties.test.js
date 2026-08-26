import test from 'node:test';
import assert from 'node:assert/strict';
import { getRebarArea, rebarArea } from '../src/rebarProperties.js';

test('standard reinforcing bars use their nominal tabulated area', () => {
  assert.equal(rebarArea[8], 0.79);
  assert.equal(getRebarArea({ rebarSize: 8 }), 0.79);
});

test('an explicit imported rebar area remains authoritative', () => {
  assert.equal(getRebarArea({ rebarSize: 8, rebarArea: 0.81 }), 0.81);
});
