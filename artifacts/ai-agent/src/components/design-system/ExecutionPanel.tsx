/**
 * ExecutionPanel
 *
 * Displayed after a PROJECT blueprint is generated.
 * Shows:
 *  1. Execution summary — project type, file count, API endpoints, DB tables, dev phases
 *  2. File tree preview — estimated project structure based on detected tech stack
 *
 * Purely derived from the already-generated blueprint text.
 * No new network requests. No fake data. All parsing is synchronous.
 */

// ── Blueprint section extractor ────────────────────────────────────────────────

function extractSection(blueprint: string, num: number): string {
  const re = new RegExp(
    `^##\\s+${num}\\.\\s+.+$([\\s\\S]*?)(?=^##\\s+\\d+\\.\\s+|$)`,
    "m",
  );
  const m = re.exec(blueprint);
  return m ? m[1]!.trim() : "";
}

// ── Project type detection ─────────────────────────────────────────────────────

type ProjectType =
  | "telegram"
  | "discord"
  | "whatsapp"
  | "mobile"
  | "ecommerce"
  | "saas"
  | "dashboard"
  | "api"
  | "website"
  | "bot"
  | "generic";

function detectProjectType(blueprint: string): ProjectType {
  const s2 = extractSection(blueprint, 2).toLowerCase();
  const s8 = extractSection(blueprint, 8).toLowerCase();
  const full = (s2 + " " + s8).toLowerCase();

  if (/telegram\s*bot/i.test(full)) return "telegram";
  if (/discord\s*bot/i.test(full)) return "discord";
  if (/whatsapp/i.test(full)) return "whatsapp";
  if (/mobile\s*app|react\s*native|flutter|expo/i.test(full)) return "mobile";
  if (/e[-\s]?commerce|online\s*store|shopify/i.test(full)) return "ecommerce";
  if (/saas|software[\s-]as[\s-]a[\s-]service/i.test(full)) return "saas";
  if (/dashboard|admin\s*panel|analytics\s*platform/i.test(full)) return "dashboard";
  if (/api\s*service|rest[\s-]?api|microservice|graphql\s*api/i.test(full)) return "api";
  if (/website|web\s*app|web\s*application|landing/i.test(full)) return "website";
  if (/bot|chatbot|automation/i.test(full)) return "bot";
  return "generic";
}

// ── Metric extraction ──────────────────────────────────────────────────────────

function countLines(text: string): number {
  return text.split("\n").filter((l) => l.trim().length > 0).length;
}

function estimateApiEndpoints(blueprint: string): number {
  const s7 = extractSection(blueprint, 7);
  const methods = (s7.match(/\b(GET|POST|PUT|PATCH|DELETE)\b/g) ?? []).length;
  const routeLines = (
    s7.match(/^\s*[-•*]\s*(GET|POST|PUT|PATCH|DELETE|\w+\s+\/[\w/:]+)/gm) ?? []
  ).length;
  if (methods > 0) return Math.max(methods, routeLines);
  if (routeLines > 0) return routeLines;
  // Fallback: count bullet points in section 7 as rough proxy
  const bullets = (s7.match(/^\s*[-•*]\s+\S/gm) ?? []).length;
  return bullets > 0 ? Math.min(bullets, 20) : 8;
}

function estimateDbTables(blueprint: string): number {
  const s6 = extractSection(blueprint, 6);
  if (!s6) return 0;
  // Count bold table/entity names: **TableName** or ## heading per entity
  const bold = (s6.match(/\*\*[A-Z][A-Za-z]+\*\*/g) ?? []).length;
  const bullets = (s6.match(/^\s*[-•*]\s+\S/gm) ?? []).length;
  return bold > 0 ? Math.min(bold, 15) : Math.min(bullets, 12);
}

function estimateDevPhases(blueprint: string): number {
  const s11 = extractSection(blueprint, 11);
  if (!s11) return 3;
  const phases = (s11.match(/\bphase\s*\d+/gi) ?? []).length;
  return phases > 0 ? Math.min(phases, 6) : 3;
}

function estimateFileCount(type: ProjectType): number {
  const counts: Record<ProjectType, number> = {
    telegram: 24,
    discord: 26,
    whatsapp: 22,
    mobile: 38,
    ecommerce: 52,
    saas: 48,
    dashboard: 34,
    api: 20,
    website: 30,
    bot: 22,
    generic: 28,
  };
  return counts[type] ?? 28;
}

// ── File tree definitions ──────────────────────────────────────────────────────

interface FileNode {
  name: string;
  children?: FileNode[];
}

