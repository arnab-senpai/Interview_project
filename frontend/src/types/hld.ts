export type TrackId = "hld" | "lld" | "coding";

export type LayerId = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type DifficultyLevel = "Junior" | "Mid" | "Senior" | "Staff";

export type NodeKind =
  | "client"
  | "dns"
  | "cdn"
  | "load_balancer"
  | "api_gateway"
  | "compute"
  | "cache"
  | "db_sql"
  | "db_nosql"
  | "object_store"
  | "queue"
  | "search_index"
  | "vector_db"
  | "gpu_cluster"
  | "external";

export type StepCategory =
  | "network"
  | "cache_hit"
  | "cache_miss"
  | "read"
  | "write"
  | "async"
  | "consensus"
  | "failover"
  | "llm";

export type FaultType =
  | "node_down"
  | "qps_spike"
  | "latency_injection"
  | "partition"
  | "cache_expiry"
  | "gpu_saturation";

export interface GridPosition {
  gx: number;
  gy: number;
}

export interface NodeSpecs {
  protocol: string;
  port?: string | null;
  maxQpsPerNode?: number | null;
  baseLatencyMs: number;
  capProfile: "CP" | "AP" | "CA" | "N/A";
  scalingAxis: string;
}

export interface LessonNode {
  id: string;
  label: string;
  sublabel: string;
  kind: NodeKind;
  layer: LayerId;
  gridPos: GridPosition;
  specs: NodeSpecs;
  summary: string;
  whenToUse: string[];
  failureModes: string[];
}

export interface LessonEdge {
  id: string;
  from: string;
  to: string;
  protocol: string;
  transport: "sync" | "async" | "stream";
  label: string;
}

export interface PredictPrompt {
  prompt: string;
  hint: string;
  reveal: string;
}

export interface DdiaAnchor {
  chapter: string;
  concept: string;
  whyItMatters: string;
}

export interface PragmaticTip {
  principle: string;
  tip: string;
  application: string;
}

export interface AdaptiveLenses {
  intuition: string;
  mechanics: string;
  staffTradeoffs: string;
}

export interface TraceStep {
  stepNo: number;
  phaseTitle: string;
  timestampMs: number;
  sourceNodeId: string;
  targetNodeId: string;
  edgeId: string;
  category: StepCategory;
  protocol: string;
  info: string;
  payloadSize: string;
  payloadInspector: string;
  latencyDeltaMs: number;
  inspectorNote: string;
  predictPrompt?: PredictPrompt | null;
}

export interface ChaosScenario {
  id: string;
  title: string;
  faultType: FaultType;
  targetNodeId: string;
  triggerSummary: string;
  mitigationSummary: string;
  steps: TraceStep[];
}

export interface TradeoffOption {
  option: string;
  pros: string[];
  cons: string[];
  bestFor: string;
}

export interface HldExplorerLesson {
  id: string;
  track: "hld";
  category: "foundations" | "building-blocks" | "patterns" | "ai-infra";
  layer: LayerId;
  title: string;
  subtitle: string;
  difficulty: DifficultyLevel;
  estimatedMinutes: number;
  overview: string;
  firstPrinciplesStory?: string | null;
  adaptiveLenses?: AdaptiveLenses | null;
  ddiaAnchors?: DdiaAnchor[];
  pragmaticTips?: PragmaticTip[];
  keyTakeaways: string[];
  nodes: LessonNode[];
  edges: LessonEdge[];
  steps: TraceStep[];
  chaosScenarios: ChaosScenario[];
  tradeoffs: TradeoffOption[];
  quizQuestionIds: string[];
  flashcardIds: string[];
}

export interface NonFunctionalRequirement {
  metric: string;
  target: string;
  rationale: string;
}

export interface EstimationPreset {
  dau: number;
  actionsPerUserPerDay: number;
  peakMultiplier: number;
  avgPayloadBytes: number;
  readWriteRatio: string;
  retentionYears: number;
  workedSummary: Record<string, string>;
}

export interface CoreEntity {
  name: string;
  storageEngine: string;
  partitionKey: string;
  keyFields: string[];
}

export interface ApiContract {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "WS" | "gRPC" | "SSE";
  path: string;
  purpose: string;
  idempotent?: boolean;
  samplePayload?: string | null;
}

export interface DeepDiveItem {
  title: string;
  bottleneck: string;
  solution: string;
  tradeoff: string;
}

export interface RubricSection {
  phase: string;
  weight: number;
  criteria: string[];
}

export interface HldCaseStudy {
  id: string;
  tier: 1 | 2 | 3 | 4 | 5;
  title: string;
  subtitle: string;
  levelTag: DifficultyLevel;
  estimatedMinutes: number;
  tags: string[];
  functionalReqs: string[];
  nonFunctionalReqs: NonFunctionalRequirement[];
  estimationPreset: EstimationPreset;
  coreEntities: CoreEntity[];
  apiContracts: ApiContract[];
  explorerTopology: HldExplorerLesson;
  deepDives: DeepDiveItem[];
  rubricChecklist: RubricSection[];
}

export interface PatternPlaybook {
  id: string;
  name: string;
  category: string;
  summary: string;
  triggerSignals: string[];
  coreComponents: string[];
  commonPitfalls: string[];
  relatedCaseStudies: string[];
}

export interface FlashcardItem {
  id: string;
  topicId: string;
  layer: LayerId;
  difficulty: DifficultyLevel;
  front: string;
  back: string;
  tags: string[];
}

export interface QuizQuestion {
  id: string;
  topicId: string;
  layer: LayerId;
  difficulty: DifficultyLevel;
  scenario: string;
  question: string;
  options: string[];
}

/** Answer key and explanations. The server only sends these after the learner answers. */
export interface QuizReveal {
  correctIndex: number;
  explanation: string;
  optionExplanations: string[];
}
