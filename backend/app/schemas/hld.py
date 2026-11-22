"""Pydantic v2 schemas for the HLD Learning Path datasets and FastAPI responses."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

LayerId = Literal[1, 2, 3, 4, 5, 6, 7]
DifficultyLevel = Literal["Junior", "Mid", "Senior", "Staff"]
NodeKind = Literal[
    "client",
    "dns",
    "cdn",
    "load_balancer",
    "api_gateway",
    "compute",
    "cache",
    "db_sql",
    "db_nosql",
    "object_store",
    "queue",
    "search_index",
    "vector_db",
    "gpu_cluster",
    "external",
]
StepCategory = Literal[
    "network",
    "cache_hit",
    "cache_miss",
    "read",
    "write",
    "async",
    "consensus",
    "failover",
    "llm",
]
FaultType = Literal[
    "node_down",
    "qps_spike",
    "latency_injection",
    "partition",
    "cache_expiry",
    "gpu_saturation",
]


class GridPosition(BaseModel):
    gx: float = Field(..., ge=0, le=12, description="Isometric X grid coordinate")
    gy: float = Field(..., ge=0, le=10, description="Isometric Y grid coordinate")


class NodeSpecs(BaseModel):
    protocol: str
    port: str | None = None
    max_qps_per_node: int | None = Field(default=None, alias="maxQpsPerNode")
    base_latency_ms: float = Field(..., ge=0, alias="baseLatencyMs")
    cap_profile: Literal["CP", "AP", "CA", "N/A"] = Field(default="N/A", alias="capProfile")
    scaling_axis: str = Field(..., alias="scalingAxis")

    model_config = {"populate_by_name": True}


class LessonNode(BaseModel):
    id: str
    label: str
    sublabel: str
    kind: NodeKind
    layer: LayerId
    grid_pos: GridPosition = Field(..., alias="gridPos")
    specs: NodeSpecs
    summary: str
    when_to_use: list[str] = Field(..., alias="whenToUse", min_length=1)
    failure_modes: list[str] = Field(..., alias="failureModes", min_length=1)

    model_config = {"populate_by_name": True}


class LessonEdge(BaseModel):
    id: str
    from_node: str = Field(..., alias="from")
    to_node: str = Field(..., alias="to")
    protocol: str
    transport: Literal["sync", "async", "stream"]
    label: str

    model_config = {"populate_by_name": True}


class PredictPrompt(BaseModel):
    prompt: str
    hint: str
    reveal: str


class DdiaAnchor(BaseModel):
    chapter: str
    concept: str
    why_it_matters: str = Field(..., alias="whyItMatters")

    model_config = {"populate_by_name": True}


class PragmaticTip(BaseModel):
    principle: str
    tip: str
    application: str


class AdaptiveLenses(BaseModel):
    intuition: str
    mechanics: str
    staff_tradeoffs: str = Field(..., alias="staffTradeoffs")

    model_config = {"populate_by_name": True}


class TraceStep(BaseModel):
    step_no: int = Field(..., ge=1, alias="stepNo")
    phase_title: str = Field(..., alias="phaseTitle")
    timestamp_ms: float = Field(..., ge=0, alias="timestampMs")
    source_node_id: str = Field(..., alias="sourceNodeId")
    target_node_id: str = Field(..., alias="targetNodeId")
    edge_id: str = Field(..., alias="edgeId")
    category: StepCategory
    protocol: str
    info: str
    payload_size: str = Field(..., alias="payloadSize")
    payload_inspector: str = Field(..., alias="payloadInspector")
    latency_delta_ms: float = Field(..., ge=0, alias="latencyDeltaMs")
    inspector_note: str = Field(..., alias="inspectorNote")
    predict_prompt: PredictPrompt | None = Field(default=None, alias="predictPrompt")

    model_config = {"populate_by_name": True}


class ChaosScenario(BaseModel):
    id: str
    title: str
    fault_type: FaultType = Field(..., alias="faultType")
    target_node_id: str = Field(..., alias="targetNodeId")
    trigger_summary: str = Field(..., alias="triggerSummary")
    mitigation_summary: str = Field(..., alias="mitigationSummary")
    steps: list[TraceStep] = Field(..., min_length=1)

    model_config = {"populate_by_name": True}


class TradeoffOption(BaseModel):
    option: str
    pros: list[str] = Field(..., min_length=1)
    cons: list[str] = Field(..., min_length=1)
    best_for: str = Field(..., alias="bestFor")

    model_config = {"populate_by_name": True}


class HldExplorerLesson(BaseModel):
    id: str
    track: Literal["hld"] = "hld"
    category: Literal["foundations", "building-blocks", "patterns", "ai-infra"]
    layer: LayerId
    title: str
    subtitle: str
    difficulty: DifficultyLevel
    estimated_minutes: int = Field(..., ge=1, alias="estimatedMinutes")
    overview: str
    first_principles_story: str | None = Field(default=None, alias="firstPrinciplesStory")
    adaptive_lenses: AdaptiveLenses | None = Field(default=None, alias="adaptiveLenses")
    ddia_anchors: list[DdiaAnchor] = Field(default_factory=list, alias="ddiaAnchors")
    pragmatic_tips: list[PragmaticTip] = Field(default_factory=list, alias="pragmaticTips")
    key_takeaways: list[str] = Field(..., alias="keyTakeaways", min_length=2)
    nodes: list[LessonNode] = Field(..., min_length=2)
    edges: list[LessonEdge] = Field(..., min_length=1)
    steps: list[TraceStep] = Field(..., min_length=2)
    chaos_scenarios: list[ChaosScenario] = Field(..., alias="chaosScenarios", min_length=1)
    tradeoffs: list[TradeoffOption] = Field(..., min_length=1)
    quiz_question_ids: list[str] = Field(default_factory=list, alias="quizQuestionIds")
    flashcard_ids: list[str] = Field(default_factory=list, alias="flashcardIds")

    model_config = {"populate_by_name": True}


class NonFunctionalRequirement(BaseModel):
    metric: str
    target: str
    rationale: str


class EstimationPreset(BaseModel):
    dau: int = Field(..., gt=0)
    actions_per_user_per_day: float = Field(..., gt=0, alias="actionsPerUserPerDay")
    peak_multiplier: float = Field(..., ge=1.0, alias="peakMultiplier")
    avg_payload_bytes: int = Field(..., gt=0, alias="avgPayloadBytes")
    read_write_ratio: str = Field(..., alias="readWriteRatio")
    retention_years: int = Field(..., ge=1, alias="retentionYears")
    worked_summary: dict[str, str] = Field(..., alias="workedSummary")

    model_config = {"populate_by_name": True}


class CoreEntity(BaseModel):
    name: str
    storage_engine: str = Field(..., alias="storageEngine")
    partition_key: str = Field(..., alias="partitionKey")
    key_fields: list[str] = Field(..., alias="keyFields", min_length=1)

    model_config = {"populate_by_name": True}


class ApiContract(BaseModel):
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE", "WS", "gRPC", "SSE"]
    path: str
    purpose: str
    idempotent: bool = False
    sample_payload: str | None = Field(default=None, alias="samplePayload")

    model_config = {"populate_by_name": True}


class DeepDiveItem(BaseModel):
    title: str
    bottleneck: str
    solution: str
    tradeoff: str


class RubricSection(BaseModel):
    phase: str
    weight: int = Field(..., ge=1, le=100)
    criteria: list[str] = Field(..., min_length=1)


class HldCaseStudy(BaseModel):
    id: str
    tier: Literal[1, 2, 3, 4, 5]
    title: str
    subtitle: str
    level_tag: DifficultyLevel = Field(..., alias="levelTag")
    estimated_minutes: int = Field(..., ge=15, alias="estimatedMinutes")
    tags: list[str] = Field(..., min_length=1)
    functional_reqs: list[str] = Field(..., alias="functionalReqs", min_length=2)
    non_functional_reqs: list[NonFunctionalRequirement] = Field(
        ..., alias="nonFunctionalReqs", min_length=2
    )
    estimation_preset: EstimationPreset = Field(..., alias="estimationPreset")
    core_entities: list[CoreEntity] = Field(..., alias="coreEntities", min_length=1)
    api_contracts: list[ApiContract] = Field(..., alias="apiContracts", min_length=1)
    explorer_topology: HldExplorerLesson = Field(..., alias="explorerTopology")
    deep_dives: list[DeepDiveItem] = Field(..., alias="deepDives", min_length=2)
    rubric_checklist: list[RubricSection] = Field(..., alias="rubricChecklist", min_length=3)

    model_config = {"populate_by_name": True}


class PatternPlaybook(BaseModel):
    id: str
    name: str
    category: str
    summary: str
    trigger_signals: list[str] = Field(..., alias="triggerSignals", min_length=1)
    core_components: list[str] = Field(..., alias="coreComponents", min_length=1)
    common_pitfalls: list[str] = Field(..., alias="commonPitfalls", min_length=1)
    related_case_studies: list[str] = Field(..., alias="relatedCaseStudies", min_length=1)

    model_config = {"populate_by_name": True}


class PatternsBundle(BaseModel):
    version: str
    patterns: list[PatternPlaybook] = Field(..., min_length=1)


class FlashcardItem(BaseModel):
    id: str
    topic_id: str = Field(..., alias="topicId")
    layer: LayerId
    difficulty: DifficultyLevel
    front: str
    back: str
    tags: list[str] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class QuizQuestion(BaseModel):
    id: str
    topic_id: str = Field(..., alias="topicId")
    layer: LayerId
    difficulty: DifficultyLevel
    scenario: str
    question: str
    options: list[str] = Field(..., min_length=3)
    correct_index: int = Field(..., ge=0, alias="correctIndex")
    explanation: str
    option_explanations: list[str] = Field(..., alias="optionExplanations")

    model_config = {"populate_by_name": True}

    @model_validator(mode="after")
    def _check_answer_key(self) -> "QuizQuestion":
        if self.correct_index >= len(self.options):
            raise ValueError(f"{self.id}: correctIndex {self.correct_index} out of range")
        if len(self.option_explanations) != len(self.options):
            raise ValueError(f"{self.id}: needs one optionExplanation per option")
        return self

    def public_view(self) -> dict:
        """The question as the browser may see it: no answer key, no explanations."""
        return self.model_dump(by_alias=True, exclude={"correct_index", "explanation", "option_explanations"})

    def reveal(self) -> dict:
        """Answer key and explanations, sent only after the learner has answered."""
        return {
            "correctIndex": self.correct_index,
            "explanation": self.explanation,
            "optionExplanations": list(self.option_explanations),
        }


class PracticeTopicFile(BaseModel):
    """One file per topic under data/hld/practice/: that topic's flashcards and quizzes."""

    version: str
    topic_id: str = Field(..., alias="topicId")
    flashcards: list[FlashcardItem] = Field(default_factory=list)
    quizzes: list[QuizQuestion] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class FlashcardsAndQuizzesBundle(BaseModel):
    version: str
    flashcards: list[FlashcardItem]
    quizzes: list[QuizQuestion]