function websiteTree(): FileNode[] {
  return [
    {
      name: "frontend/",
      children: [
        {
          name: "src/",
          children: [
            {
              name: "app/",
              children: [
                { name: "page.tsx" },
                { name: "layout.tsx" },
                { name: "globals.css" },
              ],
            },
            {
              name: "components/",
              children: [
                { name: "Navbar.tsx" },
                { name: "Footer.tsx" },
                { name: "Hero.tsx" },
                { name: "ui/" },
              ],
            },
            { name: "lib/utils.ts" },
            { name: "hooks/useAuth.ts" },
          ],
        },
        { name: "public/" },
        { name: "package.json" },
      ],
    },
    {
      name: "backend/",
      children: [
        {
          name: "src/",
          children: [
            { name: "routes/", children: [{ name: "auth.ts" }, { name: "api.ts" }] },
            { name: "services/", children: [{ name: "database.ts" }, { name: "email.ts" }] },
            { name: "middleware/", children: [{ name: "auth.ts" }, { name: "cors.ts" }] },
            { name: "index.ts" },
          ],
        },
        { name: "package.json" },
      ],
    },
    {
      name: "database/",
      children: [{ name: "schema.sql" }, { name: "migrations/" }, { name: "seeds/" }],
    },
    {
      name: "config/",
      children: [{ name: ".env.example" }, { name: "docker-compose.yml" }],
    },
  ];
}

function telegramTree(): FileNode[] {
  return [
    {
      name: "bot/",
      children: [
        {
          name: "src/",
          children: [
            {
              name: "handlers/",
              children: [
                { name: "start.ts" },
                { name: "menu.ts" },
                { name: "callbacks.ts" },
                { name: "inline.ts" },
              ],
            },
            {
              name: "services/",
              children: [{ name: "database.ts" }, { name: "api.ts" }, { name: "cache.ts" }],
            },
            { name: "utils/", children: [{ name: "keyboards.ts" }, { name: "messages.ts" }] },
            { name: "middleware/", children: [{ name: "session.ts" }, { name: "auth.ts" }] },
            { name: "index.ts" },
          ],
        },
        { name: "package.json" },
      ],
    },
    {
      name: "api/",
      children: [
        { name: "routes/", children: [{ name: "webhook.ts" }, { name: "admin.ts" }] },
        { name: "index.ts" },
      ],
    },
    {
      name: "database/",
      children: [{ name: "schema.sql" }, { name: "migrations/" }],
    },
    {
      name: "config/",
      children: [{ name: ".env.example" }, { name: "docker-compose.yml" }],
    },
  ];
}

function discordTree(): FileNode[] {
  return [
    {
      name: "bot/",
      children: [
        {
          name: "src/",
          children: [
            {
              name: "commands/",
              children: [
                { name: "ping.ts" },
                { name: "help.ts" },
                { name: "admin.ts" },
              ],
            },
            {
              name: "events/",
              children: [
                { name: "ready.ts" },
                { name: "messageCreate.ts" },
                { name: "interactionCreate.ts" },
              ],
            },
            { name: "utils/", children: [{ name: "embed.ts" }, { name: "permissions.ts" }] },
            { name: "index.ts" },
            { name: "deploy-commands.ts" },
          ],
        },
        { name: "package.json" },
      ],
    },
    {
      name: "database/",
      children: [{ name: "schema.sql" }, { name: "migrations/" }],
    },
    {
      name: "config/",
      children: [{ name: ".env.example" }, { name: "docker-compose.yml" }],
    },
  ];
}

function dashboardTree(): FileNode[] {
  return [
    {
      name: "frontend/",
      children: [
        {
          name: "src/",
          children: [
            {
              name: "pages/",
              children: [
                { name: "Dashboard.tsx" },
                { name: "Analytics.tsx" },
                { name: "Users.tsx" },
                { name: "Settings.tsx" },
              ],
            },
            {
              name: "components/",
              children: [
                { name: "charts/", children: [{ name: "LineChart.tsx" }, { name: "BarChart.tsx" }] },
                { name: "tables/", children: [{ name: "DataTable.tsx" }] },
                { name: "Sidebar.tsx" },
                { name: "Header.tsx" },
              ],
            },
            { name: "hooks/", children: [{ name: "useMetrics.ts" }, { name: "useFilters.ts" }] },
            { name: "lib/api.ts" },
          ],
        },
        { name: "package.json" },
      ],
    },
    {
      name: "backend/",
      children: [
        {
          name: "src/",
          children: [
            { name: "routes/", children: [{ name: "metrics.ts" }, { name: "users.ts" }, { name: "auth.ts" }] },
            { name: "services/", children: [{ name: "analytics.ts" }, { name: "aggregation.ts" }] },
            { name: "index.ts" },
          ],
        },
        { name: "package.json" },
      ],
    },
    { name: "database/", children: [{ name: "schema.sql" }, { name: "migrations/" }] },
    { name: "config/", children: [{ name: ".env.example" }] },
  ];
}

