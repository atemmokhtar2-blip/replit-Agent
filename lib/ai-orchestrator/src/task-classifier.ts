/**
 * Task Classifier
 *
 * Stateless heuristic classifier. Analyzes message content against
 * keyword/pattern banks to determine the most likely task type.
 *
 * No LLM required. Fast, deterministic, zero latency.
 *
 * Adding a new task type:
 *   1. Extend TaskType union in types.ts
 *   2. Add a new entry to PATTERN_BANKS below
 *   No other changes needed.
 */

import type { TaskType, TaskClassification } from "./types.js";

const CONFIDENCE_THRESHOLD = 0.15;
const CONTEXT_WINDOW = 3;

interface PatternBank {
  patterns: RegExp[];
  weight: number;
}

const PATTERN_BANKS: Record<Exclude<TaskType, "general">, PatternBank> = {
  coding: {
    weight: 1.0,
    patterns: [
      /\b(code|coding|program|programming|implement|implementation)\b/i,
      /\b(function|method|class|interface|component|module|package)\b/i,
      /\b(typescript|javascript|python|rust|go|java|c\+\+|swift|kotlin|ruby|php)\b/i,
      /\b(react|vue|angular|express|fastapi|django|spring|rails)\b/i,
      /\b(api|endpoint|route|handler|middleware|controller|service|repository)\b/i,
      /\b(variable|const|let|var|type|enum|struct|array|object|map|set)\b/i,
      /\b(loop|iteration|recursion|algorithm|data structure|sort|search)\b/i,
      /\b(refactor|rewrite|migrate|scaffold|boilerplate|template|snippet)\b/i,
      /\b(import|export|dependency|library|framework|sdk|npm|pnpm|pip)\b/i,
      /\b(how (do|to|can) (i|we|you) (write|build|create|make|implement))\b/i,
      /```[\s\S]*?```/,
      /\b(write (a|the|an|some)|build (a|the|an)|create (a|the|an)) .*(function|class|component|api|endpoint|hook|util)\b/i,
    ],
  },
  debugging: {
    weight: 1.2,
    patterns: [
      /\b(error|exception|crash|traceback|stack trace)\b/i,
      /\b(bug|fix|broken|not working|doesn'?t work|fails?|failing)\b/i,
      /\b(debug|debugging|troubleshoot|diagnose|investigate)\b/i,
      /\b(undefined|null|nan|cannot read|is not a function|cannot find)\b/i,
      /\b(why (is|does|doesn'?t|won'?t|can'?t)|what'?s wrong)\b/i,
      /\b(getting (an?|the) error|throws? (an?|a)?|throwing)\b/i,
      /\b(type error|reference error|syntax error|runtime error|compile error)\b/i,
      /\b(unexpected (behavior|result|output|token)|incorrect (output|result))\b/i,
      /\b(resolve|fix (this|the)|help me (fix|solve|figure out))\b/i,
    ],
  },
  planning: {
    weight: 0.9,
    patterns: [
      /\b(plan|planning|roadmap|strategy|strategic)\b/i,
      /\b(architecture|design (pattern|decision|choice)|system design)\b/i,
      /\b(structure|organize|organiz(e|ation)|breakdown|break down)\b/i,
      /\b(steps?|phases?|milestones?|sprint|iteration|epic|story)\b/i,
      /\b(approach|how (should|do) (i|we) (approach|handle|structure|design))\b/i,
      /\b(project (plan|scope|requirement)|requirements? (gathering|analysis))\b/i,
      /\b(best (way|practice|approach|pattern) (to|for))\b/i,
      /\b(tradeoffs?|pros? and cons?|comparison|evaluate options?)\b/i,
      /\b(what (should|would) (you|i|we) (recommend|suggest|use|choose))\b/i,
    ],
  },
  research: {
    weight: 0.85,
    patterns: [
      /\b(what is|what are|what does|what'?s)\b/i,
      /\b(how does|how do|how (does|do) .* work)\b/i,
      /\b(explain|explain (me|how|what|why)|tell me about)\b/i,
      /\b(research|find (out|information|details)|look up)\b/i,
      /\b(difference between|compare|comparison|versus|vs\.?)\b/i,
      /\b(overview|introduction|summary|background|history)\b/i,
      /\b(best (library|tool|framework|language|database) for)\b/i,
      /\b(pros? (and|&) cons?|advantages?|disadvantages?|benefits?|drawbacks?)\b/i,
    ],
  },
  writing: {
    weight: 0.9,
    patterns: [
      /\b(write|draft|compose|create) (a|an|the|some)? *(email|message|post|article|essay|blog|doc|document|readme|report|letter|description|bio|summary|announcement|changelog|release notes?)\b/i,
      /\b(improve|edit|proofread|revise|rewrite|rephrase|paraphrase|polish)\b/i,
      /\b(tone|voice|style|formal|informal|professional|casual|concise|verbose)\b/i,
      /\b(paragraph|sentence|headline|title|caption|tagline|copy|content)\b/i,
      /\b(make (this|it) (sound|more|less|clearer|shorter|longer|better))\b/i,
      /\b(translate|localize|summarize|condense|expand|elaborate)\b/i,
    ],
  },
  analysis: {
    weight: 0.9,
    patterns: [
      /\b(analyz(e|is)|analyse|analysis)\b/i,
      /\b(review|evaluate|assess|assess?ment|audit)\b/i,
      /\b(data|dataset|metrics?|statistics?|numbers?|figures?|chart|graph)\b/i,
      /\b(patterns?|trends?|insights?|findings?|observations?)\b/i,
      /\b(performance|benchmark|profil(e|ing)|optimize|optimization)\b/i,
      /\b(what (can|do) (we|you|i) (learn|infer|conclude|see) from)\b/i,
      /\b(interpret|meaning|significance|implications?)\b/i,
      /\b(code (review|quality|smell|coverage)|test (coverage|result))\b/i,
    ],
  },
  deployment: {
    weight: 1.1,
    patterns: [
      /\b(deploy|deployment|release|publish|ship|go.?live)\b/i,
      /\b(docker|kubernetes|k8s|helm|container|pod|service|ingress)\b/i,
      /\b(ci\/?cd|github.?actions|jenkins|gitlab.?ci|pipeline|workflow)\b/i,
      /\b(aws|gcp|azure|vercel|netlify|heroku|railway|fly\.io|render)\b/i,
      /\b(production|staging|environment|infrastructure|terraform|ansible)\b/i,
      /\b(build|bundle|compile|package|artifact|image|registry)\b/i,
      /\b(scale|auto.?scaling|load.?balanc|replication|ha|high.?availability)\b/i,
      /\b(rollback|blue.?green|canary|zero.?downtime)\b/i,
    ],
  },
  documentation: {
    weight: 1.0,
    patterns: [
      /\b(document|documentation|docs|readme|wiki)\b/i,
      /\b(jsdoc|docstring|swagger|openapi|api.?docs?)\b/i,
      /\b(comment|annotate|explain (this|the|how|what))\b/i,
      /\b(guide|tutorial|how.?to|walkthrough|getting.?started)\b/i,
      /\b(write (the|a|an) (docs?|documentation|readme|guide|manual))\b/i,
      /\b(update (the|this) (docs?|documentation|readme))\b/i,
      /\b(generate (docs?|documentation|types?|typings?))\b/i,
    ],
  },
  database: {
    weight: 1.1,
    patterns: [
      /\b(database|db|sql|nosql|postgres|postgresql|mysql|sqlite|mongodb|redis)\b/i,
      /\b(schema|table|column|row|record|field|index|constraint|migration)\b/i,
      /\b(query|select|insert|update|delete|join|where|group.?by|order.?by)\b/i,
      /\b(orm|drizzle|prisma|typeorm|sequelize|mongoose)\b/i,
      /\b(data.?model(ing)?|entity|relation|foreign.?key|primary.?key)\b/i,
      /\b(normalization|denormalization|transaction|acid|consistency)\b/i,
      /\b(optimize (the )?(query|queries|db|database)|slow (query|queries))\b/i,
      /\b(design (a|the) (schema|database|data.?model))\b/i,
    ],
  },
  security: {
    weight: 1.15,
    patterns: [
      /\b(security|secure|vulnerabilit(y|ies)|exploit|attack|threat)\b/i,
      /\b(authentication|authorization|auth|jwt|oauth|session|cookie)\b/i,
      /\b(sql.?injection|xss|csrf|cors|csp|sanitize|validate|escape)\b/i,
      /\b(encrypt(ion|ed)?|decrypt|hash(ing)?|bcrypt|argon2|salt)\b/i,
      /\b(penetration.?test|pentest|security.?review|audit|scan)\b/i,
      /\b(owasp|cve|exposure|data.?breach|rate.?limit|brute.?force)\b/i,
      /\b(secret|api.?key|credential|password|token|env(ironment)?.?var(iable)?)\b/i,
      /\b(firewall|waf|tls|ssl|https|certificate)\b/i,
    ],
  },
  ui_design: {
    weight: 0.95,
    patterns: [
      /\b(ui|ux|user.?interface|user.?experience|design|wireframe|mockup|prototype)\b/i,
      /\b(component|layout|page|screen|view|modal|dialog|drawer|sidebar)\b/i,
      /\b(color|palette|theme|font|typography|spacing|padding|margin)\b/i,
      /\b(responsive|mobile.?first|breakpoint|grid|flexbox|tailwind|css)\b/i,
      /\b(button|input|form|card|table|list|menu|nav|header|footer)\b/i,
      /\b(animation|transition|hover|focus|state|loading|skeleton|spinner)\b/i,
      /\b(figma|sketch|adobe.?xd|framer|storybook)\b/i,
      /\b(accessibility|a11y|aria|wcag|contrast|keyboard.?navigation)\b/i,
    ],
  },
};

function scoreText(text: string, bank: PatternBank): { score: number; signals: string[] } {
  const signals: string[] = [];
  let score = 0;
  for (const pattern of bank.patterns) {
    const matches = text.match(pattern);
    if (matches) {
      const hit = matches[0].trim().toLowerCase().slice(0, 40);
      if (!signals.includes(hit)) signals.push(hit);
      score += bank.weight;
    }
  }
  return { score, signals };
}

export function classifyTask(
  messages: Array<{ role: string; content: string }>
): TaskClassification {
  const userMessages = messages
    .filter((m) => m.role === "user")
    .slice(-CONTEXT_WINDOW);

  if (userMessages.length === 0) {
    return { taskType: "general", confidence: 0, signals: [] };
  }

  const text = userMessages.map((m) => m.content).join("\n");
  const scores: Partial<Record<Exclude<TaskType, "general">, { score: number; signals: string[] }>> = {};
  let maxScore = 0;

  for (const [taskType, bank] of Object.entries(PATTERN_BANKS) as [Exclude<TaskType, "general">, PatternBank][]) {
    const result = scoreText(text, bank);
    scores[taskType] = result;
    if (result.score > maxScore) maxScore = result.score;
  }

  if (maxScore === 0) {
    return { taskType: "general", confidence: 0, signals: [] };
  }

  const totalScore = Object.values(scores).reduce((sum, r) => sum + (r?.score ?? 0), 0);

  let bestType: Exclude<TaskType, "general"> = "coding";
  let bestScore = 0;
  for (const [t, r] of Object.entries(scores) as [Exclude<TaskType, "general">, { score: number; signals: string[] }][]) {
    if (r.score > bestScore) { bestScore = r.score; bestType = t; }
  }

  const confidence = totalScore > 0 ? bestScore / totalScore : 0;

  if (confidence < CONFIDENCE_THRESHOLD) {
    return { taskType: "general", confidence, signals: scores[bestType]?.signals ?? [] };
  }

  return {
    taskType: bestType,
    confidence: Math.min(1, confidence),
    signals: scores[bestType]?.signals ?? [],
  };
}

export const taskClassifier = { classify: classifyTask };
