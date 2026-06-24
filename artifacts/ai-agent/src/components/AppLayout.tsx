import React, { useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "./AuthProvider";
import { useLogout } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  FolderGit2,
  Settings,
  ShieldAlert,
  Bell,
  LogOut,
  Command,
  MessageSquare,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

// ── Breakpoint constant (matches Tailwind's lg: 1024px) ──────────────────────
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

  // ── Track desktop/mobile breakpoint ──────────────────────────────────────
  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${LG_BREAKPOINT}px)`);
    const handler = (e: MediaQueryListEvent) => {
      setIsDesktop(e.matches);
      if (e.matches) {
        setSidebarOpen(true);
      }
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  // ── Auto-close sidebar on navigation (mobile / tablet only) ──────────────
  useEffect(() => {
    if (!isDesktop) {
      setSidebarOpen(false);
    }
  }, [location, isDesktop]);

  const handleLogout = () => {
    logoutMutation.mutate(undefined, {
      onSuccess: () => {
        logout();
        setLocation("/login");
      },
    });
  };

  const closeSidebar = useCallback(() => {
    if (!isDesktop) setSidebarOpen(false);
  }, [isDesktop]);

  const navItems = [
    { href: "/chat", label: "Chat", icon: MessageSquare },
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/projects", label: "Projects", icon: FolderGit2 },
    { href: "/notifications", label: "Notifications", icon: Bell },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  if (user?.role === "admin" || user?.role === "super_admin") {
    navItems.push({ href: "/admin", label: "Admin", icon: ShieldAlert });
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">

      {/* ── Overlay backdrop — mobile / tablet only ─────────────────────────── */}
      {sidebarOpen && !isDesktop && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar ──────────────────────────────────────────────────────────── */}
      <aside
        className={[
          // Base: fixed overlay on mobile / tablet
          "fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border bg-card",
          "w-[var(--sidebar-width)] transition-transform duration-300 ease-in-out",
          // Mobile/tablet: slide in/out
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
          // Desktop: always in normal document flow, always visible
          "lg:relative lg:z-auto lg:translate-x-0",
        ].join(" ")}
        aria-label="Main navigation"
      >
        {/* Brand / Logo */}
        <div className="flex h-[var(--header-height)] flex-shrink-0 items-center gap-2 border-b border-border px-5">
          <Command className="h-5 w-5 text-primary flex-shrink-0" />
          <span className="font-bold tracking-tight">AI Agent</span>
          {/* Close button — mobile only */}
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
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
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
                  "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                  "min-h-[2.5rem]",
                  isActive
                    ? "bg-primary/10 text-primary"
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
          <div className="flex items-center gap-3 mb-3 px-2 min-w-0">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary text-sm font-semibold">
              {user?.username?.[0]?.toUpperCase() ?? "U"}
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">
                {user?.username}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {user?.email}
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            className="w-full justify-start text-muted-foreground hover:text-destructive hover:bg-destructive/10 min-h-[2.5rem]"
            onClick={handleLogout}
            disabled={logoutMutation.isPending}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Logout
          </Button>
        </div>
      </aside>

      {/* ── Main content column ──────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">

        {/* Mobile / tablet top header */}
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
          <Command className="h-5 w-5 text-primary" />
          <span className="font-bold tracking-tight">AI Agent</span>

          {/* Desktop sidebar toggle — visible on lg+ inside the header */}
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

        {/* Page content */}
        <main className="flex-1 min-w-0 overflow-hidden" role="main">
          {children}
        </main>
      </div>
    </div>
  );
}