function saasTree(): FileNode[] {
  return [
    {
      name: "frontend/",
      children: [
        {
          name: "src/",
          children: [
            {
              name: "app/",
              children: [
                { name: "(auth)/", children: [{ name: "login/page.tsx" }, { name: "signup/page.tsx" }] },
                { name: "(dashboard)/", children: [{ name: "page.tsx" }, { name: "settings/page.tsx" }, { name: "billing/page.tsx" }] },
                { name: "layout.tsx" },
              ],
            },
            { name: "components/", children: [{ name: "ui/" }, { name: "Sidebar.tsx" }, { name: "PricingCard.tsx" }] },
            { name: "lib/", children: [{ name: "stripe.ts" }, { name: "auth.ts" }, { name: "api.ts" }] },
          ],
        },
        { name: "package.json" },
      ],
    },
    {
      name: "backend/",
      children: [
        {
          name: "src/",
          children: [
            { name: "routes/", children: [{ name: "auth.ts" }, { name: "billing.ts" }, { name: "users.ts" }, { name: "teams.ts" }] },
            { name: "services/", children: [{ name: "stripe.ts" }, { name: "email.ts" }, { name: "usage.ts" }] },
            { name: "middleware/", children: [{ name: "auth.ts" }, { name: "plan.ts" }] },
            { name: "index.ts" },
          ],
        },
        { name: "package.json" },
      ],
    },
    { name: "database/", children: [{ name: "schema.sql" }, { name: "migrations/" }] },
    { name: "config/", children: [{ name: ".env.example" }, { name: "docker-compose.yml" }] },
  ];
}

function mobileTree(): FileNode[] {
  return [
    {
      name: "app/",
      children: [
        { name: "(tabs)/", children: [{ name: "index.tsx" }, { name: "explore.tsx" }, { name: "profile.tsx" }] },
        { name: "auth/", children: [{ name: "login.tsx" }, { name: "signup.tsx" }] },
        { name: "_layout.tsx" },
      ],
    },
    {
      name: "components/",
      children: [
        { name: "ui/", children: [{ name: "Button.tsx" }, { name: "Card.tsx" }, { name: "Input.tsx" }] },
        { name: "screens/", children: [{ name: "HomeScreen.tsx" }, { name: "ProfileScreen.tsx" }] },
      ],
    },
    {
      name: "hooks/",
      children: [{ name: "useAuth.ts" }, { name: "useData.ts" }],
    },
    {
      name: "services/",
      children: [{ name: "api.ts" }, { name: "storage.ts" }, { name: "notifications.ts" }],
    },
    {
      name: "backend/",
      children: [
        { name: "routes/", children: [{ name: "auth.ts" }, { name: "users.ts" }, { name: "push.ts" }] },
        { name: "services/", children: [{ name: "fcm.ts" }, { name: "database.ts" }] },
        { name: "index.ts" },
      ],
    },
    { name: "database/", children: [{ name: "schema.sql" }] },
    { name: "config/", children: [{ name: ".env.example" }, { name: "app.json" }] },
  ];
}

function ecommerceTree(): FileNode[] {
  return [
    {
      name: "frontend/",
      children: [
        {
          name: "src/",
          children: [
            {
              name: "pages/",
              children: [
                { name: "index.tsx" },
                { name: "products/[id].tsx" },
                { name: "cart.tsx" },
                { name: "checkout.tsx" },
                { name: "orders.tsx" },
              ],
            },
            {
              name: "components/",
              children: [
                { name: "ProductCard.tsx" },
                { name: "Cart.tsx" },
                { name: "Checkout.tsx" },
                { name: "Navbar.tsx" },
              ],
            },
            { name: "lib/", children: [{ name: "stripe.ts" }, { name: "cart.ts" }] },
          ],
        },
        { name: "package.json" },
      ],
    },
    {
      name: "backend/",
      children: [
        {
          name: "src/",
          children: [
            { name: "routes/", children: [{ name: "products.ts" }, { name: "orders.ts" }, { name: "payments.ts" }, { name: "users.ts" }] },
            { name: "services/", children: [{ name: "stripe.ts" }, { name: "inventory.ts" }, { name: "email.ts" }] },
            { name: "index.ts" },
          ],
        },
        { name: "package.json" },
      ],
    },
    { name: "database/", children: [{ name: "schema.sql" }, { name: "migrations/" }, { name: "seeds/" }] },
    { name: "config/", children: [{ name: ".env.example" }, { name: "docker-compose.yml" }] },
  ];
}

