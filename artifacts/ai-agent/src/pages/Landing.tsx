import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ChevronRight, Code2, Cpu, Globe, Layout, Shield, Zap, Menu, X } from "lucide-react";

export default function Landing() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground overflow-x-hidden">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-14 items-center justify-between px-4 mx-auto max-w-screen-xl">
          {/* Brand */}
          <div className="flex items-center gap-2">
            <Cpu className="h-5 w-5 text-primary flex-shrink-0" />
            <span className="font-bold tracking-tight">AI Agent</span>
          </div>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
            <a
              href="#features"
              className="transition-colors hover:text-foreground text-foreground/60"
            >
              Features
            </a>
            <a
              href="#how-it-works"
              className="transition-colors hover:text-foreground text-foreground/60"
            >
              How it Works
            </a>
            <a
              href="#pricing"
              className="transition-colors hover:text-foreground text-foreground/60"
            >
              Pricing
            </a>
          </nav>

          {/* CTA + mobile toggle */}
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2">
              <Link href="/login">
                <Button variant="ghost" size="sm">
                  Log in
                </Button>
              </Link>
              <Link href="/register">
                <Button size="sm">Get Started</Button>
              </Link>
            </div>
            {/* Mobile only: Log in */}
            <div className="flex sm:hidden items-center gap-2">
              <Link href="/login">
                <Button variant="ghost" size="sm">
                  Log in
                </Button>
              </Link>
            </div>
            {/* Hamburger */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden h-9 w-9"
              onClick={() => setMobileMenuOpen((o) => !o)}
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="border-t border-border bg-background px-4 py-3 md:hidden">
            <nav className="flex flex-col gap-1">
              <a
                href="#features"
                className="rounded-md px-3 py-2.5 text-sm font-medium hover:bg-muted"
                onClick={() => setMobileMenuOpen(false)}
              >
                Features
              </a>
              <a
                href="#how-it-works"
                className="rounded-md px-3 py-2.5 text-sm font-medium hover:bg-muted"
                onClick={() => setMobileMenuOpen(false)}
              >
                How it Works
              </a>
              <a
                href="#pricing"
                className="rounded-md px-3 py-2.5 text-sm font-medium hover:bg-muted"
                onClick={() => setMobileMenuOpen(false)}
              >
                Pricing
              </a>
              <div className="mt-2 pt-2 border-t border-border">
                <Link href="/register">
                  <Button className="w-full">Get Started</Button>
                </Link>
              </div>
            </nav>
          </div>
        )}
      </header>

      <main className="flex-1">
        {/* ── Hero ──────────────────────────────────────────────────────────── */}
        <section className="py-12 md:py-20 lg:py-32">
          <div className="flex max-w-4xl flex-col items-center gap-5 text-center mx-auto px-4">
            <div className="inline-flex items-center rounded-lg bg-muted px-3 py-1 text-sm font-medium">
              <Zap className="mr-2 h-4 w-4 text-primary flex-shrink-0" />
              <span className="text-muted-foreground">
                Introducing AI Agent 2.0
              </span>
            </div>
            <h1 className="font-bold text-3xl sm:text-5xl md:text-6xl lg:text-7xl leading-tight">
              Ship software{" "}
              <span className="text-primary">faster</span> with AI.
            </h1>
            <p className="max-w-2xl leading-relaxed text-muted-foreground sm:text-xl">
              A command-center for the future of AI-powered development. Build,
              deploy, and scale websites and bots with unprecedented precision.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 mt-2 w-full sm:w-auto">
              <Link href="/register">
                <Button
                  size="lg"
                  className="h-12 px-8 text-base w-full sm:w-auto"
                >
                  Start Building{" "}
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/login">
                <Button
                  variant="outline"
                  size="lg"
                  className="h-12 px-8 text-base w-full sm:w-auto"
                >
                  View Demo
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* ── Features ──────────────────────────────────────────────────────── */}
        <section
          id="features"
          className="py-12 md:py-20 lg:py-24 border-t border-border bg-muted/30"
        >
          <div className="mx-auto px-4 max-w-5xl">
            <div className="flex max-w-xl flex-col items-center space-y-3 text-center mx-auto mb-10">
              <h2 className="font-bold text-2xl sm:text-3xl md:text-5xl leading-tight">
                Features
              </h2>
              <p className="leading-normal text-muted-foreground sm:text-lg">
                Everything you need to build at enterprise scale.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
              {[
                {
                  icon: Layout,
                  title: "Websites",
                  desc: "Generate full-stack web applications in seconds.",
                },
                {
                  icon: Code2,
                  title: "Bots",
                  desc: "Build complex AI agents and Discord/Slack bots.",
                },
                {
                  icon: Shield,
                  title: "Enterprise Grade",
                  desc: "Secure, compliant, and ready for production.",
                },
              ].map(({ icon: Icon, title, desc }) => (
                <div
                  key={title}
                  className="rounded-lg border border-border bg-card p-6 space-y-3"
                >
                  <Icon className="h-8 w-8 text-primary" />
                  <div>
                    <h3 className="font-bold text-base">{title}</h3>
                    <p className="text-sm text-muted-foreground mt-1">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="border-t border-border py-6 bg-card">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row mx-auto px-4 max-w-screen-xl text-sm text-muted-foreground">
          <p>
            Built by AI Agent Inc. The source code is available on{" "}
            <a
              href="#"
              className="font-medium underline underline-offset-4"
            >
              GitHub
            </a>
            .
          </p>
        </div>
      </footer>
    </div>
  );
}
