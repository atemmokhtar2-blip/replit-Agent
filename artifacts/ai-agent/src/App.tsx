import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/AppLayout";
import { TaskProvider } from "@/lib/task-store";
import { SevenIntro, hasSeenIntro } from "@/components/SevenIntro";
import { Logo } from "@/components/Logo";

// ── Lazy-loaded pages (reduces initial bundle size) ─────────────────────────
const NotFound         = lazy(() => import("@/pages/not-found"));
const Landing          = lazy(() => import("@/pages/Landing"));
const Login            = lazy(() => import("@/pages/Login"));
const Register         = lazy(() => import("@/pages/Register"));
const ForgotPassword   = lazy(() => import("@/pages/ForgotPassword"));
const ResetPassword    = lazy(() => import("@/pages/ResetPassword"));
const OAuthCallback    = lazy(() => import("@/pages/OAuthCallback"));
const Dashboard        = lazy(() => import("@/pages/Dashboard"));
const Projects         = lazy(() => import("@/pages/Projects"));
const ProjectWorkspace = lazy(() => import("@/pages/ProjectWorkspace"));
const Repositories     = lazy(() => import("@/pages/Repositories"));
const SecretsCenter    = lazy(() => import("@/pages/SecretsCenter"));
const Settings         = lazy(() => import("@/pages/Settings"));
const Notifications    = lazy(() => import("@/pages/Notifications"));
const Admin            = lazy(() => import("@/pages/Admin"));
const ChatWorkspace    = lazy(() => import("@/pages/ChatWorkspace"));
const Workspaces       = lazy(() => import("@/pages/Workspaces"));
const AIEngine         = lazy(() => import("@/pages/AIEngine"));
const AIProvidersPage  = lazy(() => import("@/pages/AIProvidersPage"));
const AIModelsPage     = lazy(() => import("@/pages/AIModelsPage"));
const Profile          = lazy(() => import("@/pages/Profile"));

// ── Loading fallback ────────────────────────────────────────────────────────
function PageLoader() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <Logo size="xl" animate="loading" variant="icon" />
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false },
  },
});

// ── Root redirect ────────────────────────────────────────────────────────────
function RootPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isLoading) return;
    setLocation(isAuthenticated ? "/chat" : "/login");
  }, [isLoading, isAuthenticated, setLocation]);

  return <PageLoader />;
}

// ── Protected page wrappers ──────────────────────────────────────────────────
const ChatPage = () => (
  <ProtectedRoute><AppLayout><ChatWorkspace /></AppLayout></ProtectedRoute>
);
const DashboardPage = () => (
  <ProtectedRoute><AppLayout><Dashboard /></AppLayout></ProtectedRoute>
);
const ProjectsPage = () => (
  <ProtectedRoute><AppLayout><Projects /></AppLayout></ProtectedRoute>
);
const ProjectWorkspacePage = () => (
  <ProtectedRoute><ProjectWorkspace /></ProtectedRoute>
);
const SettingsPage = () => (
  <ProtectedRoute><AppLayout><Settings /></AppLayout></ProtectedRoute>
);
const NotificationsPage = () => (
  <ProtectedRoute><AppLayout><Notifications /></AppLayout></ProtectedRoute>
);
const AdminPage = () => (
  <ProtectedRoute requireAdmin><AppLayout><Admin /></AppLayout></ProtectedRoute>
);
const RepositoriesPage = () => (
  <ProtectedRoute><AppLayout><Repositories /></AppLayout></ProtectedRoute>
);
const SecretsCenterPage = () => (
  <ProtectedRoute><AppLayout><SecretsCenter /></AppLayout></ProtectedRoute>
);
const WorkspacesPage = () => (
  <ProtectedRoute><AppLayout><Workspaces /></AppLayout></ProtectedRoute>
);
const AIEnginePage = () => (
  <ProtectedRoute><AppLayout><AIEngine /></AppLayout></ProtectedRoute>
);
const AIProvidersPageWrapper = () => (
  <ProtectedRoute requireAdmin><AppLayout><AIProvidersPage /></AppLayout></ProtectedRoute>
);
const AIModelsPageWrapper = () => (
  <ProtectedRoute requireAdmin><AppLayout><AIModelsPage /></AppLayout></ProtectedRoute>
);
const ProfilePage = () => (
  <ProtectedRoute><AppLayout><Profile /></AppLayout></ProtectedRoute>
);

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/"                component={RootPage} />
        <Route path="/landing"         component={() => <Landing />} />
        <Route path="/login"           component={() => <Login />} />
        <Route path="/register"        component={() => <Register />} />
        <Route path="/forgot-password" component={() => <ForgotPassword />} />
        <Route path="/reset-password"  component={() => <ResetPassword />} />
        <Route path="/auth/callback"   component={() => <OAuthCallback />} />
        <Route path="/chat"            component={ChatPage} />
        <Route path="/dashboard"       component={DashboardPage} />
        <Route path="/projects"        component={ProjectsPage} />
        <Route path="/projects/:id"    component={ProjectWorkspacePage} />
        <Route path="/settings"        component={SettingsPage} />
        <Route path="/notifications"   component={NotificationsPage} />
        <Route path="/admin"           component={AdminPage} />
        <Route path="/repositories"    component={RepositoriesPage} />
        <Route path="/secrets"         component={SecretsCenterPage} />
        <Route path="/workspaces"      component={WorkspacesPage} />
        <Route path="/ai-engine"       component={AIEnginePage} />
        <Route path="/ai-providers"    component={AIProvidersPageWrapper} />
        <Route path="/ai-models"       component={AIModelsPageWrapper} />
        <Route path="/profile"         component={ProfilePage} />
        <Route                         component={() => <NotFound />} />
      </Switch>
    </Suspense>
  );
}

function App() {
  const [introComplete, setIntroComplete] = useState(hasSeenIntro);

  return (
    <ThemeProvider defaultTheme="dark">
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TaskProvider>
            <TooltipProvider>
              {!introComplete && (
                <SevenIntro onComplete={() => setIntroComplete(true)} />
              )}
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                <Router />
                <Toaster />
              </WouterRouter>
            </TooltipProvider>
          </TaskProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
