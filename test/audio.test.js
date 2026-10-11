// The robot down-and-distance call: which recorded pieces make up each call, and that every
// piece it can ask for is recorded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { downCallParts } from '../src/audio/downcall.js';

const clip = (name) => new URL(`../src/audio/downs/${name}.mp3`, import.meta.url);

test('down calls splice the down and the distance', () => {
  assert.deepEqual(downCallParts(1, 30, false), ['first-30']);
  assert.deepEqual(downCallParts(3, 12, false), ['down-3', 'num-12']);
  assert.deepEqual(downCallParts(2, 40, false), ['down-2', 'num-40']);
  assert.deepEqual(downCallParts(4, 27, false), ['down-4', 'num-20', 'num-7']);
  assert.deepEqual(downCallParts(1, 30, true), ['down-1', 'goal']);
  assert.deepEqual(downCallParts(2, 6, true), ['down-2', 'goal']);
  assert.deepEqual(downCallParts(0, 10, false), []);
});

test('every down call has its recordings', () => {
  for (let dn = 1; dn <= 4; dn++) {
    for (let tg = 1; tg <= 99; tg++) {
      for (const goal of [false, true]) {
        for (const name of downCallParts(dn, tg, goal)) assert.ok(existsSync(clip(name)), `${name}.mp3 is missing (${dn} and ${tg})`);
      }
    }
  }
});
