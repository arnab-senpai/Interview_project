import React, { useMemo, useState } from "react";
import { IsometricNodeGlyph } from "../IsometricCanvas";
import {
  computeFigureNumbers,
  formatRate,
  formatValue,
  resolveFigure,
  type ComponentNumbers,
  type FigureNumbers,
  type ResolvedFigure,
} from "../../content/numbers";
import type { FigureBlock, TopicV2 } from "../../content/types";

// Same isometric look as the Sandbox, drawn as plain 2D SVG.
// Grid spacing is wider than the Sandbox tile so each part's label box has room.
const TILE_W = 86;
const TILE_H = 49;
const project = (gx: number, gy: number) => ({ x: (gx - gy) * TILE_W, y: (gx + gy) * TILE_H });

interface ChapterFigureProps {
  topic: TopicV2;
  block: FigureBlock;
  env: Record<string, number>;
  /** Ids whose numbers moved >10% after the last input change. */
  changedIds?: Set<string>;
  compact?: boolean;
  showLegend?: boolean;
}

function stateColor(n: ComponentNumbers | undefined): string | null {
  if (!n) return null;
  if (n.state === "over") return "var(--danger)";
  if (n.state === "warm") return "var(--warn)";
  return null;
}

function componentLine(n: ComponentNumbers | undefined, unit: string): string {
  if (!n || n.load === null) return "";
  const rate = unit.endsWith("/s") ? `${formatValue(n.load, "")} ${unit}` : formatRate(n.load);
  if (n.instances === null) return rate;
  if (n.autoSized) return `${rate} · needs ${n.instances}`;
  return `${rate} · ${Math.round((n.utilization ?? 0) * 100)}%`;
}

