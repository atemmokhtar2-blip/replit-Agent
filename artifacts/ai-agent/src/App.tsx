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
import Settings from "@/pages/Settings";
import Notifications from "@/pages/Notifications";
import Admin from "@/pages/Admin";
import ChatWorkspace from "@/pages/ChatWorkspace";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      
      {/* Protected Routes */}
      <Route path="/chat">
        <ProtectedRoute><AppLayout><ChatWorkspace /></AppLayout></ProtectedRoute>
      </Route>
      <Route path="/dashboard">
        <ProtectedRoute><AppLayout><Dashboard /></AppLayout></ProtectedRoute>
      </Route>
      <Route path="/projects">
        <ProtectedRoute><AppLayout><Projects /></AppLayout></ProtectedRoute>
      </Route>
      <Route path="/projects/:id">
        <ProtectedRoute><ProjectWorkspace /></ProtectedRoute>
      </Route>
      <Route path="/settings">
        <ProtectedRoute><AppLayout><Settings /></AppLayout></ProtectedRoute>
      </Route>
      <Route path="/notifications">
        <ProtectedRoute><AppLayout><Notifications /></AppLayout></ProtectedRoute>
      </Route>
      <Route path="/admin">
        <ProtectedRoute requireAdmin><AppLayout><Admin /></AppLayout></ProtectedRoute>
      </Route>

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
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
