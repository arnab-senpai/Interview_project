import React from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";

export type PathStatus = "completed" | "in_progress" | "not_started";

export interface PathStop {
  id: string;
  code: string;
  title: string;
  subtitle: string;
  status: PathStatus;
  done: number;
  total: number;
  group?: string;
}

interface RoadmapPathProps {
  stops: PathStop[];
  selectedId: string;
  onSelect: (id: string) => void;
}

/**
 * A calm, readable learning path: numbered stops on a single rail, each with
 * progress. Replaces the old orbiting 3D universe. Order carries meaning
 * (module 1 before module 2), so the layout is a list, not a scatter.
 */
export const RoadmapPath: React.FC<RoadmapPathProps> = ({ stops, selectedId, onSelect }) => {
  let lastGroup: string | undefined;

  return (
    <ol className="path-list" role="list">
      {stops.map((stop, idx) => {
        const showGroup = stop.group && stop.group !== lastGroup;
        lastGroup = stop.group;
        const pct = stop.total > 0 ? Math.round((stop.done / stop.total) * 100) : 0;
        const isSelected = stop.id === selectedId;
        const isLast = idx === stops.length - 1;
        const nextGroupChanges = !isLast && stops[idx + 1].group !== stop.group;

        return (
          <React.Fragment key={stop.id}>
            {showGroup && <li className="path-group-label">{stop.group}</li>}
            <motion.li
              className={`path-stop ${isSelected ? "selected" : ""} status-${stop.status}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, delay: Math.min(idx, 10) * 0.035, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="path-rail" aria-hidden="true">
                <span className="path-marker">
                  {stop.status === "completed" ? <Check size={13} strokeWidth={2.6} /> : stop.code}
                </span>
                {!isLast && !nextGroupChanges && <span className="path-connector" />}
              </div>

              <button
                type="button"
                className="path-card"
                onClick={() => onSelect(stop.id)}
                aria-pressed={isSelected}
              >
                <div className="path-card-head">
                  <span className="path-title">{stop.title}</span>
                  {stop.status === "in_progress" && <span className="path-chip">In progress</span>}
                  {stop.status === "completed" && <span className="path-chip done">Done</span>}
                </div>
                <div className="path-sub">{stop.subtitle}</div>
                {stop.total > 0 && (
                  <div className="path-progress" aria-label={`${stop.done} of ${stop.total} complete`}>
                    <span className="path-progress-track">
                      <motion.span
                        className="path-progress-fill"
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                      />
                    </span>
                    <span className="path-progress-label">
                      {stop.done}/{stop.total}
                    </span>
                  </div>
                )}
              </button>
            </motion.li>
          </React.Fragment>
        );
      })}
    </ol>
  );
};