export const ChapterFigure: React.FC<ChapterFigureProps> = ({ topic, block, env, changedIds, compact = false, showLegend = true }) => {
  const fig = useMemo<ResolvedFigure | null>(() => resolveFigure(topic, block.id), [topic, block.id]);
  const numbers = useMemo<FigureNumbers | null>(() => (fig ? computeFigureNumbers(fig, env) : null), [fig, env]);
  const [selected, setSelected] = useState<string | null>(null);

  if (block.figureKind !== "topology") {
    return (
      <div className="card" style={{ padding: 16, fontSize: 13, color: "var(--ink-muted)" }}>
        This figure kind ({block.figureKind}) is not drawn yet.
      </div>
    );
  }
  if (!fig || !numbers) return null;

  const pts = new Map(fig.components.map((c) => [c.id, project(c.pos[0], c.pos[1])]));
  const xs = [...pts.values()].map((p) => p.x);
  const ys = [...pts.values()].map((p) => p.y);
  const maxMetrics = Math.max(0, ...fig.components.map((c) => c.metrics?.length ?? 0));
  const pad = { l: 120, r: 120, t: 70, b: compact ? 70 : 96 + maxMetrics * 13 };
  const minX = Math.min(...xs) - pad.l;
  const maxX = Math.max(...xs) + pad.r;
  const minY = Math.min(...ys) - pad.t;
  const maxY = Math.max(...ys) + pad.b;
  const width = Math.max(420, maxX - minX);
  const height = Math.max(220, maxY - minY);

  // Parallel arrows between the same two parts are offset so both stay readable.
  const pairCount = new Map<string, number>();
  const pairIndex = new Map<string, number>();
  for (const a of fig.arrows) {
    const key = [a.from, a.to].sort().join("|");
    pairIndex.set(a.id, pairCount.get(key) ?? 0);
    pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
  }

  // Boxes the part labels occupy, so arrow labels can step clear of them.
  type Box = { x1: number; y1: number; x2: number; y2: number };
  const partBoxes: Box[] = fig.components.map((c) => {
    const p = pts.get(c.id)!;
    const line = componentLine(numbers.components[c.id], c.loadUnit);
    const w = Math.max(96, Math.max(c.label.length * 6.4, line.length * 5.9) + 18);
    return { x1: p.x - w / 2, y1: p.y - 30, x2: p.x + w / 2, y2: p.y + 76 + (c.metrics?.length ?? 0) * 13 };
  });
  const placed: Box[] = [];
  const hits = (b: Box) => [...partBoxes, ...placed].some((o) => b.x1 < o.x2 && b.x2 > o.x1 && b.y1 < o.y2 && b.y2 > o.y1);

  const arrowGeo = fig.arrows.flatMap((a) => {
    const p1 = pts.get(a.from);
    const p2 = pts.get(a.to);
    if (!p1 || !p2) return [];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;
    const nx = -uy;
    const ny = ux;
    const key = [a.from, a.to].sort().join("|");
    const total = pairCount.get(key) ?? 1;
    const idx = pairIndex.get(a.id) ?? 0;
    const off = total > 1 ? (idx - (total - 1) / 2) * 16 : 0;
    const padStart = 34;
    const padEnd = 38;
    const sx = p1.x + ux * padStart + nx * off;
    const sy = p1.y + uy * padStart + ny * off;
    const tx = p2.x - ux * padEnd + nx * off;
    const ty = p2.y - uy * padEnd + ny * off;
    const isNew = fig.highlight.has(a.id);
    const isChanged = Boolean(changedIds?.has(a.id));
    // Parallel arrows push their labels apart along the normal.
    const side = total > 1 ? (idx - (total - 1) / 2) * 44 : 0;
    // Start on the arrow's upper side, then step outwards until the label is clear.
    const ox = ny > 0 ? -nx : nx;
    const oy = ny > 0 ? -ny : ny;
    const halfW = Math.max(36, a.label.length * 2.9 + 8);
    let mx = 0;
    let my = 0;
    for (let k = 0; k < 10; k++) {
      const t = 0.5 + (k % 2 === 0 ? 1 : -1) * 0.04 * k;
      const d = 30 + side + k * 9;
      mx = sx + (tx - sx) * t + ox * d;
      my = sy + (ty - sy) * t + oy * d - 4;
      if (!hits({ x1: mx - halfW, y1: my - 17, x2: mx + halfW, y2: my + 15 })) break;
    }
    placed.push({ x1: mx - halfW, y1: my - 17, x2: mx + halfW, y2: my + 15 });
    return [
      {
        a,
        sx,
        sy,
        tx,
        ty,
        isNew,
        isChanged,
        rate: numbers.arrows[a.id],
        mx,
        my,
        stroke: isNew ? "var(--highlight)" : isChanged ? "var(--accent)" : "var(--edge-strong)",
      },
    ];
  });

  const sel = selected ? fig.components.find((c) => c.id === selected) : null;
  const selNum = sel ? numbers.components[sel.id] : undefined;

  return (
    <figure style={{ margin: 0 }} aria-label={block.title}>
      {!compact && (
        <figcaption style={{ marginBottom: 8 }}>
          <div style={{ fontWeight: 650, fontSize: 15, color: "var(--ink-primary)" }}>{block.title}</div>
          {block.caption && <div style={{ fontSize: 12.5, color: "var(--ink-muted)", marginTop: 2 }}>{block.caption}</div>}
        </figcaption>
      )}
      <div
        className="blueprint-grid"
        style={{ borderRadius: 12, border: "1px solid var(--border-soft)", background: "var(--bg-surface)", overflow: "hidden" }}
      >
        <svg
          viewBox={`${minX} ${minY} ${width} ${height}`}
          width="100%"
          style={{ display: "block", maxHeight: compact ? 220 : 540 }}
          role="img"
          aria-label={`${block.title}. ${block.claims.join(" ")}`}
        >
          <defs>
            <marker id={`arrow-${block.id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--edge-strong)" />
            </marker>
            <marker id={`arrow-hl-${block.id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--highlight)" />
            </marker>
          </defs>

          {arrowGeo.map((g) => (
            <line
              key={g.a.id}
              x1={g.sx}
              y1={g.sy}
              x2={g.tx}
              y2={g.ty}
              stroke={g.stroke}
              strokeWidth={g.isNew || g.isChanged ? 2.2 : 1.5}
              strokeDasharray={g.a.mode === "async" ? "6 5" : undefined}
              markerEnd={`url(#${g.isNew ? "arrow-hl-" : "arrow-"}${block.id})`}
            />
          ))}

          {fig.components.map((c) => {
            const p = pts.get(c.id)!;
            const n = numbers.components[c.id];
            const isNew = fig.highlight.has(c.id);
            const isChanged = changedIds?.has(c.id);
            const warn = stateColor(n);
            const line = componentLine(n, c.loadUnit);
            const labelW = Math.max(96, Math.max(c.label.length * 6.4, line.length * 5.9) + 18);
            return (
              <g
                key={c.id}
                transform={`translate(${p.x}, ${p.y})`}
                onClick={() => setSelected((s) => (s === c.id ? null : c.id))}
                style={{ cursor: "pointer" }}
                role="button"
                aria-label={`${c.label}${line ? `, ${line}` : ""}`}
              >
                <title>{[c.label, c.load ? `load = ${c.load}` : "", c.capacitySource ?? ""].filter(Boolean).join("\n")}</title>
                {(isNew || warn || isChanged) && (
                  <ellipse
                    cx={0}
                    cy={14}
                    rx={40}
                    ry={17}
                    fill="none"
                    stroke={warn ?? (isNew ? "var(--highlight)" : "var(--accent)")}
                    strokeWidth={2}
                    strokeDasharray={isChanged && !isNew && !warn ? "4 3" : undefined}
                  />
                )}
                <IsometricNodeGlyph kind={c.kind} active={isNew || selected === c.id} faulted={n?.state === "over"} completedClient={false} />
                {!compact && (
                  <g transform="translate(0, 40)">
                    <rect
                      x={-labelW / 2}
                      y={0}
                      width={labelW}
                      height={line ? 34 : 20}
                      rx={7}
                      fill="var(--bg-surface)"
                      stroke={warn ?? (isNew ? "var(--highlight)" : "var(--border)")}
                      strokeWidth={warn || isNew ? 1.4 : 1}
                    />
                    <text x={0} y={13} textAnchor="middle" fontSize={11} fontWeight={650} fill="var(--ink-primary)">
                      {c.label}
                    </text>
                    {line && (
                      <text x={0} y={27} textAnchor="middle" fontSize={10} className="mono" fill={warn ?? "var(--ink-secondary)"}>
                        {line}
                      </text>
                    )}
                    {n?.metrics.map((m, i) => (
                      <text key={m.label} x={0} y={(line ? 46 : 32) + i * 13} textAnchor="middle" fontSize={10} className="mono" fill="var(--ink-muted)">
                        {m.label}: {formatValue(m.value, m.unit)}
                      </text>
                    ))}
                    {isNew && (
                      <text x={labelW / 2 - 4} y={-4} textAnchor="end" fontSize={9} fontWeight={700} fill="var(--highlight)">
                        NEW
                      </text>
                    )}
                  </g>
                )}
              </g>
            );
          })}
          {/* Arrow labels go on top of the parts so neither hides the other's numbers. */}
          {!compact &&
            arrowGeo.map(({ a, mx, my, rate, isChanged }) => (
              <g key={`${a.id}-label`} transform={`translate(${mx}, ${my})`}>
                <title>{`${a.label}${a.rate ? `\n${a.rate}` : ""}`}</title>
                <rect
                  x={-Math.max(36, a.label.length * 2.9 + 8)}
                  y={-17}
                  width={Math.max(72, a.label.length * 5.8 + 16)}
                  height={rate !== null && rate !== undefined ? 32 : 18}
                  rx={6}
                  fill="var(--bg-surface)"
                  stroke={isChanged ? "var(--accent)" : "var(--border-soft)"}
                  opacity={0.96}
                />
                <text x={0} y={-5} textAnchor="middle" fontSize={10} fill="var(--ink-secondary)">
                  {a.order ? `${a.order}. ` : ""}
                  {a.label}
                </text>
                {rate !== null && rate !== undefined && (
                  <text x={0} y={9} textAnchor="middle" fontSize={11} fontWeight={700} className="mono" fill={isChanged ? "var(--accent)" : "var(--ink-primary)"}>
                    {formatRate(rate)}
                  </text>
                )}
              </g>
            ))}
        </svg>
      </div>

      {!compact && showLegend && (
        <div className="chapter-legend" style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 11.5, color: "var(--ink-muted)", marginTop: 8 }}>
          <span>
            <svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke="var(--edge-strong)" strokeWidth="1.6" /></svg> synchronous call
          </span>
          <span>
            <svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke="var(--edge-strong)" strokeWidth="1.6" strokeDasharray="5 4" /></svg> asynchronous
          </span>
          <span>numbers on arrows: requests a second at peak</span>
          <span style={{ color: "var(--highlight)" }}>● new in this step</span>
          <span style={{ color: "var(--warn)" }}>● above 60% of capacity</span>
          <span style={{ color: "var(--danger)" }}>● over capacity</span>
          <span style={{ color: "var(--accent)" }}>◌ moved after your last change</span>
        </div>
      )}

      {!compact && sel && (
        <div className="card" style={{ marginTop: 10, padding: 12, fontSize: 12.5 }}>
          <div style={{ fontWeight: 650 }}>
            {sel.label} {sel.example && <span style={{ color: "var(--ink-muted)", fontWeight: 400 }}>({sel.example})</span>}
          </div>
          {sel.note && <div style={{ marginTop: 4, color: "var(--ink-secondary)" }}>{sel.note}</div>}
          {selNum?.load !== null && selNum?.load !== undefined && (
            <div className="mono" style={{ marginTop: 6, fontSize: 11.5 }}>
              load = {sel.load} = {formatValue(selNum.load, sel.loadUnit)}
            </div>
          )}
          {selNum?.capacity && (
            <div style={{ marginTop: 4, color: "var(--ink-secondary)" }}>
              One instance handles about {formatValue(selNum.capacity, sel.loadUnit)}.{" "}
              {selNum.autoSized
                ? `At a 60% target that needs ${selNum.instances} instance${selNum.instances === 1 ? "" : "s"}.`
                : `With ${selNum.instances} instance${selNum.instances === 1 ? "" : "s"} it runs at ${Math.round((selNum.utilization ?? 0) * 100)}%.`}
              {sel.capacitySource && <div style={{ color: "var(--ink-muted)", fontSize: 11.5, marginTop: 2 }}>Source: {sel.capacitySource}</div>}
            </div>
          )}
          {selNum?.metrics.map((m) => (
            <div key={m.label} className="mono" style={{ marginTop: 4, fontSize: 11.5 }}>
              {m.label} = {m.formula} = {formatValue(m.value, m.unit)}
            </div>
          ))}
        </div>
      )}
    </figure>
  );
};
