import React, { useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { api, type AdminFeedbackItem, type FeedbackStatus } from "../api/client";

interface AdminFeedbackViewProps {
  topicTitleById: Record<string, string>;
}

const STATUS_TABS: Array<{ key: FeedbackStatus | "all"; label: string }> = [
  { key: "open", label: "Open" },
  { key: "resolved", label: "Resolved" },
  { key: "wont_fix", label: "Won't fix" },
  { key: "all", label: "All" },
];

/** Admin list of reviewer reports, grouped by topic. */
export const AdminFeedbackView: React.FC<AdminFeedbackViewProps> = ({ topicTitleById }) => {
  const [status, setStatus] = useState<FeedbackStatus | "all">("open");
  const [items, setItems] = useState<AdminFeedbackItem[]>([]);
  const [counts, setCounts] = useState<Record<string, Record<FeedbackStatus, number>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.adminListFeedback(status);
      setItems(res.feedback);
      setCounts(res.countsByTopic);
    } catch (err: any) {
      setError(err?.message || "Could not load feedback");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [status]);

  const grouped = useMemo(() => {
    const out: Record<string, AdminFeedbackItem[]> = {};
    for (const item of items) (out[item.topicId] ??= []).push(item);
    return Object.entries(out);
  }, [items]);

  const setItemStatus = async (item: AdminFeedbackItem, next: FeedbackStatus) => {
    const note = next === "open" ? item.adminNote : window.prompt("Optional note for this report", item.adminNote) ?? item.adminNote;
    await api.adminUpdateFeedback(item.id, next, note);
    await load();
  };

  const openTotal = Object.values(counts).reduce((sum, c) => sum + (c.open ?? 0), 0);

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 18 }}>Reviewer feedback</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-muted)" }}>
              {openTotal} open report{openTotal === 1 ? "" : "s"} across {Object.keys(counts).length} topic
              {Object.keys(counts).length === 1 ? "" : "s"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {STATUS_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setStatus(t.key)}
                className={`icon-btn ${status === t.key ? "active" : ""}`}
              >
                {t.label}
              </button>
            ))}
            <button className="icon-btn" onClick={load} title="Refresh" aria-label="Refresh">
              <RefreshCw size={13} />
            </button>
          </div>
        </div>

        {error && <div style={{ color: "var(--danger)", fontSize: 12.5 }}>{error}</div>}
        {!loading && grouped.length === 0 && (
          <div className="card" style={{ fontSize: 13, color: "var(--ink-muted)" }}>
            No reports in this list.
          </div>
        )}

        {grouped.map(([topicId, list]) => (
          <div key={topicId} className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <div style={{ fontWeight: 600 }}>{topicTitleById[topicId] ?? topicId}</div>
              <span className="mono" style={{ fontSize: 11, color: "var(--ink-muted)" }}>
                {topicId} · {counts[topicId]?.open ?? 0} open
              </span>
            </div>
            {list.map((item) => (
              <div
                key={item.id}
                style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}
              >
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: 11.5 }}>
                  <span className="badge badge-accent">{item.category}</span>
                  <span className="mono">{item.blockId}</span>
                  <span style={{ color: "var(--ink-muted)" }}>
                    {item.reporter} · {new Date(item.createdAt).toLocaleString()}
                  </span>
                  {!item.isCurrentVersion && (
                    <span className="badge badge-warn" title={`Reported on content version ${item.contentVersion}`}>
                      content changed since
                    </span>
                  )}
                  {item.status !== "open" && <span className="badge">{item.status.replace("_", " ")}</span>}
                </div>
                <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{item.message}</div>
                {item.adminNote && (
                  <div style={{ fontSize: 12, color: "var(--ink-secondary)" }}>Note: {item.adminNote}</div>
                )}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {item.status === "open" ? (
                    <>
                      <button className="btn-secondary" onClick={() => setItemStatus(item, "resolved")}>
                        Mark resolved
                      </button>
                      <button className="btn-secondary" onClick={() => setItemStatus(item, "wont_fix")}>
                        Won't fix
                      </button>
                    </>
                  ) : (
                    <button className="btn-secondary" onClick={() => setItemStatus(item, "open")}>
                      Reopen
                    </button>
                  )}
                  {item.issueUrl && (
                    <a className="btn-secondary" href={item.issueUrl} target="_blank" rel="noreferrer">
                      <ExternalLink size={12} /> GitHub issue
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};
