import { useEffect, useMemo, useState } from 'react';
import { SigmaContainer, useLoadGraph, useRegisterEvents, useSigma } from '@react-sigma/core';
import { MultiDirectedGraph } from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import type { RagGraph } from '@/lib/rag';
import { graphEntityType, graphPaletteForType } from '@/lib/graphPalette';
import '@react-sigma/core/lib/style.css';

type Props = {
  graph: RagGraph;
  activeId: string;
  onNodeSelect: (id: string) => void;
};

function buildGraph(data: RagGraph) {
  const graph = new MultiDirectedGraph();
  const degrees = new Map<string, number>();
  for (const edge of data.edges) {
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
  }
  const count = Math.max(1, data.nodes.length);
  data.nodes.forEach((node, index) => {
    const angle = (index / count) * Math.PI * 2;
    const degree = degrees.get(node.id) ?? 0;
    const palette = graphPaletteForType(graphEntityType(node));
    graph.addNode(node.id, {
      x: Math.cos(angle),
      y: Math.sin(angle),
      label: node.id,
      size: Math.min(16, 5 + Math.sqrt(degree) * 2.2),
      color: palette.node,
      mutedColor: palette.soft,
      edgeColor: palette.edge,
      degree,
    });
  });
  data.edges.forEach((edge, index) => {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) return;
    graph.addDirectedEdgeWithKey(`${edge.id}-${index}`, edge.source, edge.target, {
      color: graph.getNodeAttribute(edge.source, 'edgeColor'),
      size: 0.9,
    });
  });
  if (graph.order > 1) {
    forceAtlas2.assign(graph, {
      iterations: graph.order > 600 ? 35 : graph.order > 250 ? 60 : 100,
      settings: { ...forceAtlas2.inferSettings(graph), barnesHutOptimize: graph.order > 150, gravity: 1.2 },
    });
  }
  return graph;
}

function GraphController({ data, activeId, onNodeSelect }: { data: RagGraph; activeId: string; onNodeSelect: (id: string) => void }) {
  const loadGraph = useLoadGraph();
  const registerEvents = useRegisterEvents();
  const sigma = useSigma();
  const [draggedNode, setDraggedNode] = useState('');

  useEffect(() => {
    loadGraph(buildGraph(data));
    requestAnimationFrame(() => sigma.getCamera().animatedReset({ duration: 450 }));
  }, [data, loadGraph, sigma]);

  useEffect(() => {
    registerEvents({
      clickNode: ({ node }) => onNodeSelect(node),
      downNode: ({ node }) => {
        setDraggedNode(node);
        sigma.getGraph().setNodeAttribute(node, 'highlighted', true);
      },
      mousemovebody: (event) => {
        if (!draggedNode) return;
        const position = sigma.viewportToGraph(event);
        sigma.getGraph().mergeNodeAttributes(draggedNode, position);
        event.preventSigmaDefault();
        event.original.preventDefault();
      },
      mouseup: () => {
        if (!draggedNode) return;
        sigma.getGraph().removeNodeAttribute(draggedNode, 'highlighted');
        setDraggedNode('');
      },
    });
  }, [draggedNode, onNodeSelect, registerEvents, sigma]);

  useEffect(() => {
    if (!activeId || !sigma.getGraph().hasNode(activeId)) return;
    const position = sigma.getNodeDisplayData(activeId);
    if (position) sigma.getCamera().animate({ x: position.x, y: position.y, ratio: Math.min(sigma.getCamera().getState().ratio, 0.65) }, { duration: 350 });
  }, [activeId, sigma]);

  return null;
}

