"""Content model v2: one topic format for every track (HLD now, LLD and coding later).

Authors write ``content/<track>/<topic-id>/topic.yaml`` plus Markdown files for
long prose. The compiler (compiler.py) validates it against these models, moves
answer keys into a server-only map, computes contentVersion and resolves each
figure's staged state. The API only ever serves the public half.

A topic is an ordered set of layers (understand, apply, defend, practice,
cheatSheet). A chapter-style topic (``template: chapter``) groups its blocks by
the seven chapter sections instead: problem, clarify, numbers, design live in
Understand; deepDive, remember, check live in Apply.

Eleven block primitives: prose, structuredTable, figure, trace, quiz, predict,
spotTheBug, estimationWorksheet, designPrompt, ladder, rememberCard. Checkable
blocks carry a gradingVersion; progress is keyed (user, topic, block id).
"""

from __future__ import annotations

from datetime import date
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator

ID_PATTERN = r"^[a-z0-9][a-z0-9-]*$"
BlockId = Annotated[str, Field(pattern=ID_PATTERN, max_length=80)]
# Names usable inside formulas: snake_case identifiers.
NumberId = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]*$", max_length=60)]


class _M(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


Track = Literal["hld", "lld", "coding"]
TopicKind = Literal["concept", "case_study", "pattern_hub", "drill", "cheat_sheet"]
Level = Literal["Junior", "Mid", "Senior", "Staff"]
LayerName = Literal["understand", "apply", "defend", "practice", "cheatSheet"]
SectionName = Literal["problem", "clarify", "numbers", "design", "deepDive", "remember", "check"]

CHAPTER_SECTIONS: tuple[str, ...] = ("problem", "clarify", "numbers", "design", "deepDive", "remember", "check")
SECTION_LAYER: dict[str, str] = {
    "problem": "understand",
    "clarify": "understand",
    "numbers": "understand",
    "design": "understand",
    "deepDive": "apply",
    "remember": "apply",
    "check": "apply",
}


class Source(_M):
    title: str
    url: str | None = None
    note: str | None = None


class FurtherReading(_M):
    """Reference reading shown after the chapter, e.g. the DDIA module essays."""

    title: str
    body: str | None = None
    url: str | None = None


class ReviewCard(_M):
    """A recall card for the review queue: front shown, back revealed, learner rates recall."""

    id: BlockId
    front: str
    back: str


class LegacySource(_M):
    """Set on topics generated from v1 JSON by the adapter (v1_adapter.py)."""

    kind: Literal["lesson", "case_study"]
    id: str


# ---------------------------------------------------------------- numbers layer


class NumberInput(_M):
    id: NumberId
    label: str
    unit: str = ""
    default: float
    min: float
    max: float
    step: float | None = None
    scale: Literal["linear", "log"] = "linear"
    help: str | None = None


class NumberValue(_M):
    """A named, derived number: ``formula`` is an expression over inputs and other values."""

    id: NumberId
    label: str
    formula: str
    unit: str = ""
    explain: str | None = None


class Preset(_M):
    id: BlockId
    label: str
    inputs: dict[str, float]
    note: str | None = None


class NumbersModel(_M):
    """The chapter's flow model: declared once, drives every figure and worksheet in the chapter."""

    inputs: list[NumberInput] = Field(default_factory=list)
    values: list[NumberValue] = Field(default_factory=list)
    presets: list[Preset] = Field(default_factory=list)


ComponentKind = Literal[
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


class Metric(_M):
    """An extra number shown on a part, e.g. storage on a database."""

    label: str
    value: str  # formula
    unit: str


class Component(_M):
    id: BlockId
    label: str
    kind: ComponentKind
    example: str | None = None  # small print, e.g. "e.g. Redis"
    pos: tuple[float, float]  # isometric grid position (gx, gy)
    load: str | None = None  # formula: requests per second this part handles
    loadUnit: str = "req/s"
    capacity: float | None = None  # one instance, same unit as load
    capacitySource: str | None = None
    # Fixed count (a formula is allowed). "auto" or omitted: the figure shows how many
    # instances the load needs at 60% target utilisation.
    instances: str | int | None = None
    metrics: list[Metric] = Field(default_factory=list)
    note: str | None = None


class Arrow(_M):
    id: BlockId
    source: str = Field(alias="from")
    to: str
    label: str
    mode: Literal["sync", "async"]
    rate: str | None = None  # formula, requests per second at peak
    order: int | None = None  # request step number when order matters


class ComponentOverride(_M):
    label: str | None = None
    example: str | None = None
    load: str | None = None
    capacity: float | None = None
    capacitySource: str | None = None
    instances: str | int | None = None
    metrics: list[Metric] | None = None
    note: str | None = None
    kind: ComponentKind | None = None
    pos: tuple[float, float] | None = None


class ArrowOverride(_M):
    label: str | None = None
    rate: str | None = None
    mode: Literal["sync", "async"] | None = None
    order: int | None = None


# ---------------------------------------------------------------- blocks


SkillId = Annotated[str, Field(pattern=r"^[a-z0-9][a-z0-9.-]*$", max_length=80)]


class _Block(_M):
    id: BlockId
    title: str | None = None
    # Skills this block gives evidence on. Empty: the topic's skills, else "<track>.<topic id>".
    skills: list[SkillId] = Field(default_factory=list)
    # Set by the compiler from the layer / section the block sits in.
    section: SectionName | None = None
    layer: LayerName | None = None


class ProseBlock(_Block):
    type: Literal["prose"]
    role: Literal[
        "problem", "analogy", "steps", "example", "internals", "atScale", "incident", "numbers", "versionNote", "why", "deepDive"
    ] = "steps"
    body: str | None = None
    bodyFile: str | None = None
    why: str | None = None  # the one "Why ..." line a design step must carry


class TableColumn(_M):
    key: str
    label: str


class StructuredTableBlock(_Block):
    type: Literal["structuredTable"]
    variant: Literal["decisionMatrix", "debugPlaybook", "comparison", "failureModes", "reference", "clarify"] = "comparison"
    columns: list[TableColumn]
    rows: list[dict[str, Any]] = Field(default_factory=list)
    rowsFrom: str | None = None  # e.g. "reference.latencyBenchmarks", resolved at compile time
    caption: str | None = None


class FigureStage(_M):
    add: list[str] = Field(default_factory=list)  # component or arrow ids that appear in this step
    change: list[str] = Field(default_factory=list)  # ids whose label or numbers change
    remove: list[str] = Field(default_factory=list)
    overrides: dict[str, ComponentOverride] = Field(default_factory=dict)
    arrowOverrides: dict[str, ArrowOverride] = Field(default_factory=dict)


class FigureBlock(_Block):
    type: Literal["figure"]
    figureKind: Literal["topology", "sequence", "ring", "log", "timeline", "stateMachine", "tree"] = "topology"
    # The title is a claim ("Most reads stop at the cache"), not a topic ("Caching").
    title: str
    caption: str | None = None
    base: str | None = None  # previous figure id; this figure = base + stage
    stage: FigureStage = Field(default_factory=FigureStage)
    claims: list[str] = Field(default_factory=list)
    whatIf: str | None = None  # "Double DAU. Which part turns red first?"


class TraceStep(_M):
    source: str = Field(alias="from")
    to: str
    label: str
    latencyMs: float | None = None
    note: str | None = None


class TraceBlock(_Block):
    type: Literal["trace"]
    figure: str | None = None  # figure whose components the steps use
    steps: list[TraceStep]


class QuizOption(_M):
    text: str
    explanation: str


class QuizBlock(_Block):
    type: Literal["quiz"]
    variant: Literal["mcq", "recall"] = "mcq"
    prompt: str
    options: list[QuizOption]
    answer: int  # server-only
    gradingVersion: int = Field(ge=1)
    aboutFigure: str | None = None  # a check question that uses a figure


class PredictBlock(_Block):
    type: Literal["predict"]
    prompt: str
    options: list[QuizOption]
    answer: int  # server-only
    reveal: str  # server-only until the learner commits
    gradingVersion: int = Field(ge=1)
    aboutFigure: str | None = None


class BugStep(_M):
    prompt: str
    options: list[str]
    answer: int  # server-only
    explanation: str  # server-only


class SpotTheBugBlock(_Block):
    type: Literal["spotTheBug"]
    variant: Literal["snippet", "pr"] = "snippet"
    prompt: str
    language: str = "text"
    code: str
    steps: list[BugStep]  # region, root cause, safeguard
    gradingVersion: int = Field(ge=1)


class WorksheetLine(_M):
    value: str  # id of a NumbersModel value (or input) the learner estimates
    prompt: str
    hint: str | None = None


class EstimationWorksheetBlock(_Block):
    type: Literal["estimationWorksheet"]
    prompt: str
    preset: str | None = None
    lines: list[WorksheetLine]
    tolerance: float = 2.0  # within 2x passes
    gradingVersion: int = Field(default=1, ge=1)


class ModelAnswer(_M):
    level: Level
    answer: str


class DesignPromptBlock(_Block):
    type: Literal["designPrompt"]
    prompt: str
    modelAnswers: list[ModelAnswer]  # server-only until the learner submits
    rubric: list[str] = Field(default_factory=list)
    gradingVersion: int = Field(ge=1)


class LadderRung(_M):
    constraint: str
    options: list[str]
    answer: int  # server-only
    strongAnswer: str  # server-only


class LadderBlock(_Block):
    type: Literal["ladder"]
    prompt: str
    rungs: list[LadderRung]
    gradingVersion: int = Field(ge=1)


class RememberNumber(_M):
    value: str
    unit: str
    label: str


class RememberTradeoff(_M):
    choice: str
    buys: str
    costs: str


class RememberCardBlock(_Block):
    type: Literal["rememberCard"]
    figure: str  # the final figure, drawn small
    facts: list[str]
    number: RememberNumber
    tradeoff: RememberTradeoff
    sayIt: str


Block = Annotated[
    Union[
        ProseBlock,
        StructuredTableBlock,
        FigureBlock,
        TraceBlock,
        QuizBlock,
        PredictBlock,
        SpotTheBugBlock,
        EstimationWorksheetBlock,
        DesignPromptBlock,
        LadderBlock,
        RememberCardBlock,
    ],
    Field(discriminator="type"),
]

CHECKABLE_TYPES = {"quiz", "predict", "spotTheBug", "designPrompt", "ladder", "estimationWorksheet"}
SERVER_GRADED_TYPES = {"quiz", "predict", "spotTheBug", "designPrompt", "ladder"}


class Layer(_M):
    level: Level
    minutes: int = Field(ge=1, le=60)
    goal: str | None = None
    blocks: list[Block] = Field(default_factory=list)
    sections: dict[SectionName, list[Block]] | None = None


class Topic(_M):
    schemaVersion: Literal[2]
    id: BlockId
    track: Track
    kind: TopicKind
    template: Literal["chapter", "free"] = "free"
    title: str
    summary: str
    status: Literal["ready", "draft"] = "ready"
    prerequisites: list[str] = Field(default_factory=list)
    related: list[str] = Field(default_factory=list)
    sandboxLessonId: str | None = None  # v1 Explorer lesson with this design, opened as the Sandbox
    legacy: LegacySource | None = None  # generated from a v1 lesson; shown as "Preview" until rewritten
    furtherReading: list[FurtherReading] = Field(default_factory=list)
    skills: list[SkillId] = Field(default_factory=list)  # default skills for this topic's checks
    reviewCards: list[ReviewCard] = Field(default_factory=list)
    sources: list[Source]
    lastVerified: date
    appliesTo: str
    claimsReviewedBy: str | None = None  # second person who signed off the figure claims
    numbers: NumbersModel = Field(default_factory=NumbersModel)
    components: list[Component] = Field(default_factory=list)
    arrows: list[Arrow] = Field(default_factory=list)
    layers: dict[LayerName, Layer]

    @field_validator("layers")
    @classmethod
    def _has_understand(cls, v: dict[str, Layer]) -> dict[str, Layer]:
        if "understand" not in v:
            raise ValueError("every topic needs an 'understand' layer")
        return v


class PathEntry(_M):
    number: int
    topic: str
    title: str  # shown even when the topic is still planned
    # "planned": no topic exists yet. A "ready" entry must resolve to a v2 topic,
    # written or adapted from v1, or the path lint fails.
    status: Literal["ready", "planned"] = "ready"
    summary: str | None = None  # beginner-facing one-liner; wins over the topic's own summary on the path
    note: str | None = None


class PathStage(_M):
    id: BlockId
    title: str
    summary: str
    fixedOrder: bool = True
    chapters: list[PathEntry]


class StudyPath(_M):
    id: BlockId
    title: str
    summary: str
    stages: list[PathStage]
