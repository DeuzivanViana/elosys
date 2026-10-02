"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  MarkerType,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX } from "d3-force";
import type { GraphEdgeKind, GraphNodeInfo, GraphSearchResult } from "@/lib/queries";
import { findCircularEdgeKeys } from "@/lib/graph-cycles";
import { formatBRL } from "@/lib/format";
import { EntityNode } from "./graph/entity-node";
import { FloatingEdge } from "./graph/floating-edge";
import { NODE_COLOR, NODE_KIND_LABEL, type GraphEdgeData, type GraphNodeData } from "./graph/types";
import { Skeleton } from "./skeleton";
import { useColorMode } from "@/lib/use-color-mode";

const WIDTH = 1100;
const HEIGHT = 700;
const MAX_CONNECTORS = 12;

const nodeTypes = { entity: EntityNode };
const edgeTypes = { floating: FloatingEdge };

type FlowNode = Node<GraphNodeData, "entity">;
type FlowEdge = Edge<GraphEdgeData, "floating">;

function radiusFor(type: "person" | "company"): number {
  return type === "person" ? 27 : 21;
}

async function safeFetchJson<T = Record<string, unknown>>(
  url: string, body: unknown
): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

type GraphEdgeRow = { source: string; target: string; kind: GraphEdgeKind; amountCents: number };
type GraphQueryResponse = { nodes?: GraphNodeInfo[]; edges?: GraphEdgeRow[] };

function edgeId(source: string, target: string, kind: string): string {
  return `${source}|${target}|${kind}`;
}

function toFlowNode(n: GraphNodeInfo, x: number, y: number, loading = false): FlowNode {
  return {
    id: n.cpfCnpj,
    type: "entity",
    position: { x, y },
    data: { ...n, radius: radiusFor(n.type), loading },
  };
}