function GraphControls() {
  const sigma = useSigma();
  const applyLayout = (layout: string) => {
    const graph = sigma.getGraph();
    if (layout === 'circular') {
      const count = Math.max(1, graph.order);
      let index = 0;
      graph.forEachNode((node) => {
        const angle = (index / count) * Math.PI * 2;
        graph.mergeNodeAttributes(node, { x: Math.cos(angle), y: Math.sin(angle) });
        index += 1;
      });
    } else {
      forceAtlas2.assign(graph, {
        iterations: graph.order > 600 ? 30 : graph.order > 250 ? 50 : 80,
        settings: { ...forceAtlas2.inferSettings(graph), barnesHutOptimize: graph.order > 150, gravity: 1.2 },
      });
    }
    sigma.refresh();
    sigma.getCamera().animatedReset({ duration: 400 });
  };
  return <div className="absolute bottom-3 left-3 z-10 flex items-center gap-1 rounded-lg border border-black/10 bg-white/90 p-1 shadow-sm backdrop-blur">
    <select aria-label="图谱布局" defaultValue="force" onChange={(event) => applyLayout(event.target.value)} className="h-8 cursor-pointer bg-transparent px-2 text-[9px] outline-none">
      <option value="force">力导向</option>
      <option value="circular">环形</option>
    </select>
    <button type="button" aria-label="放大图谱" title="放大" onClick={() => sigma.getCamera().animatedZoom({ duration: 180 })} className="size-8 rounded-md text-[16px] hover:bg-black/[0.06]">+</button>
    <button type="button" aria-label="缩小图谱" title="缩小" onClick={() => sigma.getCamera().animatedUnzoom({ duration: 180 })} className="size-8 rounded-md text-[16px] hover:bg-black/[0.06]">−</button>
    <button type="button" aria-label="重置图谱视图" title="重置" onClick={() => sigma.getCamera().animatedReset({ duration: 300 })} className="size-8 rounded-md text-[13px] hover:bg-black/[0.06]">↺</button>
    <button type="button" aria-label="全屏查看图谱" title="全屏" onClick={() => { void sigma.getContainer().requestFullscreen(); }} className="size-8 rounded-md text-[13px] hover:bg-black/[0.06]">⛶</button>
  </div>;
}

export default function LightRagGraphCanvas({ graph, activeId, onNodeSelect }: Props) {
  const entityTypes = useMemo(() => [...new Set(graph.nodes.map(graphEntityType))].sort(), [graph.nodes]);
  const neighbors = useMemo(() => {
    if (!activeId) return new Set<string>();
    const result = new Set([activeId]);
    for (const edge of graph.edges) {
      if (edge.source === activeId) result.add(edge.target);
      if (edge.target === activeId) result.add(edge.source);
    }
    return result;
  }, [activeId, graph.edges]);
  const edgeEndpoints = useMemo(() => new Map(graph.edges.map((edge, index) => [
    `${edge.id}-${index}`,
    [edge.source, edge.target] as const,
  ])), [graph.edges]);

  return <SigmaContainer
    className="size-full bg-[#f8fafc]"
    settings={{
      allowInvalidContainer: true,
      hideEdgesOnMove: true,
      labelRenderedSizeThreshold: 7,
      labelDensity: 0.8,
      defaultNodeColor: '#2563eb',
      defaultEdgeColor: '#cbd5e1',
      renderEdgeLabels: false,
      nodeReducer: (node, attributes) => activeId ? {
        ...attributes,
        color: neighbors.has(node) ? attributes.color : attributes.mutedColor,
        size: node === activeId ? attributes.size + 2 : attributes.size,
        highlighted: node === activeId,
        zIndex: neighbors.has(node) ? 1 : 0,
      } : attributes,
      edgeReducer: (edge, attributes) => {
        if (!activeId) return attributes;
        const [source, target] = edgeEndpoints.get(edge) ?? ['', ''];
        const connected = source === activeId || target === activeId;
        return { ...attributes, color: connected ? attributes.color : '#e2e8f0', size: connected ? 1.6 : 0.5, zIndex: connected ? 1 : 0 };
      },
    }}
  >
    <div role="list" aria-label="实体类型图例" className="pointer-events-none absolute left-4 top-3 z-10 flex max-w-[calc(100%-2rem)] flex-wrap gap-x-3 gap-y-1">
      {entityTypes.slice(0, 8).map((type) => <span role="listitem" key={type} className="flex items-center gap-1 text-[8px] font-medium text-slate-600"><span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: graphPaletteForType(type).node }} />{type}</span>)}
      {entityTypes.length > 8 ? <span className="text-[8px] text-slate-500">+{entityTypes.length - 8}</span> : null}
    </div>
    <GraphController data={graph} activeId={activeId} onNodeSelect={onNodeSelect} />
    <GraphControls />
  </SigmaContainer>;
}