class ReferenceNumbersAndRubric(BaseModel):
    version: str
    interview_delivery_framework: list[dict] = Field(..., alias="interviewDeliveryFramework")
    level_rubrics: list[dict] = Field(..., alias="levelRubrics")
    latency_benchmarks: list[dict] = Field(..., alias="latencyBenchmarks")
    availability_nines: list[dict] = Field(..., alias="availabilityNines")
    estimation_formulas: list[dict] = Field(..., alias="estimationFormulas")
    genai_sizing_metrics: list[dict] = Field(..., alias="genaiSizingMetrics")
    level_mapping: dict | None = Field(default=None, alias="levelMapping")
    latency_benchmarks_meta: dict | None = Field(default=None, alias="latencyBenchmarksMeta")

    model_config = {"populate_by_name": True}


class CurriculumIndex(BaseModel):
    version: str
    track: Literal["hld"] = "hld"
    layers: list[dict]
    lessons: list[dict]
    case_studies: list[dict] = Field(..., alias="caseStudies")

    model_config = {"populate_by_name": True}


class ModuleFoundationSection(BaseModel):
    heading: str
    core_principle: str = Field(..., alias="corePrinciple")
    mechanics_and_constraints: str = Field(..., alias="mechanicsAndConstraints")
    tpp_application: str = Field(..., alias="tppApplication")
    key_metrics_or_formulas: list[str] = Field(default_factory=list, alias="keyMetricsOrFormulas")

    model_config = {"populate_by_name": True}


