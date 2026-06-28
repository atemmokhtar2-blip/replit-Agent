import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/AppLayout";
import { TaskProvider } from "@/lib/task-store";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";

import NotFound from "@/pages/not-found";

import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import OAuthCallback from "@/pages/OAuthCallback";

import Dashboard from "@/pages/Dashboard";
import Projects from "@/pages/Projects";
import ProjectWorkspace from "@/pages/ProjectWorkspace";
import Repositories from "@/pages/Repositories";
import SecretsCenter from "@/pages/SecretsCenter";
import Settings from "@/pages/Settings";
import Notifications from "@/pages/Notifications";
import Admin from "@/pages/Admin";
import ChatWorkspace from "@/pages/ChatWorkspace";
import ControlCenter from "@/pages/ControlCenter";
import Workspaces from "@/pages/Workspaces";
import AIEngine from "@/pages/AIEngine";
import AIProvidersPage from "@/pages/AIProvidersPage";
import AIModelsPage from "@/pages/AIModelsPage";
import Profile from "@/pages/Profile";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

// ── Root redirect: unauthenticated → /login, authenticated → /dashboard ──────

function RootPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isLoading) return;
    if (isAuthenticated) {
      setLocation("/dashboard");
    } else {
      setLocation("/login");
    }
  }, [isLoading, isAuthenticated, setLocation]);

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

// ── Stable page components for protected routes ───────────────────────────────
// All routes MUST use the `component` prop (not children) inside <Switch>.
// Mixing the two patterns causes Wouter's reconciler to produce an inconsistent
// React element tree across renders, which triggers React 18's insertBefore
// DOM crash when switching between routes.

const ChatPage = () => (
  <ProtectedRoute>
    <AppLayout>
      <ChatWorkspace />
    </AppLayout>
  </ProtectedRoute>
);

const DashboardPage = () => (
  <ProtectedRoute>
    <AppLayout>
      <Dashboard />
    </AppLayout>
  </ProtectedRoute>
);

const ProjectsPage = () => (
  <ProtectedRoute>
    <AppLayout>
      <Projects />
    </AppLayout>
  </ProtectedRoute>
);

const ProjectWorkspacePage = () => (
  <ProtectedRoute>
    <ProjectWorkspace />
  </ProtectedRoute>
);

const SettingsPage = () => (
  <ProtectedRoute>
    <AppLayout>
      <Settings />
    </AppLayout>
  </ProtectedRoute>
);

const NotificationsPage = () => (
  <ProtectedRoute>
    <AppLayout>
      <Notifications />
    </AppLayout>
  </ProtectedRoute>
);

const AdminPage = () => (
  <ProtectedRoute requireAdmin>
    <AppLayout>
      <Admin />
    </AppLayout>
  </ProtectedRoute>
);

const ControlCenterPage = () => (
  <ProtectedRoute>
    <AppLayout>
      <ControlCenter />
    </AppLayout>
  </ProtectedRoute>
);

const RepositoriesPage = () => (
  <ProtectedRoute>
    <AppLayout>
      <Repositories />
    </AppLayout>
  </ProtectedRoute>
);

const SecretsCenterPage = () => (
  <ProtectedRoute>
    <AppLayout>
      <SecretsCenter />
    </AppLayout>
  </ProtectedRoute>
);

const WorkspacesPage = () => (
  <ProtectedRoute>
    <AppLayout>
      <Workspaces />
    </AppLayout>
  </ProtectedRoute>
);

const AIEnginePage = () => (
  <ProtectedRoute>
    <AppLayout>
      <AIEngine />
    </AppLayout>
  </ProtectedRoute>
);

const AIProvidersPageWrapper = () => (
  <ProtectedRoute requireAdmin>
    <AppLayout>
      <AIProvidersPage />
    </AppLayout>
  </ProtectedRoute>
);

const AIModelsPageWrapper = () => (
  <ProtectedRoute requireAdmin>
    <AppLayout>
      <AIModelsPage />
    </AppLayout>
  </ProtectedRoute>
);

const ProfilePage = () => (
  <ProtectedRoute>
    <AppLayout>
      <Profile />
    </AppLayout>
  </ProtectedRoute>
);

const LandingPage = () => <Landing />;
const LoginPage = () => <Login />;
const RegisterPage = () => <Register />;
const ForgotPasswordPage = () => <ForgotPassword />;
const ResetPasswordPage = () => <ResetPassword />;
const OAuthCallbackPage = () => <OAuthCallback />;

function Router() {
  return (
    <Switch>
      <Route path="/" component={RootPage} />
      <Route path="/landing" component={LandingPage} />
      <Route path="/login" component={LoginPage} />
      <Route path="/register" component={RegisterPage} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/auth/callback" component={OAuthCallbackPage} />
      <Route path="/chat" component={ChatPage} />
      <Route path="/dashboard" component={DashboardPage} />
      <Route path="/projects" component={ProjectsPage} />
      <Route path="/projects/:id" component={ProjectWorkspacePage} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/notifications" component={NotificationsPage} />
      <Route path="/admin" component={AdminPage} />
      <Route path="/control-center" component={ControlCenterPage} />
      <Route path="/repositories" component={RepositoriesPage} />
      <Route path="/secrets" component={SecretsCenterPage} />
      <Route path="/workspaces" component={WorkspacesPage} />
      <Route path="/ai-engine" component={AIEnginePage} />
      <Route path="/ai-providers" component={AIProvidersPageWrapper} />
      <Route path="/ai-models" component={AIModelsPageWrapper} />
      <Route path="/profile" component={ProfilePage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="dark">
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TaskProvider>
            <TooltipProvider>
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
