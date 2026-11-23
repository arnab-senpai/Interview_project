import { TERM_CLOSE, TERM_OPEN, termById } from "../content/glossary";
import React from "react";

const ACRONYMS: Record<string, string> = {
  acid: "ACID",
  acl: "ACL",
  api: "API",
  apis: "APIs",
  cdc: "CDC",
  cdn: "CDN",
  cpu: "CPU",
  dash: "DASH",
  dau: "DAU",
  db: "DB",
  dns: "DNS",
  gb: "GB",
  gbps: "Gbps",
  gop: "GOP",
  gpu: "GPU",
  grpc: "gRPC",
  hls: "HLS",
  http: "HTTP",
  https: "HTTPS",
  id: "ID",
  ids: "IDs",
  io: "I/O",
  ip: "IP",
  ips: "IPs",
  jwt: "JWT",
  kb: "KB",
  llm: "LLM",
  lsm: "LSM",
  mau: "MAU",
  mb: "MB",
  mbps: "Mbps",
  ms: "ms",
  mvcc: "MVCC",
  nvme: "NVMe",
  oauth: "OAuth",
  p95: "P95",
  p99: "P99",
  pb: "PB",
  psp: "PSP",
  qps: "QPS",
  rag: "RAG",
  ram: "RAM",
  rps: "RPS",
  sla: "SLA",
  slo: "SLO",
  sql: "SQL",
  sse: "SSE",
  ssd: "SSD",
  ssi: "SSI",
  tb: "TB",
  tcp: "TCP",
  tls: "TLS",
  tps: "TPS",
  ttl: "TTL",
  udp: "UDP",
  url: "URL",
  urls: "URLs",
  vip: "VIP",
  vod: "VOD",
  wal: "WAL",
};

export function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`;
}

export function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      if (ACRONYMS[lower]) return ACRONYMS[lower];
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

export function renderInlineCode(text: string): React.ReactNode {
  if (!text.includes("`")) return renderTerms(text);
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return (
        <code key={idx} className="inline-code">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={idx}>{renderTerms(part)}</React.Fragment>;
  });
}

/** Glossary markers (⟦id|word⟧, added by markTerms) become underlined terms with a definition. */
function renderTerms(text: string): React.ReactNode {
  if (!text.includes(TERM_OPEN)) return text;
  const parts = text.split(/(\u27e6[^\u27e7]*\u27e7)/g);
  return parts.map((part, idx) => {
    if (part.startsWith(TERM_OPEN) && part.endsWith(TERM_CLOSE)) {
      const [id, word] = part.slice(1, -1).split("|");
      const term = termById.get(id);
      if (!term) return <React.Fragment key={idx}>{word}</React.Fragment>;
      return <GlossaryTerm key={idx} word={word} definition={term.definition} />;
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

function GlossaryTerm({ word, definition }: { word: string; definition: string }) {
  const id = React.useId();
  return (
    <span className="glossary-term" tabIndex={0} aria-describedby={id}>
      {word}
      <span className="glossary-tip" role="tooltip" id={id}>
        {definition}
      </span>
    </span>
  );
}
