import type { RagGraph } from './rag';

const GRAPH_PALETTE = [
  { node: '#2563eb', soft: '#bfdbfe', edge: '#93c5fd' },
  { node: '#7c3aed', soft: '#ddd6fe', edge: '#c4b5fd' },
  { node: '#0f766e', soft: '#99f6e4', edge: '#5eead4' },
  { node: '#d97706', soft: '#fde68a', edge: '#fcd34d' },
  { node: '#e11d48', soft: '#fecdd3', edge: '#fda4af' },
  { node: '#0891b2', soft: '#a5f3fc', edge: '#67e8f9' },
  { node: '#16a34a', soft: '#bbf7d0', edge: '#86efac' },
  { node: '#db2777', soft: '#fbcfe8', edge: '#f9a8d4' },
  { node: '#9333ea', soft: '#e9d5ff', edge: '#d8b4fe' },
  { node: '#ea580c', soft: '#fed7aa', edge: '#fdba74' },
] as const;

type GraphNode = RagGraph['nodes'][number];

export function graphEntityType(node: GraphNode): string {
  const type = node.properties.entity_type;
  return typeof type === 'string' && type.trim() ? type.trim() : node.labels[0]?.trim() || '实体';
}

export function graphPaletteForType(type: string) {
  let hash = 2166136261;
  for (const character of type.trim() || '实体') {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  return GRAPH_PALETTE[(hash >>> 0) % GRAPH_PALETTE.length];
}
