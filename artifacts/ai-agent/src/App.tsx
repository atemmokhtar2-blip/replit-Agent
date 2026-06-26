import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/components/AuthProvider";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/AppLayout";

import NotFound from "@/pages/not-found";

import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";

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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

// ── Stable page components for protected routes ──────────────────────────────
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

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
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
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="dark">
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
              <Toaster />
            </WouterRouter>
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
