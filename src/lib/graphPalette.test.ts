import assert from 'node:assert/strict';
import test from 'node:test';
import { graphEntityType, graphPaletteForType } from './graphPalette';

test('entity colors stay stable across graph subsets', () => {
  const color = graphPaletteForType('流程');
  assert.deepEqual(graphPaletteForType('流程'), color);
  assert.deepEqual(graphPaletteForType('  流程  '), color);
  assert.match(color.node, /^#[0-9a-f]{6}$/);
  assert.match(color.soft, /^#[0-9a-f]{6}$/);
  assert.match(color.edge, /^#[0-9a-f]{6}$/);
  assert.equal(new Set(['人物', '组织', '地点', '事件'].map((type) => graphPaletteForType(type).node)).size, 4);
});

test('entity type uses trimmed metadata with a safe fallback', () => {
  assert.equal(graphEntityType({ id: '1', labels: ['规则'], properties: { entity_type: '  制度  ' } }), '制度');
  assert.equal(graphEntityType({ id: '2', labels: ['规则'], properties: {} }), '规则');
  assert.equal(graphEntityType({ id: '3', labels: ['   '], properties: {} }), '实体');
});
