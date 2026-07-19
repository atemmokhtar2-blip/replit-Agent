import React, { useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "./AuthProvider";
import { useLogout } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import {
  LayoutDashboard,
  FolderGit2,
  Settings,
  ShieldAlert,
  Bell,
  LogOut,
  MessageSquare,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  GitFork,
  KeyRound,
  Layers,
  BrainCircuit,
  Network,
  Sparkles,
  BarChart3,
  Route,
} from "lucide-react";

const LG_BREAKPOINT = 1024;

function getInitialSidebarState(): boolean {
  if (typeof window === "undefined") return true;
  return window.innerWidth >= LG_BREAKPOINT;
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const logoutMutation = useLogout();
  const [sidebarOpen, setSidebarOpen] = useState(getInitialSidebarState);
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= LG_BREAKPOINT : true
  );

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${LG_BREAKPOINT}px)`);
    const handler = (e: MediaQueryListEvent) => {
      setIsDesktop(e.matches);
      if (e.matches) setSidebarOpen(true);
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    if (!isDesktop) setSidebarOpen(false);
  }, [location, isDesktop]);

  const handleLogout = () => {
    // Always clear local session – don't wait for API to succeed
    const doLogout = () => { logout(); setLocation("/login"); };
    logoutMutation.mutate(undefined, {
      onSuccess: doLogout,
      onError:   doLogout,
    });
  };

  const closeSidebar = useCallback(() => {
    if (!isDesktop) setSidebarOpen(false);
  }, [isDesktop]);

  const navItems = [
    { href: "/chat",          label: "Chat",          icon: MessageSquare },
    { href: "/dashboard",     label: "Dashboard",     icon: LayoutDashboard },
    { href: "/projects",      label: "Projects",      icon: FolderGit2 },
    { href: "/repositories",  label: "Repositories",  icon: GitFork },
    { href: "/workspaces",    label: "Workspaces",    icon: Layers },
    { href: "/secrets",       label: "Secrets",       icon: KeyRound },
    { href: "/ai-engine",     label: "AI Engine",     icon: BrainCircuit },
    { href: "/notifications", label: "Notifications", icon: Bell },
    { href: "/settings",      label: "Settings",      icon: Settings },
  ];

  if (user?.role === "admin" || user?.role === "super_admin") {
    navItems.push({ href: "/ai-providers", label: "AI Providers", icon: Network });
    navItems.push({ href: "/ai-models",    label: "AI Models",    icon: Sparkles });
    navItems.push({ href: "/ai-dashboard", label: "AI Dashboard", icon: BarChart3 });
    navItems.push({ href: "/ai-router",    label: "AI Router",    icon: Route });
    navItems.push({ href: "/admin",        label: "Admin",        icon: ShieldAlert });
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">

      {/* Mobile overlay */}
      {sidebarOpen && !isDesktop && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar ──────────────────────────────────────────────────────────── */}
      <aside
        className={[
          "fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border bg-card",
          "w-[var(--sidebar-width)] transition-transform duration-300 ease-in-out",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
          "lg:relative lg:z-auto lg:translate-x-0",
        ].join(" ")}
        aria-label="Main navigation"
      >
        {/* Brand */}
        <div className="flex h-[var(--header-height)] flex-shrink-0 items-center gap-2 border-b border-border px-5">
          <Link href="/dashboard" className="flex items-center gap-2 flex-1 min-w-0">
            <Logo size="sm" animate="idle" entrance={false} />
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-8 w-8 lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5" aria-label="Primary">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              location === item.href ||
              location.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeSidebar}
                className={[
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                  "min-h-[2.5rem]",
                  isActive
                    ? "bg-primary/10 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.15)]"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                ].join(" ")}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* User section */}
        <div className="flex-shrink-0 border-t border-border p-3">
          <Link
            href="/profile"
            onClick={closeSidebar}
            className="flex items-center gap-3 mb-3 px-2 min-w-0 rounded-lg py-1.5 hover:bg-muted/60 transition-colors"
          >
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary text-sm font-semibold ring-1 ring-primary/20">
              {user?.username?.[0]?.toUpperCase() ?? "U"}
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">{user?.username}</span>
              <span className="truncate text-xs text-muted-foreground">{user?.email}</span>
            </div>
          </Link>
          <Button
            variant="ghost"
            className="w-full justify-start text-muted-foreground hover:text-destructive hover:bg-destructive/10 min-h-[2.5rem] transition-colors"
            onClick={handleLogout}
            disabled={logoutMutation.isPending}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </Button>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">

        {/* Mobile top header */}
        <header
          className="flex h-[var(--header-height)] flex-shrink-0 items-center gap-3 border-b border-border bg-card px-4 lg:hidden"
          style={{ paddingTop: "var(--safe-top)" }}
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <Logo size="sm" animate="idle" entrance={false} />

          <div className="hidden lg:flex ml-auto">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setSidebarOpen((o) => !o)}
              aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            >
              {sidebarOpen ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeftOpen className="h-4 w-4" />
              )}
            </Button>
          </div>
        </header>

        <main className="flex-1 min-w-0 overflow-hidden" role="main">
          {children}
        </main>
      </div>
    </div>
  );
}
