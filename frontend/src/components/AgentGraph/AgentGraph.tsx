import { useEffect, useState, useRef } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { getAgentEvents } from '../../api';

interface GraphData {
  nodes: { id: string; name: string; val: number }[];
  links: { source: string; target: string; action: string }[];
}

export function AgentGraph() {
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    // Basic agents
    const initialNodes = [
      { id: 'Prover', name: 'Prover AI', val: 5 },
      { id: 'Verifier', name: 'Verifier AI', val: 5 },
      { id: 'Refuter', name: 'Refuter AI', val: 5 },
      { id: 'Critic', name: 'Critic AI', val: 5 }
    ];

    const fetchEvents = async () => {
      try {
        const events = await getAgentEvents();
        const links = events.map((e: any) => ({
          source: e.agent_id,
          target: e.target,
          action: e.action
        })).filter((l: any) => l.source && l.target);

        setGraphData({
          nodes: initialNodes,
          links: links
        });
      } catch (e) {
        console.error("Agent events fetch error", e);
      }
    };

    fetchEvents();
    const interval = setInterval(fetchEvents, 3000); // Poll every 3 seconds
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (containerRef.current) {
      setDimensions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight
      });
    }
  }, []);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}>
      {typeof window !== 'undefined' && dimensions.width > 0 && (
        <ForceGraph2D
          width={dimensions.width}
          height={dimensions.height}
          graphData={graphData}
          nodeLabel="name"
          nodeColor={() => 'var(--accent-color)'}
          linkColor={() => 'rgba(255, 255, 255, 0.2)'}
          linkDirectionalParticles={2}
          linkDirectionalParticleSpeed={0.01}
          nodeCanvasObject={(node, ctx, globalScale) => {
            const label = node.name as string;
            const fontSize = 12/globalScale;
            ctx.font = `${fontSize}px Sans-Serif`;
            ctx.fillStyle = 'var(--text-primary)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            // Draw node circle
            ctx.beginPath();
            ctx.arc(node.x!, node.y!, 5, 0, 2 * Math.PI, false);
            ctx.fillStyle = '#7b61ff';
            ctx.fill();
            
            // Draw text
            ctx.fillStyle = 'white';
            ctx.fillText(label, node.x!, node.y! + 10);
          }}
        />
      )}
    </div>
  );
}