class ModuleTradeoffRow(BaseModel):
    option: str
    pros: str
    cons_bottlenecks: str = Field(..., alias="consBottlenecks")
    ideal_workload: str = Field(..., alias="idealWorkload")

    model_config = {"populate_by_name": True}


class ModuleEstimateRow(BaseModel):
    label: str
    calculation: str
    result: str


class ModuleServiceComponent(BaseModel):
    name: str
    responsibility: str
    technology_choice: str = Field(..., alias="technologyChoice")

    model_config = {"populate_by_name": True}


class ModuleDeepDiveBottleneck(BaseModel):
    title: str
    failure_scenario: str = Field(..., alias="failureScenario")
    mitigation_mechanics: str = Field(..., alias="mitigationMechanics")
    etc_tradeoff: str = Field(..., alias="etcTradeoff")

    model_config = {"populate_by_name": True}


class ModuleCaseStudySpec(BaseModel):
    system_name: str = Field(..., alias="systemName")
    problem_statement: str = Field(..., alias="problemStatement")
    functional_requirements: list[str] = Field(..., alias="functionalRequirements", min_length=2)
    non_functional_requirements: list[str] = Field(..., alias="nonFunctionalRequirements", min_length=2)
    traffic_summary: str = Field(..., alias="trafficSummary")
    estimates: list[ModuleEstimateRow] = Field(..., min_length=3)
    architecture_flow: str = Field(..., alias="architectureFlow")
    services: list[ModuleServiceComponent] = Field(..., min_length=3)
    data_model_and_storage: str = Field(..., alias="dataModelAndStorage")
    deep_dives: list[ModuleDeepDiveBottleneck] = Field(..., alias="deepDives", min_length=2)

    model_config = {"populate_by_name": True}


