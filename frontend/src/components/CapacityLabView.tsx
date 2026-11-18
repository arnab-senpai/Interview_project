import React, { useEffect, useState } from "react";
import { Calculator, Clock, Cpu, Gauge, Save } from "lucide-react";
import { api, type CapacityResult } from "../api/client";

export interface CapacityPresetInput {
  title: string;
  dau: number;
  actionsPerUserPerDay: number;
  peakMultiplier: number;
  avgPayloadBytes: number;
  retentionYears: number;
  readSharePercent: number;
}

interface CapacityLabViewProps {
  referenceData: any;
  initialPreset?: CapacityPresetInput | null;
}

const BUILTIN_PRESETS: CapacityPresetInput[] = [
  {
    title: "URL Shortener (TinyURL)",
    dau: 20_000_000,
    actionsPerUserPerDay: 20,
    peakMultiplier: 3,
    avgPayloadBytes: 500,
    retentionYears: 5,
    readSharePercent: 99,
  },
  {
    title: "News Feed (Twitter / X)",
    dau: 200_000_000,
    actionsPerUserPerDay: 5,
    peakMultiplier: 3,
    avgPayloadBytes: 1024,
    retentionYears: 5,
    readSharePercent: 98,
  },
  {
    title: "WhatsApp Chat",
    dau: 500_000_000,
    actionsPerUserPerDay: 40,
    peakMultiplier: 3,
    avgPayloadBytes: 250,
    retentionYears: 5,
    readSharePercent: 50,
  },
  {
    title: "Uber GPS Telemetry",
    dau: 2_000_000,
    actionsPerUserPerDay: 21600,
    peakMultiplier: 2,
    avgPayloadBytes: 128,
    retentionYears: 3,
    readSharePercent: 5,
  },
];

