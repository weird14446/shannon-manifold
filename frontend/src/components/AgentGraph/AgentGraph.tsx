import { useEffect, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { getLeanImportGraph, type LeanImportGraph } from '../../api';

interface GraphNode {
  id: string;
  document_id: number;
  label: string;
  module_name: string;
  path: string | null;
  title: string;
  imports: number;
  source_kind: string;
}

interface GraphLink {
  source: string;
  target: string;
  type: string;
}

interface AgentGraphProps {
  refreshKey?: number;
  onOpenProof?: (documentId: number) => void;
}

export function AgentGraph({ refreshKey = 0, onOpenProof }: AgentGraphProps) {
  const [graphData, setGraphData] = useState<LeanImportGraph>({ nodes: [], links: [] });
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    let isMounted = true;

    const fetchGraph = async () => {
      try {
        const graph = await getLeanImportGraph();
        if (isMounted) {
          setGraphData(graph);
        }
      } catch (error) {
        console.error('Lean import graph fetch error', error);
        if (isMounted) {
          setGraphData({ nodes: [], links: [] });
        }
      }
    };

    void fetchGraph();

    return () => {
      isMounted = false;
    };
  }, [refreshKey]);

  useEffect(() => {
    const updateDimensions = () => {
      if (!containerRef.current) {
        return;
      }

      setDimensions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}>
      {typeof window !== 'undefined' && dimensions.width > 0 && (
        <ForceGraph2D
          width={dimensions.width}
          height={dimensions.height}
          graphData={graphData as { nodes: GraphNode[]; links: GraphLink[] }}
          nodeLabel={(node) =>
            `${(node as GraphNode).module_name}\n${(node as GraphNode).path ?? ''}\nsource: ${(node as GraphNode).source_kind}`
          }
          nodeRelSize={7}
          nodeColor={(node) =>
            (node as GraphNode).source_kind === 'proof_workspace'
              ? '#00d4ff'
              : (node as GraphNode).source_kind === 'playground'
                ? '#7b61ff'
                : '#64f1a8'
          }
          linkColor={() => 'rgba(255, 255, 255, 0.18)'}
          linkDirectionalParticles={2}
          linkDirectionalParticleSpeed={0.008}
          linkWidth={1.4}
          cooldownTicks={120}
          onNodeDragEnd={(node) => {
            node.fx = node.x;
            node.fy = node.y;
          }}
          onNodeClick={(node) => {
            const typedNode = node as GraphNode;
            if (typedNode.document_id) {
              onOpenProof?.(typedNode.document_id);
            }
          }}
          nodeCanvasObject={(node, ctx, globalScale) => {
            const typedNode = node as GraphNode & { x?: number; y?: number };
            const label = typedNode.label;
            const fontSize = 12 / globalScale;
            const radius = Math.max(6, 5 + typedNode.imports);

            ctx.beginPath();
            ctx.arc(typedNode.x ?? 0, typedNode.y ?? 0, radius, 0, 2 * Math.PI, false);
            ctx.fillStyle =
              typedNode.source_kind === 'proof_workspace'
                ? '#00d4ff'
                : typedNode.source_kind === 'playground'
                  ? '#7b61ff'
                  : '#64f1a8';
            ctx.fill();

            ctx.font = `${fontSize}px Sans-Serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillStyle = '#ffffff';
            ctx.fillText(label, typedNode.x ?? 0, (typedNode.y ?? 0) + radius + 4);
          }}
        />
      )}
    </div>
  );
}