class ModuleRubricBand(BaseModel):
    summary: str
    signals: list[str] = Field(..., min_length=2)


class ModuleCandidateRubric(BaseModel):
    junior_mid: ModuleRubricBand = Field(..., alias="juniorMid")
    senior: ModuleRubricBand
    staff_principal: ModuleRubricBand = Field(..., alias="staffPrincipal")

    model_config = {"populate_by_name": True}


class HldModule(BaseModel):
    id: str
    module_number: int = Field(..., ge=1, alias="moduleNumber")
    title: str
    ddia_sources: list[str] = Field(..., alias="ddiaSources", min_length=1)
    tpp_sources: list[str] = Field(..., alias="tppSources", min_length=1)
    linked_lesson_ids: list[str] = Field(default_factory=list, alias="linkedLessonIds")
    linked_case_study_ids: list[str] = Field(default_factory=list, alias="linkedCaseStudyIds")
    deep_dive_foundations: list[ModuleFoundationSection] = Field(
        ..., alias="deepDiveFoundations", min_length=3
    )
    tradeoffs_matrix: list[ModuleTradeoffRow] = Field(..., alias="tradeoffsMatrix", min_length=3)
    case_study: ModuleCaseStudySpec = Field(..., alias="caseStudy")
    candidate_rubric: ModuleCandidateRubric = Field(..., alias="candidateRubric")

    model_config = {"populate_by_name": True}


class HldModulesBundle(BaseModel):
    version: str
    modules: list[HldModule] = Field(..., min_length=6)