function GraphCanvasInner() {
  const router = useRouter();
  const colorMode = useColorMode();
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GraphSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [minReais, setMinReais] = useState("");
  const [maxReais, setMaxReais] = useState("");
  const [roots, setRoots] = useState<Set<string>>(new Set());
  const boxRef = useRef<HTMLDivElement>(null);

  const [expandFull, setExpandFull] = useState(false);
  const [truncatedNotice, setTruncatedNotice] = useState<string | null>(null);

  const [searching, setSearching] = useState(false);
  const searchAbort = useRef<AbortController | null>(null);
  const onQueryChange = useCallback((value: string) => {
    setQ(value);
    searchAbort.current?.abort();
    if (value.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    searchAbort.current = controller;
    setSearching(true);
    setOpen(true);
    setTimeout(() => {
      if (controller.signal.aborted) return;
      fetch(`/api/graph-search?q=${encodeURIComponent(value)}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((data) => {
          setResults(data.results ?? []);
          setOpen(true);
        })
        .catch(() => {})
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 220);
  }, []);

  function applyCircularStyling(edgeList: FlowEdge[], nodeIds: string[]): FlowEdge[] {
    const circular = findCircularEdgeKeys(
      nodeIds,
      edgeList.map((e) => ({ source: e.source, target: e.target }))
    );
    return edgeList.map((e) => {
      const isCircular = circular.has(`${e.source}|${e.target}`);
      const kind = e.data!.kind;
      const color = isCircular ? "var(--red)" : kind === "donation" ? "var(--green)" : "var(--accent-2)";
      return {
        ...e,
        data: { ...e.data!, circular: isCircular },
        style: {
          stroke: color,
          strokeWidth: Math.min(2.6, 0.6 + Math.log10(Math.max(1, e.data!.amountCents) / 100) * 0.4),
          opacity: isCircular ? 0.95 : 0.55,
        },
        animated: isCircular,
        zIndex: isCircular ? 10 : 0,
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      };
    });
  }

  const runLayout = useCallback(
    (
      currentNodes: FlowNode[],
      newInfos: GraphNodeInfo[],
      allEdgesForLayout: Array<{ source: string; target: string; kind?: GraphEdgeKind }>
    ) => {
      const existingIds = new Set(currentNodes.map((n) => n.id));
      const brandNew = newInfos.filter((n) => !existingIds.has(n.cpfCnpj));
      const infoById = new Map(newInfos.map((n) => [n.cpfCnpj, n]));

      const patched = currentNodes.map((n) => {
        const info = infoById.get(n.id);
        if (!info) return n;
        return { ...n, data: { ...n.data, ...info, radius: n.data.radius, loading: n.data.loading } };
      });
      if (brandNew.length === 0) return patched;

      // Use infoById kind, not the stale one on currentNodes (node added and expanded in one click).
      const politicianX = new Map<string, number>();
      for (const n of currentNodes) {
        const kind = infoById.get(n.id)?.kind ?? n.data.kind;
        if (kind === "politician") politicianX.set(n.id, n.position.x);
      }
      for (const n of brandNew) {
        if (n.kind === "politician") politicianX.set(n.cpfCnpj, WIDTH / 2);
      }
      const SIDE_OFFSET = 260;
      const anchorX = new Map<string, number>();
      for (const e of allEdgesForLayout) {
        if (e.kind === "donation" && politicianX.has(e.target) && !politicianX.has(e.source)) {
          const px = politicianX.get(e.target)!;
          const prev = anchorX.get(e.source);
          anchorX.set(e.source, prev == null ? px - SIDE_OFFSET : (prev + (px - SIDE_OFFSET)) / 2);
        } else if (e.kind === "payment" && politicianX.has(e.source) && !politicianX.has(e.target)) {
          const px = politicianX.get(e.source)!;
          const prev = anchorX.get(e.target);
          anchorX.set(e.target, prev == null ? px + SIDE_OFFSET : (prev + (px + SIDE_OFFSET)) / 2);
        }
      }

      type SimNode = { id: string; x: number; y: number; fx?: number; fy?: number; r: number };
      const simNodes: SimNode[] = [
        ...currentNodes.map((n): SimNode => ({
          id: n.id, x: n.position.x, y: n.position.y,
          fx: n.position.x, fy: n.position.y, r: n.data.radius,
        })),
        ...brandNew.map((n): SimNode => {
          const bias = anchorX.get(n.cpfCnpj);
          return {
            id: n.cpfCnpj,
            x: bias ?? WIDTH / 2 + (Math.random() - 0.5) * 200,
            y: HEIGHT / 2 + (Math.random() - 0.5) * 200,
            r: radiusFor(n.type),
          };
        }),
      ];
      const simLinks = allEdgesForLayout.map((e) => ({ source: e.source, target: e.target }));
      const sim = forceSimulation(simNodes as never[])
        .force("link", forceLink(simLinks as never[]).id((d) => (d as SimNode).id)
          .distance(160).strength(0.15))
        .force("charge", forceManyBody().strength(-380))
        .force("collide", forceCollide((d) => (d as SimNode).r + 34))
        .force(
          "x",
          forceX<SimNode>((d) => anchorX.get(d.id) ?? d.x).strength((d) => (anchorX.has(d.id) ? 0.22 : 0))
        )
        .stop();
      for (let i = 0; i < 260; i++) sim.tick();

      const posById = new Map(simNodes.map((n) => [n.id, { x: n.x, y: n.y }]));
      const updated = patched.map((n) => {
        const p = posById.get(n.id);
        return p ? { ...n, position: p } : n;
      });
      const added = brandNew.map((n) => {
        const p = posById.get(n.cpfCnpj)!;
        return toFlowNode(n, p.x, p.y);
      });
      return [...updated, ...added];
    },
    []
  );

  const findPaths = useCallback(
    (newId: string) => {
      setNodes((current) => {
        const existingIds = current.map((n) => n.id).filter((id) => id !== newId);
        if (existingIds.length === 0) return current;
        const onCanvas = new Set(current.map((n) => n.id));

        safeFetchJson<GraphQueryResponse>("/api/graph-paths", { newId, existingIds }).then((data) => {
          if (!data) return;
          const infos: GraphNodeInfo[] = data.nodes ?? [];
          const edgeRows: GraphEdgeRow[] = data.edges ?? [];

          const bridges = new Map<string, { bridged: Set<string>; maxAmount: number }>();
          for (const e of edgeRows) {
            for (const [a, b] of [[e.source, e.target], [e.target, e.source]] as const) {
              if (onCanvas.has(a)) continue;
              const rec = bridges.get(a) ?? { bridged: new Set<string>(), maxAmount: 0 };
              if (onCanvas.has(b)) rec.bridged.add(b);
              rec.maxAmount = Math.max(rec.maxAmount, e.amountCents);
              bridges.set(a, rec);
            }
          }
          const keptConnectors = new Set(
            [...bridges.entries()]
              .sort((x, y) => y[1].bridged.size - x[1].bridged.size || y[1].maxAmount - x[1].maxAmount)
              .slice(0, MAX_CONNECTORS)
              .map(([id]) => id)
          );
          const finalIds = new Set([...onCanvas, ...keptConnectors]);
          const keptInfos = infos.filter((n) => keptConnectors.has(n.cpfCnpj) || onCanvas.has(n.cpfCnpj));
          const keptEdges = edgeRows.filter((e) => finalIds.has(e.source) && finalIds.has(e.target));

          setNodes((cur) => runLayout(cur, keptInfos, keptEdges));
          setEdges((prev) => {
            const byId = new Map(prev.map((e) => [e.id, e]));
            for (const e of keptEdges) {
              const id = edgeId(e.source, e.target, e.kind);
              if (!byId.has(id)) {
                byId.set(id, {
                  id, source: e.source, target: e.target, type: "floating",
                  data: { amountCents: e.amountCents, kind: e.kind, circular: false, showLabel: true },
                });
              }
            }
            return applyCircularStyling([...byId.values()], [...finalIds]);
          });
        });
        return current;
      });
    },
    [runLayout, setNodes, setEdges]
  );

  const expandNode = useCallback(
    (newId: string) => {
      setNodes((current) => {
        safeFetchJson<GraphQueryResponse & { truncated?: boolean }>("/api/graph-expand", { cpfCnpj: newId })
          .then((data) => {
            if (!data) return;
            const infos: GraphNodeInfo[] = data.nodes ?? [];
            const edgeRows: GraphEdgeRow[] = data.edges ?? [];
            const idsAfter = new Set([...current.map((n) => n.id), ...infos.map((n) => n.cpfCnpj)]);

            setNodes((cur) => runLayout(cur, infos, edgeRows));
            setEdges((prev) => {
              const byId = new Map(prev.map((e) => [e.id, e]));
              for (const e of edgeRows) {
                const id = edgeId(e.source, e.target, e.kind);
                if (!byId.has(id)) {
                  byId.set(id, {
                    id, source: e.source, target: e.target, type: "floating",
                    data: { amountCents: e.amountCents, kind: e.kind, circular: false, showLabel: true },
                  });
                }
              }
              return applyCircularStyling([...byId.values()], [...idsAfter]);
            });
            if (data.truncated) {
              const label = infos.find((n) => n.cpfCnpj === newId)?.label ?? newId;
              setTruncatedNotice(`${label}: mostrando só os 400 maiores vínculos.`);
            }
          });
        return current;
      });
    },
    [runLayout, setNodes, setEdges]
  );

  const addNode = useCallback(
    (r: GraphSearchResult) => {
      setQ("");
      setResults([]);
      setOpen(false);
      setRoots((prev) => new Set(prev).add(r.cpfCnpj));
      setNodes((current) => {
        if (current.some((n) => n.id === r.cpfCnpj)) return current;
        const info: GraphNodeInfo = {
          cpfCnpj: r.cpfCnpj, type: r.type, kind: r.type === "person" ? "person" : "company",
          label: r.label, sanctioned: false, registryStatus: null, personId: null, photoUrl: null,
        };
        return runLayout(current, [info], []);
      });
      setNodes((nds) =>
        nds.map((n) => (n.id === r.cpfCnpj ? { ...n, data: { ...n.data, loading: true } } : n))
      );
      safeFetchJson<{ node: GraphNodeInfo | null }>("/api/graph-node", { cpfCnpj: r.cpfCnpj })
        .then((data) => {
          if (data?.node) setNodes((current) => runLayout(current, [data.node!], []));
        })
        .finally(() => {
          setNodes((nds) =>
            nds.map((n) => (n.id === r.cpfCnpj ? { ...n, data: { ...n.data, loading: false } } : n))
          );
          if (expandFull) expandNode(r.cpfCnpj);
          else findPaths(r.cpfCnpj);
        });
    },
    [runLayout, findPaths, expandNode, expandFull, setNodes]
  );

  const searchParams = useSearchParams();
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    const raw = searchParams.get("add");
    if (!raw) return;
    seededRef.current = true;
    // queueMicrotask, not setTimeout: Strict Mode's effect cleanup would cancel the first run.
    queueMicrotask(() => {
      for (const id of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
        const type: "person" | "company" = id.length === 14 ? "company" : "person";
        addNode({ type, cpfCnpj: id, label: id, sublabel: null });
      }
    });
  }, [searchParams, addNode]);

  const onNodeClick: NodeMouseHandler<FlowNode> = useCallback((_evt, node) => {
    setSelected(node.id);
  }, []);

  function removeNode(cpfCnpj: string) {
    setNodes((nds) => nds.filter((n) => n.id !== cpfCnpj));
    setEdges((eds) => eds.filter((e) => e.source !== cpfCnpj && e.target !== cpfCnpj));
    setRoots((prev) => {
      const next = new Set(prev);
      next.delete(cpfCnpj);
      return next;
    });
    if (selected === cpfCnpj) setSelected(null);
  }

  function clearAll() {
    setNodes([]);
    setEdges([]);
    setRoots(new Set());
    setSelected(null);
  }

  const selectedNode = nodes.find((n) => n.id === selected) ?? null;
  const selectedEdges = useMemo(
    () => (selected ? edges.filter((e) => e.source === selected || e.target === selected) : []),
    [edges, selected]
  );
  const labelFor = (id: string) => nodes.find((n) => n.id === id)?.data.label ?? id;
  const circularCount = edges.filter((e) => e.data?.circular).length;

  const minCents = minReais.trim() === "" ? null : Math.round(Number(minReais) * 100);
  const maxCents = maxReais.trim() === "" ? null : Math.round(Number(maxReais) * 100);
  const amountFilterActive =
    (minCents != null && !Number.isNaN(minCents)) || (maxCents != null && !Number.isNaN(maxCents));

  const visibleEdges = useMemo(() => {
    if (!amountFilterActive) return edges;
    return edges.filter((e) => {
      const amt = e.data?.amountCents ?? 0;
      if (minCents != null && !Number.isNaN(minCents) && amt < minCents) return false;
      if (maxCents != null && !Number.isNaN(maxCents) && amt > maxCents) return false;
      return true;
    });
  }, [edges, amountFilterActive, minCents, maxCents]);

  const visibleNodes = useMemo(() => {
    if (!amountFilterActive) return nodes;
    const keep = new Set<string>(roots);
    if (selected) keep.add(selected);
    for (const e of visibleEdges) {
      keep.add(e.source);
      keep.add(e.target);
    }
    return nodes.filter((n) => keep.has(n.id));
  }, [nodes, visibleEdges, amountFilterActive, selected, roots]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border-1)] px-6 py-4">
        <div ref={boxRef} className="relative w-full max-w-md">
          <input
            value={q}
            onChange={(e) => onQueryChange(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="buscar candidato/empresa, ou colar CPF/CNPJ…"
            className="w-full rounded-sm border border-[var(--border-1)] bg-[var(--card-tone)] px-3 py-2.5 font-mono text-[12px] text-foreground placeholder:text-[var(--muted-2)] outline-none focus:border-[var(--border-2)]"
          />
          {open && (searching || results.length > 0) ? (
            <div className="absolute z-20 mt-1.5 max-h-[50vh] w-full overflow-y-auto rounded-sm border border-[var(--border-1)] bg-[var(--card-tone)] shadow-2xl">
              {searching && results.length === 0
                ? Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 border-b border-[var(--border-1)] px-3 py-2.5 last:border-0">
                      <Skeleton className="h-4 w-14 flex-none" />
                      <Skeleton className="h-3.5 flex-1" />
                    </div>
                  ))
                : results.map((r) => (
                    <button
                      key={r.cpfCnpj}
                      onMouseDown={() => addNode(r)}
                      className="flex w-full items-center gap-3 border-b border-[var(--border-1)] px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-[var(--hover)]"
                    >
                      <span className="flex-none rounded-sm border border-[var(--border-1)] px-1.5 py-0.5 font-mono text-[8.5px] tracking-[0.08em] text-[var(--muted)] uppercase">
                        {r.type === "person" ? "pessoa" : "empresa"}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px]">{r.label}</span>
                    </button>
                  ))}
            </div>
          ) : null}
        </div>
        <label
          className="flex items-center gap-1.5 cursor-pointer select-none"
          title="Ao adicionar, traz TODOS os vínculos diretos desse nó (doadores, fornecedores, candidatos), não só os que conectam com o que já está na tela."
        >
          <input
            type="checkbox"
            checked={expandFull}
            onChange={(e) => setExpandFull(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          <span className="mono-label !text-[var(--muted-2)]">trazer rede inteira</span>
        </label>
        <div className="flex items-center gap-1.5">
          <span className="mono-label !text-[var(--muted-2)]">movimentação</span>
          <input
            type="number"
            inputMode="decimal"
            value={minReais}
            onChange={(e) => setMinReais(e.target.value)}
            placeholder="mín. R$"
            className="w-24 rounded-sm border border-[var(--border-1)] bg-[var(--card-tone)] px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-[var(--muted-2)] outline-none focus:border-[var(--border-2)]"
          />
          <span className="text-[var(--muted-2)]">–</span>
          <input
            type="number"
            inputMode="decimal"
            value={maxReais}
            onChange={(e) => setMaxReais(e.target.value)}
            placeholder="máx. R$"
            className="w-24 rounded-sm border border-[var(--border-1)] bg-[var(--card-tone)] px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-[var(--muted-2)] outline-none focus:border-[var(--border-2)]"
          />
          {amountFilterActive ? (
            <button
              onClick={() => { setMinReais(""); setMaxReais(""); }}
              className="mono-label !text-[var(--muted-2)] hover:!text-[var(--fg-2)]"
            >
              limpar filtro
            </button>
          ) : null}
        </div>
        <span className="mono-label !text-[var(--muted-2)]">
          {visibleNodes.length} {visibleNodes.length === 1 ? "nó" : "nós"} · {visibleEdges.length} ligações
          {amountFilterActive ? ` (de ${nodes.length} · ${edges.length})` : ""}
        </span>
        {circularCount > 0 ? (
          <span className="mono-label flex items-center gap-1.5 !text-elo-red">
            <span className="size-1.5 animate-pulse rounded-full bg-elo-red" />
            {circularCount} em doação circular
          </span>
        ) : null}
        {truncatedNotice ? (
          <button
            onClick={() => setTruncatedNotice(null)}
            className="mono-label !text-elo-amber"
            title="clique pra dispensar"
          >
            ⚠ {truncatedNotice}
          </button>
        ) : null}
        {nodes.length > 0 ? (
          <button onClick={clearAll} className="mono-label ml-auto !text-[var(--muted)] hover:!text-[var(--fg-2)]">
            limpar tudo
          </button>
        ) : null}
      </div>

      <div className="relative flex-1">
        {nodes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="text-[18px] font-light text-[var(--muted)]">Adicione um candidato ou empresa</div>
            <p className="max-w-md text-[13px] leading-relaxed text-[var(--muted-2)]">
              Busque acima ou cole um CPF/CNPJ — por padrão, cada busca adiciona só aquele nó, e ao
              adicionar o próximo o grafo traz apenas o caminho de até 2 passos entre eles (ligação
              direta, ou por um doador/fornecedor/candidato em comum). Ligue &ldquo;trazer rede
              inteira&rdquo; se quiser que cada nó adicionado já venha com TODOS os seus vínculos diretos.
            </p>
          </div>
        ) : (
          <ReactFlow<FlowNode, FlowEdge>
            nodes={visibleNodes}
            edges={visibleEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            onPaneClick={() => setSelected(null)}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            colorMode={colorMode}
            fitView
            minZoom={0.15}
            proOptions={{ hideAttribution: true }}
          >
            <Background color={colorMode === "dark" ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.07)"} gap={28} size={1.4} />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              maskColor={colorMode === "dark" ? "rgba(8,8,10,.75)" : "rgba(255,255,255,.75)"}
              nodeColor={(n) => NODE_COLOR[(n as FlowNode).data.kind].stroke}
            />
          </ReactFlow>
        )}

        {selectedNode ? (
          <div className="absolute top-4 right-4 w-72 rounded-sm border border-[var(--border-1)] bg-[var(--card-tone)] p-4 shadow-2xl">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="mono-label !text-[8.5px]">{NODE_KIND_LABEL[selectedNode.data.kind]}</div>
                <div className="mt-1 truncate text-[14px]">{selectedNode.data.label}</div>
              </div>
              <button onClick={() => setSelected(null)} className="flex-none text-[var(--muted-2)] hover:text-[var(--fg-2)]">
                ✕
              </button>
            </div>
            {selectedNode.data.sanctioned ? (
              <div className="mt-2 font-mono text-[9.5px] text-elo-red">⚠ sanção federal (CEIS/CNEP)</div>
            ) : null}
            {selectedNode.data.registryStatus ? (
              <div className="mt-1 font-mono text-[9.5px] text-[var(--muted-2)]">
                situação: {selectedNode.data.registryStatus}
              </div>
            ) : null}

            {selectedEdges.length > 0 ? (
              <div className="mt-3 flex max-h-40 flex-col gap-2 overflow-y-auto border-t border-[var(--border-1)] pt-3">
                {selectedEdges.map((e) => (
                  <div
                    key={e.id}
                    className={`font-mono text-[10px] ${e.data?.circular ? "text-elo-red" : "text-[var(--muted)]"}`}
                  >
                    {e.source === selectedNode.id ? "→" : "←"}{" "}
                    {e.data?.kind === "donation" ? "doou pra" : "pagou"}{" "}
                    {labelFor(e.source === selectedNode.id ? e.target : e.source)}
                    <span className="text-[var(--muted-2)]"> · {formatBRL(e.data?.amountCents ?? 0)}</span>
                    {e.data?.circular ? " ⚠ circular" : ""}
                  </div>
                ))}
              </div>
            ) : null}

            <div className="mt-4 flex gap-2">
              <button
                onClick={() =>
                  router.push(selectedNode.id.length === 14 ? `/cnpj/${selectedNode.id}` : `/cpf/${selectedNode.id}`)
                }
                className="flex-1 rounded-sm bg-foreground py-2 font-mono text-[10px] tracking-[0.1em] text-background uppercase hover:bg-elo-amber"
              >
                ver ficha completa
              </button>
              <button
                onClick={() => removeNode(selectedNode.id)}
                className="rounded-sm border border-[var(--border-2)] px-3 py-2 font-mono text-[10px] tracking-[0.1em] text-[var(--muted)] uppercase hover:border-[var(--border-2)] hover:text-foreground"
              >
                remover
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-4 border-t border-[var(--border-1)] px-6 py-3 font-mono text-[9px] tracking-[0.1em] text-[var(--muted-2)] uppercase">
        {(Object.keys(NODE_COLOR) as Array<keyof typeof NODE_COLOR>).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-full border"
              style={{ backgroundColor: NODE_COLOR[k].fill, borderColor: NODE_COLOR[k].stroke }}
            />
            {NODE_KIND_LABEL[k]}
          </span>
        ))}
        <span className="ml-2 flex items-center gap-1.5">
          <span className="inline-block h-[2px] w-4 bg-elo-green" /> doação
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-[2px] w-4" style={{ background: "var(--accent-2)" }} /> pagamento
        </span>
        <span className="flex items-center gap-1.5 !text-elo-red">
          <span className="inline-block h-[2px] w-4 bg-elo-red" /> caminho de doação circular
        </span>
      </div>
    </div>
  );
}

export function GraphCanvas() {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner />
    </ReactFlowProvider>
  );
}