function apiTree(): FileNode[] {
  return [
    {
      name: "src/",
      children: [
        { name: "routes/", children: [{ name: "v1/", children: [{ name: "auth.ts" }, { name: "resources.ts" }, { name: "webhooks.ts" }] }] },
        { name: "services/", children: [{ name: "database.ts" }, { name: "cache.ts" }, { name: "queue.ts" }] },
        { name: "middleware/", children: [{ name: "auth.ts" }, { name: "rateLimiter.ts" }, { name: "validate.ts" }] },
        { name: "models/", children: [{ name: "user.ts" }, { name: "resource.ts" }] },
        { name: "index.ts" },
      ],
    },
    { name: "database/", children: [{ name: "schema.sql" }, { name: "migrations/" }] },
    { name: "docs/", children: [{ name: "openapi.yaml" }, { name: "README.md" }] },
    { name: "config/", children: [{ name: ".env.example" }, { name: "docker-compose.yml" }] },
  ];
}

function genericTree(): FileNode[] {
  return [
    {
      name: "frontend/",
      children: [
        { name: "src/", children: [{ name: "App.tsx" }, { name: "components/" }, { name: "pages/" }, { name: "lib/" }] },
        { name: "package.json" },
      ],
    },
    {
      name: "backend/",
      children: [
        { name: "src/", children: [{ name: "routes/" }, { name: "services/" }, { name: "index.ts" }] },
        { name: "package.json" },
      ],
    },
    { name: "database/", children: [{ name: "schema.sql" }] },
    { name: "config/", children: [{ name: ".env.example" }, { name: "docker-compose.yml" }] },
  ];
}

function buildFileTree(type: ProjectType): FileNode[] {
  switch (type) {
    case "telegram":  return telegramTree();
    case "discord":   return discordTree();
    case "whatsapp":  return telegramTree(); // same structure
    case "mobile":    return mobileTree();
    case "ecommerce": return ecommerceTree();
    case "saas":      return saasTree();
    case "dashboard": return dashboardTree();
    case "api":       return apiTree();
    case "website":   return websiteTree();
    case "bot":       return telegramTree();
    default:          return genericTree();
  }
}

// ── File tree renderer ─────────────────────────────────────────────────────────

interface RenderedLine {
  indent: number;
  prefix: string;
  name: string;
  isDir: boolean;
  index: number;
}

function flattenTree(nodes: FileNode[], depth = 0, counter = { n: 0 }): RenderedLine[] {
  const lines: RenderedLine[] = [];
  nodes.forEach((node, i) => {
    const isLast = i === nodes.length - 1;
    const isDir = node.name.endsWith("/") || (node.children && node.children.length > 0);
    lines.push({
      indent: depth,
      prefix: depth === 0 ? "" : isLast ? "└─ " : "├─ ",
      name: node.name,
      isDir: Boolean(isDir),
      index: counter.n++,
    });
    if (node.children) {
      lines.push(...flattenTree(node.children, depth + 1, counter));
    }
  });
  return lines;
}

