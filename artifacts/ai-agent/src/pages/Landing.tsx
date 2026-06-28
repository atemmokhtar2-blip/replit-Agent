import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { ChevronRight, Code2, Globe, Layout, Shield, Zap, Menu, X } from "lucide-react";

export default function Landing() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground overflow-x-hidden">
      {/* ── Background ───────────────────────────────────────────────────────── */}
      <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 right-0 h-96 w-96 rounded-full bg-primary/8 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-96 w-96 rounded-full bg-primary/6 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: "linear-gradient(hsl(var(--primary)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary)) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
          }}
        />
      </div>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/90 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70">
        <div className="flex h-14 items-center justify-between px-4 mx-auto max-w-screen-xl">
          <Logo size="sm" animate="idle" />

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
            <a href="#features"    className="transition-colors hover:text-foreground text-foreground/60">Features</a>
            <a href="#how-it-works" className="transition-colors hover:text-foreground text-foreground/60">How it Works</a>
            <a href="#pricing"     className="transition-colors hover:text-foreground text-foreground/60">Pricing</a>
          </nav>

          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2">
              <Link href="/login">
                <Button variant="ghost" size="sm">Log in</Button>
              </Link>
              <Link href="/register">
                <Button size="sm">Get Started</Button>
              </Link>
            </div>
            <div className="flex sm:hidden items-center gap-2">
              <Link href="/login">
                <Button variant="ghost" size="sm">Log in</Button>
              </Link>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden h-9 w-9"
              onClick={() => setMobileMenuOpen((o) => !o)}
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="border-t border-border bg-background px-4 py-3 md:hidden">
            <nav className="flex flex-col gap-1">
              <a href="#features"     className="rounded-md px-3 py-2.5 text-sm font-medium hover:bg-muted" onClick={() => setMobileMenuOpen(false)}>Features</a>
              <a href="#how-it-works" className="rounded-md px-3 py-2.5 text-sm font-medium hover:bg-muted" onClick={() => setMobileMenuOpen(false)}>How it Works</a>
              <a href="#pricing"      className="rounded-md px-3 py-2.5 text-sm font-medium hover:bg-muted" onClick={() => setMobileMenuOpen(false)}>Pricing</a>
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
        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section className="py-16 md:py-24 lg:py-36">
          <div className="flex max-w-4xl flex-col items-center gap-6 text-center mx-auto px-4">
            <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-sm font-medium gap-2">
              <Zap className="h-3.5 w-3.5 text-primary flex-shrink-0" />
              <span className="text-foreground/70">Introducing Project 7</span>
            </div>

            <div className="flex justify-center">
              <Logo size="2xl" animate="idle" variant="icon" />
            </div>

            <h1 className="font-bold text-4xl sm:text-5xl md:text-6xl lg:text-7xl leading-tight tracking-tight">
              Ship software{" "}
              <span className="text-primary">faster</span>{" "}
              with AI.
            </h1>
            <p className="max-w-2xl leading-relaxed text-muted-foreground sm:text-xl">
              The AI-powered architecture and development platform. Design complete system blueprints across 8 real execution stages — from concept to production.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 mt-2 w-full sm:w-auto">
              <Link href="/register">
                <Button size="lg" className="h-12 px-8 text-base w-full sm:w-auto">
                  Start Building <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/login">
                <Button variant="outline" size="lg" className="h-12 px-8 text-base w-full sm:w-auto">
                  Sign In
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* ── Features ─────────────────────────────────────────────────────── */}
        <section id="features" className="py-16 md:py-20 border-t border-border bg-muted/20">
          <div className="mx-auto px-4 max-w-5xl">
            <div className="flex max-w-xl flex-col items-center space-y-3 text-center mx-auto mb-12">
              <h2 className="font-bold text-2xl sm:text-3xl md:text-4xl leading-tight">
                Everything you need
              </h2>
              <p className="leading-normal text-muted-foreground sm:text-lg">
                A complete platform for AI-powered software development.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
              {[
                { icon: Layout,  title: "Architecture Blueprints", desc: "Generate complete system architectures with 8-stage AI planning." },
                { icon: Code2,   title: "Live Execution",          desc: "Watch your blueprint come to life with real-time execution logs." },
                { icon: Globe,   title: "Full-Stack",              desc: "From frontend to backend, databases to deployment." },
                { icon: Shield,  title: "Enterprise Grade",        desc: "Secure, compliant, and ready for production workloads." },
                { icon: Zap,     title: "Instant Context",         desc: "Import any GitHub repo and get AI analysis in seconds." },
                { icon: ChevronRight, title: "Provider Agnostic",  desc: "OpenRouter, OpenAI, Anthropic, and more — your choice." },
              ].map(({ icon: Icon, title, desc }) => (
                <div key={title} className="rounded-xl border border-border bg-card/60 backdrop-blur p-6 space-y-3 hover:border-primary/30 transition-colors">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-base">{title}</h3>
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer className="border-t border-border py-8 bg-card/40">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row mx-auto px-4 max-w-screen-xl text-sm text-muted-foreground">
          <Logo size="xs" animate="static" entrance={false} />
          <p>
            Project 7 — AI Development Platform.{" "}
            <a href="#" className="font-medium underline underline-offset-4">Open source</a>.
          </p>
        </div>
      </footer>
    </div>
  );
}
