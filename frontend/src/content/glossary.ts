/**
 * Beginner glossary. The first time a chapter step uses one of these terms, the reader underlines it
 * and shows the definition on hover, focus or tap. One plain sentence each, no other jargon inside.
 * Content authors: add a term here when a chapter uses a word a new learner would have to look up.
 */
export interface GlossaryTerm {
  id: string;
  /** Matched case-insensitively on word boundaries. The first pattern is the display name. */
  patterns: string[];
  definition: string;
}

export const GLOSSARY: GlossaryTerm[] = [
  { id: "latency", patterns: ["latency"], definition: "How long one request takes, from the moment it is sent to the moment the answer arrives." },
  { id: "p99", patterns: ["p99", "p95", "p50", "tail latency"], definition: "A percentile: p99 is the time that 99 of every 100 requests finish within. The slowest 1% take longer." },
  { id: "throughput", patterns: ["throughput"], definition: "How much work a system finishes per second, for example requests a second." },
  { id: "qps", patterns: ["QPS", "RPS", "req/s"], definition: "Queries (or requests) per second: how many arrive every second." },
  { id: "peak", patterns: ["peak over average", "peak traffic"], definition: "Traffic is not flat: the busiest minute of the day can be several times the daily average. Designs are sized for the peak." },
  { id: "dau", patterns: ["daily active users", "DAU"], definition: "How many different people use the product on a typical day." },
  { id: "stateless", patterns: ["stateless"], definition: "The server keeps nothing between requests, so any copy of it can answer any request. Sessions live in a shared store instead." },
  { id: "load-balancer", patterns: ["load balancer", "load balancers"], definition: "A machine in front of several identical servers that hands each request to one of them and skips servers that fail a health check." },
  { id: "bottleneck", patterns: ["bottleneck"], definition: "The one part that runs out of capacity first and so limits the whole system." },
  { id: "capacity", patterns: ["capacity"], definition: "How much load one part can handle before it slows down or fails." },
  { id: "cache", patterns: ["cache", "caches"], definition: "A small, fast store that keeps copies of popular answers so most requests don't reach the slower database." },
  { id: "hit-rate", patterns: ["hit rate", "hit ratio", "cache hit"], definition: "The share of requests the cache can answer by itself. 80% means 4 in 5 never reach the database." },
  { id: "ttl", patterns: ["TTL", "time to live"], definition: "How long a cached copy is kept before it expires and must be fetched again." },
  { id: "cdn", patterns: ["CDN", "content delivery network"], definition: "Servers spread around the world that keep copies of images, scripts and video close to users." },
  { id: "replica", patterns: ["read replica", "replica", "replicas"], definition: "A copy of the database that follows the main one. Reads can go to replicas; writes still go to the main database." },
  { id: "replication", patterns: ["replication"], definition: "Keeping copies of the same data on several machines, so one failure doesn't lose it and reads can be spread out." },
  { id: "shard", patterns: ["sharding", "shard", "shards", "partitioning"], definition: "Splitting one big dataset across several databases, each holding a slice of the keys." },
  { id: "consistency", patterns: ["eventual consistency", "strong consistency"], definition: "Whether every reader sees the latest write right away (strong) or after a short delay (eventual)." },
  { id: "availability", patterns: ["availability", "highly available"], definition: "The share of time the system answers requests. 99.9% allows about 9 hours of downtime a year." },
  { id: "idempotent", patterns: ["idempotent", "idempotency"], definition: "Safe to repeat: doing it twice has the same effect as doing it once, so retries can't double-charge anyone." },
  { id: "queue", patterns: ["message queue", "queue"], definition: "A waiting line between two services: one side drops work in, the other takes it out when it is ready." },
  { id: "spof", patterns: ["single point of failure", "point of failure"], definition: "A part that takes the whole system down when it fails, because nothing else can do its job." },
  { id: "horizontal", patterns: ["scale out", "horizontal scaling"], definition: "Handling more load by adding more machines, rather than buying a bigger one (scaling up)." },
  { id: "write-ahead-log", patterns: ["write-ahead log", "WAL"], definition: "A file every change is appended to before it is applied, so a crash can be recovered by replaying it." },
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** One regex per term, longest patterns first so "read replica" wins over "replica". */
const MATCHERS = GLOSSARY.map((t) => ({
  term: t,
  re: new RegExp(`(^|[^\\w-])(${[...t.patterns].sort((a, b) => b.length - a.length).map(escape).join("|")})(?![\\w-])`, "i"),
}));

export const TERM_OPEN = "⟦";
export const TERM_CLOSE = "⟧";

/** Which terms each text uses first, walking the texts in reading order. */
export function firstUses(texts: Array<{ key: string; text: string }>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const seen = new Set<string>();
  for (const { key, text } of texts) {
    const plain = stripCode(text);
    const here = new Set<string>();
    for (const { term, re } of MATCHERS) {
      if (seen.has(term.id)) continue;
      if (re.test(plain)) {
        here.add(term.id);
        seen.add(term.id);
      }
    }
    out.set(key, here);
  }
  return out;
}

function stripCode(md: string): string {
  return md.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ");
}

/**
 * Wrap the first use of each given term in markers: ⟦id|text⟧. Skips code spans and fenced code.
 * The inline renderer turns the markers into underlined terms.
 */
export function markTerms(md: string, termIds: Set<string>): string {
  if (!termIds.size) return md;
  let out = md;
  for (const { term, re } of MATCHERS) {
    if (!termIds.has(term.id)) continue;
    // Split on code so matches never land inside it.
    const parts = out.split(/(```[\s\S]*?```|`[^`]*`|⟦[^⟧]*⟧)/g);
    let done = false;
    out = parts
      .map((part, i) => {
        if (done || i % 2 === 1) return part;
        const m = re.exec(part);
        if (!m) return part;
        done = true;
        const start = m.index + m[1].length;
        const word = m[2];
        return `${part.slice(0, start)}${TERM_OPEN}${term.id}|${word}${TERM_CLOSE}${part.slice(start + word.length)}`;
      })
      .join("");
  }
  return out;
}

export const termById = new Map(GLOSSARY.map((t) => [t.id, t]));
