import React from "react";
import { Flame, Target, Trophy } from "lucide-react";
import type { StreakSummary } from "../api/client";

interface StreakHeatmapCardProps {
  streak: StreakSummary | null;
  compact?: boolean;
}

const LEVEL_STYLES: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: "var(--bg-subtle)",
  1: "color-mix(in srgb, var(--highlight) 25%, var(--bg-subtle))",
  2: "color-mix(in srgb, var(--highlight) 45%, var(--bg-subtle))",
  3: "color-mix(in srgb, var(--highlight) 70%, var(--bg-subtle))",
  4: "color-mix(in srgb, var(--highlight) 100%, var(--bg-subtle))",
};

export const StreakHeatmapCard: React.FC<StreakHeatmapCardProps> = ({ streak, compact = false }) => {
  const days = streak?.heatmap ?? [];
  const todayActions = streak?.todayActions ?? 0;
  const dailyGoal = Math.max(1, streak?.dailyGoal ?? 3);
  const pct = Math.min(100, Math.round((todayActions / dailyGoal) * 100));

  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - pct / 100);

  return (
    <div
      className="card hero-nebula-card"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 18,
        padding: compact ? "12px 16px" : "16px 22px",
      }}
    >
      {/* Left metrics: Ring + Current & Longest Streak */}
      <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <div style={{ position: "relative", width: 56, height: 56, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width={56} height={56} style={{ transform: "rotate(-90deg)" }}>
            <circle cx={28} cy={28} r={radius} fill="none" stroke="var(--border)" strokeWidth={5} />
            <circle
              cx={28}
              cy={28}
              r={radius}
              fill="none"
              stroke="url(#streak-ring-grad)"
              strokeWidth={5}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              style={{ transition: "stroke-dashoffset 0.5s ease" }}
            />
            <defs>
              <linearGradient id="streak-ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style={{ stopColor: "var(--accent)" }} />
                <stop offset="100%" style={{ stopColor: "var(--success)" }} />
              </linearGradient>
            </defs>
          </svg>
          <span className="mono" style={{ position: "absolute", fontSize: 11, fontWeight: 700, color: "var(--accent)" }}>
            {pct}%
          </span>
        </div>

        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          <div>
            <div className="mono" style={{ fontSize: 10, color: "var(--ink-muted)", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
              <Flame size={11} color="var(--highlight)" /> CURRENT STREAK
            </div>
            <div className="streak-hand" style={{ fontSize: 22, marginTop: 2 }}>
              {streak?.currentStreak ?? 0}d
            </div>
          </div>

          <div>
            <div className="mono" style={{ fontSize: 10, color: "var(--ink-muted)", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
              <Target size={11} color="var(--accent)" /> TODAY'S GOAL
            </div>
            <div className="mono" style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>
              {todayActions} <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>/ {dailyGoal}</span>
            </div>
          </div>

          <div>
            <div className="mono" style={{ fontSize: 10, color: "var(--ink-muted)", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
              <Trophy size={11} color="var(--success)" /> BEST STREAK
            </div>
            <div className="mono" style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>
              {streak?.longestStreak ?? 0}d
            </div>
          </div>
        </div>
      </div>

      {/* Right 12-week Heatmap Matrix */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 12 }}>
          <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-muted)" }}>
            12-WEEK DAILY STUDY HEATMAP
          </span>
          <span className="mono" style={{ fontSize: 10, color: "var(--ink-muted)" }}>
            {streak?.activeDays ?? 0} active days
          </span>
        </div>
        <div
          style={{
            display: "grid",
            gridAutoFlow: "column",
            gridTemplateRows: "repeat(7, 11px)",
            gap: 3.5,
          }}
        >
          {days.map((day) => (
            <div
              key={day.date}
              title={`${day.date}: ${day.count} actions (${day.lessons} lessons, ${day.flashcards} cards, ${day.quizzes} quizzes, ${day.notes} notes)`}
              style={{
                width: 11,
                height: 11,
                borderRadius: 2.5,
                background: LEVEL_STYLES[day.level],
                border: "1px solid var(--border-soft)",
                
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
