import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { getLeanImportGraph, type LeanImportGraph } from '../../api';
import { useI18n } from '../../i18n';

export interface GraphProjectFilterOption {
  value: string;
  label: string;
  count: number;
}

interface GraphNode {
  id: string;
  document_id: number;
  label: string;
  module_name: string;
  path: string | null;
  title: string;
  imports: number;
  cited_by_count: number;
  source_kind: string;
  project_root: string | null;
  project_slug: string | null;
  project_title: string | null;
  owner_slug: string | null;
}

interface GraphLink {
  source: string;
  target: string;
  type: string;
}

interface AgentGraphProps {
  refreshKey?: number;
  onOpenProof?: (documentId: number) => void;
  projectFilter?: string;
  onProjectFilterChange?: (value: string) => void;
  onProjectOptionsChange?: (options: GraphProjectFilterOption[]) => void;
  hideProjectFilter?: boolean;
}

export function AgentGraph({
  refreshKey = 0,
  onOpenProof,
  projectFilter,
  onProjectFilterChange,
  onProjectOptionsChange,
  hideProjectFilter = false,
}: AgentGraphProps) {
  const { t } = useI18n();
  const [graphData, setGraphData] = useState<LeanImportGraph>({ nodes: [], links: [] });
  const [internalProjectFilter, setInternalProjectFilter] = useState('all');
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const activeProjectFilter = projectFilter ?? internalProjectFilter;

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

  const projectOptions = useMemo(() => {
    const optionMap = new Map<string, GraphProjectFilterOption>();

    for (const node of graphData.nodes as GraphNode[]) {
      if (!node.project_root) {
        continue;
      }

      const existing = optionMap.get(node.project_root);
      if (existing) {
        existing.count += 1;
        continue;
      }

      const ownerLabel = node.owner_slug ? `${node.owner_slug} / ` : '';
      optionMap.set(node.project_root, {
        value: node.project_root,
        label: `${ownerLabel}${node.project_title ?? node.project_slug ?? node.project_root}`,
        count: 1,
      });
    }

    return [...optionMap.values()].sort((left, right) => left.label.localeCompare(right.label));
  }, [graphData.nodes]);

  useEffect(() => {
    onProjectOptionsChange?.(projectOptions);
  }, [onProjectOptionsChange, projectOptions]);

  useEffect(() => {
    if (projectFilter !== undefined) {
      return;
    }
    if (internalProjectFilter === 'all' || internalProjectFilter === 'shared') {
      return;
    }

    if (!projectOptions.some((option) => option.value === internalProjectFilter)) {
      setInternalProjectFilter('all');
    }
  }, [internalProjectFilter, projectFilter, projectOptions]);

  const filteredGraphData = useMemo(() => {
    if (activeProjectFilter === 'all') {
      return graphData;
    }

    const filteredNodes = (graphData.nodes as GraphNode[]).filter((node) =>
      activeProjectFilter === 'shared' ? !node.project_root : node.project_root === activeProjectFilter,
    );
    const allowedIds = new Set(filteredNodes.map((node) => node.id));
    const filteredLinks = graphData.links.filter((link) => {
      const sourceId = typeof link.source === 'string' ? link.source : String((link.source as GraphNode).id);
      const targetId = typeof link.target === 'string' ? link.target : String((link.target as GraphNode).id);
      return allowedIds.has(sourceId) && allowedIds.has(targetId);
    });

    return {
      nodes: filteredNodes,
      links: filteredLinks,
    };
  }, [activeProjectFilter, graphData]);

  const filteredNodeCount = filteredGraphData.nodes.length;
  const getNodeColor = (node: GraphNode) =>
    node.source_kind === 'proof_workspace'
      ? '#00d4ff'
      : node.source_kind === 'playground'
        ? '#7b61ff'
        : node.source_kind === 'project'
          ? '#64f1a8'
          : '#ffb454';

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}>
      <div
        className="glass-panel"
        style={{
          position: 'absolute',
          top: '92px',
          right: '20px',
          zIndex: 12,
          width: 'min(320px, calc(100% - 40px))',
          padding: '14px',
          display: hideProjectFilter ? 'none' : 'flex',
          flexDirection: 'column',
          gap: '10px',
          pointerEvents: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '0.78rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
              {t('Graph Filter')}
            </div>
            <div style={{ fontWeight: 600 }}>{t('Lean Project Scope')}</div>
          </div>
          <span className="proof-badge">{t('{count} modules', { count: String(filteredNodeCount) })}</span>
        </div>
        <select
          className="input-field"
          value={activeProjectFilter}
          onChange={(event) => {
            if (projectFilter === undefined) {
              setInternalProjectFilter(event.target.value);
            }
            onProjectFilterChange?.(event.target.value);
          }}
        >
          <option value="all">{t('All indexed modules')}</option>
          <option value="shared">{t('Shared workspace only')}</option>
          {projectOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label} ({option.count})
            </option>
          ))}
        </select>
        <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          {activeProjectFilter === 'all'
            ? t('Showing every indexed Lean module in the manifold.')
            : activeProjectFilter === 'shared'
              ? t('Showing only modules saved outside project roots.')
              : t('Showing only modules indexed from the selected Lean project root.')}
        </div>
        {filteredNodeCount === 0 && (
          <div style={{ fontSize: '0.82rem', color: '#ffcf8b' }}>
            {t('No indexed Lean modules are available for this scope yet. Save a project file to add it to the manifold.')}
          </div>
        )}
      </div>
      {typeof window !== 'undefined' && dimensions.width > 0 && (
        <ForceGraph2D
          width={dimensions.width}
          height={dimensions.height}
          graphData={filteredGraphData as { nodes: GraphNode[]; links: GraphLink[] }}
          nodeLabel={(node) =>
            `${(node as GraphNode).module_name}\n${(node as GraphNode).path ?? ''}\nimports: ${(node as GraphNode).imports}\ncited by: ${(node as GraphNode).cited_by_count}\nsource: ${(node as GraphNode).source_kind}${
              (node as GraphNode).project_title ? `\nproject: ${(node as GraphNode).project_title}` : ''
            }`
          }
          nodeRelSize={7}
          nodeColor={(node) => getNodeColor(node as GraphNode)}
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
            const radius = Math.max(6, 5 + Math.max(typedNode.imports, typedNode.cited_by_count));

            ctx.beginPath();
            ctx.arc(typedNode.x ?? 0, typedNode.y ?? 0, radius, 0, 2 * Math.PI, false);
            ctx.fillStyle = getNodeColor(typedNode);
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
