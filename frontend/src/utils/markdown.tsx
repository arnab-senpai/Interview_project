import React from "react";
import { renderInlineCode } from "./format";

function renderInlineFormatting(line: string): React.ReactNode {
  // Handle **bold** and `inline code` cleanly via safe React elements
  const boldParts = line.split(/(\*\*[^*]+\*\*)/g);
  return boldParts.map((seg, i) => {
    if (seg.startsWith("**") && seg.endsWith("**") && seg.length > 4) {
      return <strong key={i}>{renderInlineCode(seg.slice(2, -2))}</strong>;
    }
    return <React.Fragment key={i}>{renderInlineCode(seg)}</React.Fragment>;
  });
}

export function renderMarkdown(md: string): React.ReactNode {
  if (!md.trim()) {
    return (
      <div className="mono" style={{ fontSize: 12, color: "var(--ink-muted)" }}>
        Nothing written yet. Start capturing trade-offs, latency math, or hop quotes...
      </div>
    );
  }

  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block ```lang
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // consume closing fence
      blocks.push(
        <div
          key={`code-${i}`}
          style={{
            margin: "8px 0",
            borderRadius: 7,
            border: "1px solid var(--border)",
            background: "var(--bg-subtle)",
            overflow: "hidden",
          }}
        >
          {lang && (
            <div
              className="mono"
              style={{
                fontSize: 9.5,
                padding: "3px 10px",
                borderBottom: "1px solid var(--border-soft)",
                color: "var(--accent)",
                textTransform: "uppercase",
              }}
            >
              {lang}
            </div>
          )}
          <pre
            className="mono"
            style={{
              margin: 0,
              padding: "9px 11px",
              fontSize: 11.5,
              lineHeight: 1.5,
              overflowX: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {codeLines.join("\n")}
          </pre>
        </div>
      );
      continue;
    }

    // Headings
    if (line.startsWith("### ")) {
      blocks.push(
        <h4 key={`h3-${i}`} className="mono" style={{ margin: "12px 0 4px", fontSize: 13, color: "var(--accent)" }}>
          {renderInlineFormatting(line.slice(4))}
        </h4>
      );
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      blocks.push(
        <h3 key={`h2-${i}`} className="mono" style={{ margin: "14px 0 6px", fontSize: 14.5, color: "var(--ink-primary)" }}>
          {renderInlineFormatting(line.slice(3))}
        </h3>
      );
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      blocks.push(
        <h2
          key={`h1-${i}`}
          className="mono"
          style={{
            margin: "6px 0 8px",
            fontSize: 16.5,
            paddingBottom: 6,
            borderBottom: "1px solid var(--border-soft)",
          }}
        >
          {renderInlineFormatting(line.slice(2))}
        </h2>
      );
      i++;
      continue;
    }

    // Blockquote
    if (line.trim().startsWith("> ")) {
      blocks.push(
        <blockquote
          key={`bq-${i}`}
          style={{
            margin: "8px 0",
            padding: "6px 12px",
            borderLeft: "3px solid var(--accent)",
            background: "var(--accent-soft)",
            borderRadius: "0 6px 6px 0",
            fontSize: 12.5,
            lineHeight: 1.55,
            color: "var(--ink-primary)",
          }}
        >
          {renderInlineFormatting(line.trim().slice(2))}
        </blockquote>
      );
      i++;
      continue;
    }

    // Bullet list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={`ul-${i}`} style={{ margin: "6px 0 8px 18px", padding: 0, fontSize: 13, lineHeight: 1.6 }}>
          {items.map((item, idx) => (
            <li key={idx} style={{ marginBottom: 3 }}>
              {renderInlineFormatting(item)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Simple Markdown pipe table
    if (line.trim().startsWith("|") && lines[i + 1]?.trim().startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      const parseRow = (row: string) =>
        row
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());
      const headers = parseRow(tableLines[0]);
      const dataRows = tableLines.slice(2).map(parseRow);
      blocks.push(
        <table key={`tbl-${i}`} className="trace-table" style={{ margin: "8px 0", border: "1px solid var(--border-soft)" }}>
          <thead>
            <tr>
              {headers.map((h, hIdx) => (
                <th key={hIdx}>{renderInlineFormatting(h)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dataRows.map((row, rIdx) => (
              <tr key={rIdx}>
                {row.map((cell, cIdx) => (
                  <td key={cIdx} style={{ fontFamily: "var(--font-sans)" }}>
                    {renderInlineFormatting(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    blocks.push(
      <p key={`p-${i}`} style={{ margin: "6px 0", fontSize: 13, lineHeight: 1.62, color: "var(--ink-secondary)" }}>
        {renderInlineFormatting(line)}
      </p>
    );
    i++;
  }

  return <div>{blocks}</div>;
}