function FileTreeView({ blueprint }: { blueprint: string }) {
  const type = detectProjectType(blueprint);
  const tree = buildFileTree(type);
  const lines = flattenTree(tree);

  return (
    <div className="rounded-lg border border-border bg-card/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-2.5 bg-muted/30">
        <div className="flex items-center gap-2">
          <FolderIcon />
          <span className="text-xs font-semibold text-foreground">Project Files</span>
        </div>
        <span className="text-[10px] text-muted-foreground/50 tabular-nums">
          {lines.filter((l) => !l.isDir).length} files · {lines.filter((l) => l.isDir).length} dirs
        </span>
      </div>

      {/* Tree */}
      <div className="px-4 py-3 font-mono text-[11px] leading-5">
        {lines.map((line) => (
          <div
            key={line.index}
            className="agent-tree-line flex items-baseline gap-0 whitespace-nowrap overflow-hidden"
            style={{ animationDelay: `${line.index * 28}ms` }}
          >
            {/* Indent guides */}
            {Array.from({ length: line.indent }).map((_, k) => (
              <span key={k} className="inline-block w-4 flex-shrink-0 text-border/40 select-none">
                {k === line.indent - 1 ? "" : "│ "}
              </span>
            ))}
            {/* Prefix */}
            {line.prefix && (
              <span className="text-border/60 flex-shrink-0 select-none">{line.prefix}</span>
            )}
            {/* Name */}
            <span className={line.isDir ? "text-primary/80 font-medium" : "text-foreground/70"}>
              {line.name}
            </span>
          </div>
        ))}
        <div className="mt-2 pt-2 border-t border-border/30">
          <span className="text-[10px] text-muted-foreground/40 italic">
            Estimated structure · files will be generated in the execution phase
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Execution summary ──────────────────────────────────────────────────────────

interface SummaryMetric {
  label: string;
  value: string | number;
  sub?: string;
}

function MetricCell({ metric, index }: { metric: SummaryMetric; index: number }) {
  return (
    <div
      className="agent-summary-cell flex flex-col gap-0.5 rounded-md border border-border/60 bg-muted/20 px-3 py-2.5"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/50">
        {metric.label}
      </span>
      <span className="text-sm font-semibold text-foreground tabular-nums">{metric.value}</span>
      {metric.sub && (
        <span className="text-[10px] text-muted-foreground/40">{metric.sub}</span>
      )}
    </div>
  );
}

function ExecutionSummary({ blueprint, model }: { blueprint: string; model?: string }) {
  const type = detectProjectType(blueprint);
  const s2Body = extractSection(blueprint, 2);
  const typeLabel = s2Body.split("\n").find((l) => l.trim().length > 0)?.trim() ?? type;
  const trimmedTypeLabel = typeLabel.replace(/^(Classification|Type)\s*[:–-]\s*/i, "").trim();
  const displayType = trimmedTypeLabel.length > 0 && trimmedTypeLabel.length < 80
    ? trimmedTypeLabel
    : type.charAt(0).toUpperCase() + type.slice(1);

  const apiEndpoints = estimateApiEndpoints(blueprint);
  const dbTables = estimateDbTables(blueprint);
  const devPhases = estimateDevPhases(blueprint);
  const fileCount = estimateFileCount(type);
  const sectionsGenerated = (blueprint.match(/^## \d+\./gm) ?? []).length;

  const metrics: SummaryMetric[] = [
    { label: "Project Type",     value: displayType },
    { label: "Planned Files",    value: `~${fileCount}`,      sub: "estimated" },
    { label: "API Endpoints",    value: `~${apiEndpoints}`,   sub: "estimated" },
    { label: "Database Tables",  value: `~${dbTables}`,       sub: "estimated" },
    { label: "Dev Phases",       value: devPhases,             sub: "phases" },
    { label: "Blueprint Sections", value: sectionsGenerated,  sub: `of 12` },
  ];

  return (
    <div className="rounded-lg border border-border bg-card/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-2.5 bg-muted/30">
        <div className="flex items-center gap-2">
          <CheckShieldIcon />
          <span className="text-xs font-semibold text-foreground">Execution Summary</span>
        </div>
        {model && (
          <span className="text-[10px] text-muted-foreground/40">
            via {model.split("/").pop()}
          </span>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/30 bg-green-500/5">
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-green-500/20 ring-1 ring-green-500/40 flex-shrink-0">
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <polyline points="1.5,4 3,5.5 6.5,2" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="text-[11px] font-medium text-green-400">Architecture Generated</span>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3">
        {metrics.map((m, i) => (
          <MetricCell key={m.label} metric={m} index={i} />
        ))}
      </div>
    </div>
  );
}

// ── Icon helpers ───────────────────────────────────────────────────────────────

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-primary/70">
      <path
        d="M1 3.5C1 2.67 1.67 2 2.5 2H5.5L7 3.5H11.5C12.33 3.5 13 4.17 13 5V10.5C13 11.33 12.33 12 11.5 12H2.5C1.67 12 1 11.33 1 10.5V3.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckShieldIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-green-400/80">
      <path d="M7 1L12 3V7.5C12 10 9.5 12.5 7 13C4.5 12.5 2 10 2 7.5V3L7 1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <polyline points="4.5,7 6,8.5 9.5,5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Main export ────────────────────────────────────────────────────────────────

interface ExecutionPanelProps {
  blueprint: string;
  model?: string;
}

export function ExecutionPanel({ blueprint, model }: ExecutionPanelProps) {
  if (!blueprint || blueprint.trim().length < 50) return null;

  const sectionsGenerated = (blueprint.match(/^## \d+\./gm) ?? []).length;
  if (sectionsGenerated < 2) return null;

  return (
    <div className="flex flex-col gap-3 mt-3 pt-3 border-t border-border/30">
      <ExecutionSummary blueprint={blueprint} model={model} />
      <FileTreeView blueprint={blueprint} />
    </div>
  );
}

// Named re-exports for partial usage
export { detectProjectType, estimateApiEndpoints, estimateDbTables, estimateDevPhases };
export type { ProjectType, FileNode };
