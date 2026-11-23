/**
 * The chapter formula language, a port of backend/app/content/formula.py.
 * Same grammar, same functions; scripts/check-numbers.mjs runs both on
 * tests/formula_cases.json in CI so they can't drift apart.
 */

export type FormulaNode =
  | { t: "num"; v: number }
  | { t: "ref"; name: string }
  | { t: "call"; fn: string; args: FormulaNode[] }
  | { t: "bin"; op: string; l: FormulaNode; r: FormulaNode }
  | { t: "neg"; x: FormulaNode };

export class FormulaError extends Error {}

const FUNCTIONS: Record<string, (...a: number[]) => number> = {
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a),
  ceil: (x) => Math.ceil(x),
  floor: (x) => Math.floor(x),
  round: (x) => Math.floor(x + 0.5),
  abs: (x) => Math.abs(x),
  log10: (x) => Math.log10(x),
  clamp: (x, lo, hi) => Math.max(lo, Math.min(hi, x)),
};

type Tok = { k: "num" | "ident" | "op"; v: string };
const TOKEN = /\s*(?:(\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|(.))/y;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  const s = src.trim();
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < s.length) {
    const start = TOKEN.lastIndex;
    const m = TOKEN.exec(s);
    if (!m || TOKEN.lastIndex === start) break;
    if (m[1] !== undefined) out.push({ k: "num", v: m[1].replace(/_/g, "") });
    else if (m[2] !== undefined) out.push({ k: "ident", v: m[2] });
    else if (m[3] !== undefined && m[3].trim()) {
      if (!"+-*/^(),".includes(m[3])) throw new FormulaError(`Unexpected character '${m[3]}' in '${src}'`);
      out.push({ k: "op", v: m[3] });
    }
  }
  return out;
}

const cache = new Map<string, FormulaNode>();

export function parseFormula(src: string | number): FormulaNode {
  if (typeof src === "number") return { t: "num", v: src };
  const hit = cache.get(src);
  if (hit) return hit;
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const take = (v?: string) => {
    const tok = toks[i];
    if (!tok || (v !== undefined && tok.v !== v)) throw new FormulaError(`Expected ${v ?? "a value"} in '${src}'`);
    i++;
    return tok;
  };
  const expr = (): FormulaNode => {
    let n = term();
    while (peek() && (peek().v === "+" || peek().v === "-")) {
      const op = take().v;
      n = { t: "bin", op, l: n, r: term() };
    }
    return n;
  };
  const term = (): FormulaNode => {
    let n = unary();
    while (peek() && (peek().v === "*" || peek().v === "/")) {
      const op = take().v;
      n = { t: "bin", op, l: n, r: unary() };
    }
    return n;
  };
  const unary = (): FormulaNode => {
    if (peek() && peek().v === "-") {
      take();
      return { t: "neg", x: unary() };
    }
    return power();
  };
  const power = (): FormulaNode => {
    const base = atom();
    if (peek() && peek().v === "^") {
      take();
      return { t: "bin", op: "^", l: base, r: unary() };
    }
    return base;
  };
  const atom = (): FormulaNode => {
    const tok = take();
    if (tok.k === "num") return { t: "num", v: Number(tok.v) };
    if (tok.k === "ident") {
      if (peek() && peek().v === "(") {
        if (!(tok.v in FUNCTIONS)) throw new FormulaError(`Unknown function '${tok.v}'`);
        take("(");
        const args = [expr()];
        while (peek() && peek().v === ",") {
          take();
          args.push(expr());
        }
        take(")");
        return { t: "call", fn: tok.v, args };
      }
      return { t: "ref", name: tok.v };
    }
    if (tok.v === "(") {
      const n = expr();
      take(")");
      return n;
    }
    throw new FormulaError(`Unexpected '${tok.v}' in '${src}'`);
  };
  const node = expr();
  if (i < toks.length) throw new FormulaError(`Unexpected '${toks[i].v}' in '${src}'`);
  cache.set(src, node);
  return node;
}

export function formulaRefs(node: FormulaNode, out = new Set<string>()): Set<string> {
  if (node.t === "ref") out.add(node.name);
  else if (node.t === "call") node.args.forEach((a) => formulaRefs(a, out));
  else if (node.t === "bin") {
    formulaRefs(node.l, out);
    formulaRefs(node.r, out);
  } else if (node.t === "neg") formulaRefs(node.x, out);
  return out;
}

export function evaluate(node: FormulaNode, env: Record<string, number>): number {
  switch (node.t) {
    case "num":
      return node.v;
    case "ref":
      if (!(node.name in env)) throw new FormulaError(`Unknown name '${node.name}'`);
      return env[node.name];
    case "neg":
      return -evaluate(node.x, env);
    case "call":
      return FUNCTIONS[node.fn](...node.args.map((a) => evaluate(a, env)));
    case "bin": {
      const l = evaluate(node.l, env);
      const r = evaluate(node.r, env);
      if (node.op === "+") return l + r;
      if (node.op === "-") return l - r;
      if (node.op === "*") return l * r;
      if (node.op === "/") {
        if (r === 0) throw new FormulaError("Division by zero");
        return l / r;
      }
      return Math.pow(l, r);
    }
  }
}

export function evalFormula(src: string | number, env: Record<string, number>): number {
  return evaluate(parseFormula(src), env);
}

/** Evaluate named formulas in dependency order (same rules as the Python solver). */
export function solveValues(inputs: Record<string, number>, values: Array<{ id: string; formula: string }>): Record<string, number> {
  const env: Record<string, number> = { ...inputs };
  const parsed = new Map(values.map((v) => [v.id, parseFormula(v.formula)]));
  const done = new Set<string>();
  const visiting = new Set<string>();
  const visit = (name: string) => {
    if (done.has(name)) return;
    if (visiting.has(name)) throw new FormulaError(`Formula cycle through '${name}'`);
    visiting.add(name);
    for (const dep of formulaRefs(parsed.get(name)!)) if (parsed.has(dep)) visit(dep);
    visiting.delete(name);
    env[name] = evaluate(parsed.get(name)!, env);
    done.add(name);
  };
  for (const v of values) visit(v.id);
  return env;
}

/** Which inputs a formula ultimately depends on, through other named values. */
export function inputDependencies(
  src: string | number,
  values: Array<{ id: string; formula: string }>,
  inputIds: Set<string>
): Set<string> {
  const byId = new Map(values.map((v) => [v.id, v.formula]));
  const out = new Set<string>();
  const seen = new Set<string>();
  const walk = (s: string | number) => {
    for (const ref of formulaRefs(parseFormula(s))) {
      if (inputIds.has(ref)) out.add(ref);
      else if (byId.has(ref) && !seen.has(ref)) {
        seen.add(ref);
        walk(byId.get(ref)!);
      }
    }
  };
  walk(src);
  return out;
}