export const CapacityLabView: React.FC<CapacityLabViewProps> = ({
  referenceData,
  initialPreset,
}) => {
  const [form, setForm] = useState<CapacityPresetInput>(
    initialPreset ?? BUILTIN_PRESETS[0]
  );
  const [replicationFactor, setReplicationFactor] = useState(3);
  const [result, setResult] = useState<CapacityResult | null>(null);
  const [savedRuns, setSavedRuns] = useState<any[]>([]);
  const [activeRefTab, setActiveRefTab] = useState<"latency" | "nines" | "genai" | "framework">("latency");

  useEffect(() => {
    if (initialPreset) setForm(initialPreset);
  }, [initialPreset]);

  const runCalculation = async (saveRun = false) => {
    const res = await api.calculateCapacity({
      ...form,
      replicationFactor,
      saveRun,
    });
    setResult(res);
    if (saveRun) {
      const list = await api.getEstimatorRuns();
      setSavedRuns(list.runs);
    }
  };

  useEffect(() => {
    runCalculation(false);
  }, [form, replicationFactor]);

  useEffect(() => {
    api.getEstimatorRuns().then((r) => setSavedRuns(r.runs));
  }, []);

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
      <div style={{ maxWidth: 1320, margin: "0 auto", display: "grid", gridTemplateColumns: "1.05fr 0.95fr", gap: 18 }}>
        {/* Left: Interactive Estimator */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Calculator size={17} color="var(--accent)" />
                <span className="mono" style={{ fontWeight: 700, fontSize: 14 }}>
                  BACK-OF-THE-ENVELOPE CAPACITY LAB
                </span>
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {BUILTIN_PRESETS.map((p) => (
                  <button
                    key={p.title}
                    onClick={() => setForm(p)}
                    className="layer-pill"
                    style={{ fontSize: 10 }}
                  >
                    {p.title.split("(")[0].trim()}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label htmlFor="est-title" style={{ fontSize: 12 }}>
                <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-muted)", marginBottom: 3 }}>SCENARIO TITLE</div>
                <input
                  id="est-title"
                  name="title"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  style={{ width: "100%", padding: 7, borderRadius: 5, border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--ink-primary)" }}
                />
              </label>

              <label htmlFor="est-dau" style={{ fontSize: 12 }}>
                <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-muted)", marginBottom: 3 }}>DAILY ACTIVE USERS (DAU)</div>
                <input
                  id="est-dau"
                  name="dau"
                  type="number"
                  min={1}
                  value={form.dau}
                  onChange={(e) => setForm({ ...form, dau: Math.max(1, Number(e.target.value)) })}
                  className="mono"
                  style={{ width: "100%", padding: 7, borderRadius: 5, border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--ink-primary)" }}
                />
              </label>

              <label htmlFor="est-actions" style={{ fontSize: 12 }}>
                <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-muted)", marginBottom: 3 }}>ACTIONS / USER / DAY</div>
                <input
                  id="est-actions"
                  name="actionsPerUserPerDay"
                  type="number"
                  step="0.1"
                  min={0.1}
                  value={form.actionsPerUserPerDay}
                  onChange={(e) => setForm({ ...form, actionsPerUserPerDay: Math.max(0.1, Number(e.target.value)) })}
                  className="mono"
                  style={{ width: "100%", padding: 7, borderRadius: 5, border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--ink-primary)" }}
                />
              </label>

              <label htmlFor="est-peak" style={{ fontSize: 12 }}>
                <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-muted)", marginBottom: 3 }}>PEAK TRAFFIC MULTIPLIER (2x–5x)</div>
                <input
                  id="est-peak"
                  name="peakMultiplier"
                  type="number"
                  step="0.5"
                  min={1}
                  value={form.peakMultiplier}
                  onChange={(e) => setForm({ ...form, peakMultiplier: Math.max(1, Number(e.target.value)) })}
                  className="mono"
                  style={{ width: "100%", padding: 7, borderRadius: 5, border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--ink-primary)" }}
                />
              </label>

              <label htmlFor="est-payload" style={{ fontSize: 12 }}>
                <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-muted)", marginBottom: 3 }}>AVG PAYLOAD (BYTES)</div>
                <input
                  id="est-payload"
                  name="avgPayloadBytes"
                  type="number"
                  min={1}
                  value={form.avgPayloadBytes}
                  onChange={(e) => setForm({ ...form, avgPayloadBytes: Math.max(1, Number(e.target.value)) })}
                  className="mono"
                  style={{ width: "100%", padding: 7, borderRadius: 5, border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--ink-primary)" }}
                />
              </label>

              <label htmlFor="est-read-share" style={{ fontSize: 12 }}>
                <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-muted)", marginBottom: 3 }}>
                  READ SHARE ({form.readSharePercent}% Read / {100 - form.readSharePercent}% Write)
                </div>
                <input
                  id="est-read-share"
                  name="readSharePercent"
                  type="range"
                  min={1}
                  max={99}
                  value={form.readSharePercent}
                  onChange={(e) => setForm({ ...form, readSharePercent: Number(e.target.value) })}
                  style={{ width: "100%", marginTop: 8 }}
                />
              </label>

              <label htmlFor="est-retention" style={{ fontSize: 12 }}>
                <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-muted)", marginBottom: 3 }}>RETENTION (YEARS)</div>
                <input
                  id="est-retention"
                  name="retentionYears"
                  type="number"
                  min={1}
                  max={20}
                  value={form.retentionYears}
                  onChange={(e) => setForm({ ...form, retentionYears: Math.max(1, Number(e.target.value)) })}
                  className="mono"
                  style={{ width: "100%", padding: 7, borderRadius: 5, border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--ink-primary)" }}
                />
              </label>

              <label htmlFor="est-replication" style={{ fontSize: 12 }}>
                <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-muted)", marginBottom: 3 }}>REPLICATION FACTOR</div>
                <input
                  id="est-replication"
                  name="replicationFactor"
                  type="number"
                  min={1}
                  max={5}
                  value={replicationFactor}
                  onChange={(e) => setReplicationFactor(Math.max(1, Number(e.target.value)))}
                  className="mono"
                  style={{ width: "100%", padding: 7, borderRadius: 5, border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--ink-primary)" }}
                />
              </label>
            </div>

            <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
              <button className="btn-primary" onClick={() => runCalculation(true)}>
                <Save size={13} /> Save Snapshot to SQLite
              </button>
            </div>
          </div>

          {/* Worked Steps Output */}
          {result && (
            <div className="card">
              <div className="mono" style={{ fontWeight: 700, fontSize: 12, color: "var(--accent)", marginBottom: 10 }}>
                STEP-BY-STEP MENTAL MATH DERIVATION
              </div>
              {result.workedSteps.map((step) => (
                <div
                  key={step.label}
                  style={{
                    padding: "8px 10px",
                    marginBottom: 7,
                    borderRadius: 6,
                    background: "var(--bg-subtle)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div className="mono" style={{ fontSize: 11.5, fontWeight: 700 }}>{step.label}</div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--ink-muted)" }}>{step.formula}</div>
                  </div>
                  <span className="badge badge-accent" style={{ fontSize: 11.5 }}>{step.result}</span>
                </div>
              ))}
            </div>
          )}

          {savedRuns.length > 0 && (
            <div className="card">
              <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-muted)", marginBottom: 8 }}>
                SAVED ESTIMATION SNAPSHOTS
              </div>
              {savedRuns.map((run) => (
                <div key={run.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "5px 0", borderBottom: "1px solid var(--border-soft)" }}>
                  <span className="mono" style={{ fontWeight: 600 }}>{run.title}</span>
                  <span className="mono" style={{ color: "var(--accent)" }}>
                    {run.result?.metrics?.peakQps?.toLocaleString()} peak QPS · {run.result?.metrics?.replicatedRetentionTB} TB
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Reference Numbers, Availability Nines, GenAI Sizing & 45-min Framework */}
        <div className="card" style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
            <button onClick={() => setActiveRefTab("latency")} className={`layer-pill ${activeRefTab === "latency" ? "active" : ""}`}>
              <Clock size={11} style={{ marginRight: 4 }} /> LATENCY NUMBERS
            </button>
            <button onClick={() => setActiveRefTab("nines")} className={`layer-pill ${activeRefTab === "nines" ? "active" : ""}`}>
              <Gauge size={11} style={{ marginRight: 4 }} /> AVAILABILITY NINES
            </button>
            <button onClick={() => setActiveRefTab("genai")} className={`layer-pill ${activeRefTab === "genai" ? "active" : ""}`}>
              <Cpu size={11} style={{ marginRight: 4 }} /> GENAI / LLM SIZING
            </button>
            <button onClick={() => setActiveRefTab("framework")} className={`layer-pill ${activeRefTab === "framework" ? "active" : ""}`}>
              45-MIN FRAMEWORK
            </button>
          </div>

          {!referenceData ? (
            <div className="mono">Loading benchmarks...</div>
          ) : activeRefTab === "latency" ? (
            <table className="trace-table">
              <thead>
                <tr>
                  <th>TIER</th>
                  <th>OPERATION</th>
                  <th>LATENCY</th>
                </tr>
              </thead>
              <tbody>
                {referenceData.latencyBenchmarks.map((row: any) => (
                  <tr key={row.id}>
                    <td><span className="badge">{row.tier}</span></td>
                    <td style={{ fontFamily: "var(--font-sans)" }}>{row.operation}</td>
                    <td style={{ fontWeight: 700, color: "var(--accent)" }}>{row.latency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : activeRefTab === "nines" ? (
            <table className="trace-table">
              <thead>
                <tr>
                  <th>SLA</th>
                  <th>DOWNTIME / YEAR</th>
                  <th>DOWNTIME / MONTH</th>
                  <th>TYPICAL USE</th>
                </tr>
              </thead>
              <tbody>
                {referenceData.availabilityNines.map((row: any) => (
                  <tr key={row.nines}>
                    <td style={{ fontWeight: 700, color: "var(--accent)" }}>{row.nines}</td>
                    <td>{row.downtimePerYear}</td>
                    <td>{row.downtimePerMonth}</td>
                    <td style={{ fontFamily: "var(--font-sans)" }}>{row.typicalUse}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : activeRefTab === "genai" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {referenceData.genaiSizingMetrics.map((m: any) => (
                <div key={m.metric} style={{ padding: 10, borderRadius: 6, background: "var(--bg-subtle)" }}>
                  <div className="mono" style={{ fontWeight: 700, fontSize: 12.5, color: "var(--purple)" }}>{m.metric}</div>
                  <div style={{ fontSize: 12.5, marginTop: 4 }}><strong>Target:</strong> {m.target}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-secondary)", marginTop: 3 }}><strong>Levers:</strong> {m.levers}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {referenceData.interviewDeliveryFramework.map((p: any) => (
                <div key={p.step} style={{ padding: 10, borderRadius: 6, background: "var(--bg-subtle)" }}>
                  <div className="mono" style={{ fontWeight: 700, fontSize: 12 }}>
                    {p.step}. {p.phase} <span className="badge badge-accent">{p.targetMinutes}</span>
                  </div>
                  <ul style={{ margin: "6px 0 4px 16px", padding: 0, fontSize: 12 }}>
                    {p.checklist.map((c: string, i: number) => <li key={i}>{c}</li>)}
                  </ul>
                  <div style={{ fontSize: 11.5, color: "var(--danger)" }}>
                    <strong>Avoid:</strong> {p.antiPattern}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
