// Content model v2 as served by /api/tracks/{track}/topics/{id}. Answer keys never appear here.
import type { NodeKind } from "../types/hld";

export interface NumberInput {
  id: string;
  label: string;
  unit: string;
  default: number;
  min: number;
  max: number;
  step?: number;
  scale: "linear" | "log";
  help?: string;
}

export interface NumberValue {
  id: string;
  label: string;
  formula: string;
  unit: string;
  explain?: string;
}

export interface Preset {
  id: string;
  label: string;
  inputs: Record<string, number>;
  note?: string;
}

export interface Metric {
  label: string;
  value: string;
  unit: string;
}

export interface Component {
  id: string;
  label: string;
  kind: NodeKind;
  example?: string;
  pos: [number, number];
  load?: string;
  loadUnit: string;
  capacity?: number;
  capacitySource?: string;
  instances?: string | number;
  metrics: Metric[];
  note?: string;
}

export interface Arrow {
  id: string;
  from: string;
  to: string;
  label: string;
  mode: "sync" | "async";
  rate?: string;
  order?: number;
}

export interface FigureState {
  components: string[];
  arrows: string[];
  highlight: string[];
  overrides: Record<string, Partial<Omit<Component, "id">>>;
  arrowOverrides: Record<string, Partial<Omit<Arrow, "id" | "from" | "to">>>;
}

interface BlockBase {
  id: string;
  title?: string;
  section?: SectionName;
  layer: LayerName;
  checkable: boolean;
  gradingVersion?: number;
}

export type SectionName = "problem" | "clarify" | "numbers" | "design" | "deepDive" | "remember" | "check";
export type LayerName = "understand" | "apply" | "defend" | "practice" | "cheatSheet";

export interface ProseBlock extends BlockBase {
  type: "prose";
  role: string;
  body?: string;
  why?: string;
}
export interface StructuredTableBlock extends BlockBase {
  type: "structuredTable";
  variant: string;
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
  caption?: string;
}
export interface FigureBlock extends BlockBase {
  type: "figure";
  figureKind: string;
  title: string;
  caption?: string;
  base?: string;
  claims: string[];
  whatIf?: string;
}
export interface TraceBlock extends BlockBase {
  type: "trace";
  figure?: string;
  steps: { from: string; to: string; label: string; latencyMs?: number; note?: string }[];
}
export interface ChoiceBlock extends BlockBase {
  type: "quiz" | "predict";
  variant?: string;
  prompt: string;
  options: { text: string }[];
  aboutFigure?: string;
}
export interface SpotTheBugBlock extends BlockBase {
  type: "spotTheBug";
  prompt: string;
  language: string;
  code: string;
  steps: { prompt: string; options: string[] }[];
}
export interface EstimationWorksheetBlock extends BlockBase {
  type: "estimationWorksheet";
  prompt: string;
  preset?: string;
  lines: { value: string; prompt: string; hint?: string }[];
  tolerance: number;
}
export interface DesignPromptBlock extends BlockBase {
  type: "designPrompt";
  prompt: string;
  rubric: string[];
}
export interface LadderBlock extends BlockBase {
  type: "ladder";
  prompt: string;
  rungs: { constraint: string; options: string[] }[];
}
export interface RememberCardBlock extends BlockBase {
  type: "rememberCard";
  figure: string;
  facts: string[];
  number: { value: string; unit: string; label: string };
  tradeoff: { choice: string; buys: string; costs: string };
  sayIt: string;
}

export type Block =
  | ProseBlock
  | StructuredTableBlock
  | FigureBlock
  | TraceBlock
  | ChoiceBlock
  | SpotTheBugBlock
  | EstimationWorksheetBlock
  | DesignPromptBlock
  | LadderBlock
  | RememberCardBlock;

export interface TopicV2 {
  id: string;
  track: string;
  kind: string;
  template: "chapter" | "free";
  title: string;
  summary: string;
  status: string;
  prerequisites: string[];
  related: string[];
  sandboxLessonId?: string;
  sources: { title: string; url?: string; note?: string }[];
  lastVerified: string;
  appliesTo: string;
  contentVersion: string;
  numbers: { inputs: NumberInput[]; values: NumberValue[]; presets: Preset[] };
  components: Component[];
  arrows: Arrow[];
  layers: { name: LayerName; level: string; minutes: number; goal?: string; blockIds: string[] }[];
  blocks: Block[];
  figures: Record<string, FigureState>;
  defaults: Record<string, number>;
}

export type BlockStatusName = "new" | "viewed" | "attempted" | "passed" | "recheck";

export interface BlockStatus {
  status: BlockStatusName;
  attempts: number;
  lastResponse?: Record<string, unknown>;
  lastPassed?: boolean;
}

export interface LayerProgress {
  name: LayerName;
  checks: number;
  checksPassed: number;
  blocksSeen: number;
  blocks: number;
  passed: boolean;
  recheckSuggested: boolean;
}

export interface TopicProgressV2 {
  status: "not_started" | "in_progress" | "completed";
  layers: LayerProgress[];
  blocks: Record<string, BlockStatus>;
}

export interface AttemptResult {
  attemptId: number;
  verdict: "passed" | "failed";
  passed: boolean;
  score: number;
  reveal: any;
  selfScored?: boolean;
  blockStatus: BlockStatus;
  progress: { status: TopicProgressV2["status"]; layers: LayerProgress[] };
}

export interface PathChapter {
  number: number;
  topicId: string;
  title: string;
  summary?: string;
  format: "v2" | "v1" | "planned";
  available: boolean;
  minutes?: number;
  status: string;
  note?: string;
}

export interface StudyPathResponse {
  id: string;
  title: string;
  summary: string;
  continueTopicId: string | null;
  stages: { id: string; title: string; summary: string; fixedOrder: boolean; chapters: PathChapter[] }[];
}
