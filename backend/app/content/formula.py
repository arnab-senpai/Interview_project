"""A tiny, safe arithmetic language for chapter numbers.

Every number on a figure is a formula over the chapter's inputs, so the Numbers
step and the figure can never disagree. The same grammar is implemented in
frontend/src/content/formula.ts; tests/test_content_v2.py checks both agree on
the sample expressions in tests/formula_cases.json.

Grammar:  expr   := term (('+' | '-') term)*
          term   := unary (('*' | '/') unary)*
          unary  := '-' unary | power
          power  := atom ('^' unary)?
          atom   := NUMBER | IDENT | IDENT '(' expr (',' expr)* ')' | '(' expr ')'
Numbers may use underscores (86_400) and exponents (1e6).
Functions: min, max, ceil, floor, round, abs, log10, clamp(x, lo, hi).
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Callable, Union

_TOKEN = re.compile(r"\s*(?:(\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|(.))")

FUNCTIONS: dict[str, Callable[..., float]] = {
    "min": min,
    "max": max,
    "ceil": lambda x: float(math.ceil(x)),
    "floor": lambda x: float(math.floor(x)),
    "round": lambda x: float(math.floor(x + 0.5)),
    "abs": abs,
    "log10": math.log10,
    "clamp": lambda x, lo, hi: max(lo, min(hi, x)),
}


class FormulaError(ValueError):
    pass


@dataclass(frozen=True)
class Num:
    value: float


@dataclass(frozen=True)
class Ref:
    name: str


@dataclass(frozen=True)
class Call:
    fn: str
    args: tuple["Node", ...]


@dataclass(frozen=True)
class BinOp:
    op: str
    left: "Node"
    right: "Node"


@dataclass(frozen=True)
class Neg:
    operand: "Node"


Node = Union[Num, Ref, Call, BinOp, Neg]


def _tokenize(src: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    pos = 0
    src = src.strip()
    while pos < len(src):
        m = _TOKEN.match(src, pos)
        if not m or m.end() == pos:
            break
        num, ident, other = m.groups()
        if num is not None:
            out.append(("num", num.replace("_", "")))
        elif ident is not None:
            out.append(("ident", ident))
        elif other is not None and other.strip():
            if other not in "+-*/^(),":
                raise FormulaError(f"Unexpected character {other!r} in {src!r}")
            out.append(("op", other))
        pos = m.end()
    return out


class _Parser:
    def __init__(self, src: str) -> None:
        self.src = src
        self.toks = _tokenize(src)
        self.i = 0

    def peek(self) -> tuple[str, str] | None:
        return self.toks[self.i] if self.i < len(self.toks) else None

    def take(self, value: str | None = None) -> tuple[str, str]:
        tok = self.peek()
        if tok is None or (value is not None and tok[1] != value):
            raise FormulaError(f"Expected {value or 'a value'} in {self.src!r}")
        self.i += 1
        return tok

    def parse(self) -> Node:
        node = self.expr()
        if self.peek() is not None:
            raise FormulaError(f"Unexpected {self.peek()[1]!r} in {self.src!r}")
        return node

    def expr(self) -> Node:
        node = self.term()
        while (tok := self.peek()) and tok[1] in ("+", "-"):
            self.i += 1
            node = BinOp(tok[1], node, self.term())
        return node

    def term(self) -> Node:
        node = self.unary()
        while (tok := self.peek()) and tok[1] in ("*", "/"):
            self.i += 1
            node = BinOp(tok[1], node, self.unary())
        return node

    def unary(self) -> Node:
        tok = self.peek()
        if tok and tok[1] == "-":
            self.i += 1
            return Neg(self.unary())
        return self.power()

    def power(self) -> Node:
        base = self.atom()
        tok = self.peek()
        if tok and tok[1] == "^":
            self.i += 1
            return BinOp("^", base, self.unary())
        return base

    def atom(self) -> Node:
        tok = self.take()
        kind, val = tok
        if kind == "num":
            return Num(float(val))
        if kind == "ident":
            nxt = self.peek()
            if nxt and nxt[1] == "(":
                if val not in FUNCTIONS:
                    raise FormulaError(f"Unknown function {val!r} in {self.src!r}")
                self.take("(")
                args = [self.expr()]
                while (t := self.peek()) and t[1] == ",":
                    self.i += 1
                    args.append(self.expr())
                self.take(")")
                return Call(val, tuple(args))
            return Ref(val)
        if val == "(":
            node = self.expr()
            self.take(")")
            return node
        raise FormulaError(f"Unexpected {val!r} in {self.src!r}")


def parse(src: str | int | float) -> Node:
    if isinstance(src, (int, float)):
        return Num(float(src))
    return _Parser(str(src)).parse()


def references(node: Node) -> set[str]:
    if isinstance(node, Ref):
        return {node.name}
    if isinstance(node, Call):
        return set().union(*(references(a) for a in node.args))
    if isinstance(node, BinOp):
        return references(node.left) | references(node.right)
    if isinstance(node, Neg):
        return references(node.operand)
    return set()


def evaluate(node: Node, env: dict[str, float]) -> float:
    if isinstance(node, Num):
        return node.value
    if isinstance(node, Ref):
        if node.name not in env:
            raise FormulaError(f"Unknown name {node.name!r}")
        return env[node.name]
    if isinstance(node, Neg):
        return -evaluate(node.operand, env)
    if isinstance(node, Call):
        return float(FUNCTIONS[node.fn](*(evaluate(a, env) for a in node.args)))
    left, right = evaluate(node.left, env), evaluate(node.right, env)
    if node.op == "+":
        return left + right
    if node.op == "-":
        return left - right
    if node.op == "*":
        return left * right
    if node.op == "/":
        if right == 0:
            raise FormulaError("Division by zero")
        return left / right
    return float(left**right)


def eval_str(src: str | int | float, env: dict[str, float]) -> float:
    return evaluate(parse(src), env)


def solve_values(
    inputs: dict[str, float], values: list[tuple[str, str]]
) -> dict[str, float]:
    """Evaluate named formulas in dependency order. Raises on cycles or unknown names."""
    env = dict(inputs)
    parsed = {name: parse(src) for name, src in values}
    deps = {name: references(node) & parsed.keys() for name, node in parsed.items()}
    done: set[str] = set()
    visiting: set[str] = set()

    def visit(name: str) -> None:
        if name in done:
            return
        if name in visiting:
            raise FormulaError(f"Formula cycle through {name!r}")
        visiting.add(name)
        for dep in deps[name]:
            visit(dep)
        visiting.discard(name)
        env[name] = evaluate(parsed[name], env)
        done.add(name)

    for name, _ in values:
        visit(name)
    return env
