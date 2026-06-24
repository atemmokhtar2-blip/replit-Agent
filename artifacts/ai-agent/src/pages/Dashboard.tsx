import { useAuth } from "@/components/AuthProvider";
import { useGetProjectStats, useGetRecentProjects } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Code2, Globe, Layout, ArrowRight } from "lucide-react";
import { Link } from "wouter";

export default function Dashboard() {
  const { user } = useAuth();

  const { data: stats, isLoading: statsLoading } = useGetProjectStats();
  const { data: recent, isLoading: recentLoading } = useGetRecentProjects({ limit: 5 });

  return (
    <div className="page-content">
      <div className="page-header">
        <h2 className="page-title">Dashboard</h2>
      </div>

      {/* Stat cards */}
      <div className="grid gap-3 grid-cols-2 sm:gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 px-4">
            <CardTitle className="text-xs sm:text-sm font-medium">Total Projects</CardTitle>
            <Layout className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {statsLoading ? (
              <Skeleton className="h-7 w-[50px]" />
            ) : (
              <div className="text-2xl font-bold">{stats?.total || 0}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 px-4">
            <CardTitle className="text-xs sm:text-sm font-medium">Active</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {statsLoading ? (
              <Skeleton className="h-7 w-[50px]" />
            ) : (
              <div className="text-2xl font-bold">
                {stats?.by_status?.active || 0}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 px-4">
            <CardTitle className="text-xs sm:text-sm font-medium">Websites</CardTitle>
            <Globe className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {statsLoading ? (
              <Skeleton className="h-7 w-[50px]" />
            ) : (
              <div className="text-2xl font-bold">
                {stats?.by_type?.website || 0}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 px-4">
            <CardTitle className="text-xs sm:text-sm font-medium">Bots</CardTitle>
            <Code2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {statsLoading ? (
              <Skeleton className="h-7 w-[50px]" />
            ) : (
              <div className="text-2xl font-bold">
                {stats?.by_type?.bot || 0}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Main card */}
      <div className="mt-4 sm:mt-6">
        <Card className="w-full max-w-3xl">
          <CardHeader>
            <CardTitle>Welcome back, {user?.username}</CardTitle>
            <CardDescription>
              Here's an overview of your workspace.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <h4 className="text-sm font-medium">Recent Projects</h4>
              {recentLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : (recent?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No recent projects. Get started by creating one.
                </p>
              ) : (
                <div className="space-y-2">
                  {recent?.map((project) => (
                    <Link key={project.id} href={`/projects/${project.id}`}>
                      <div className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 cursor-pointer transition-colors gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          {project.project_type === "website" ? (
                            <Globe className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                          ) : (
                            <Code2 className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                          )}
                          <span className="font-medium text-sm truncate">
                            {project.name}
                          </span>
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-2 sm:gap-3">
                          <span className="text-xs text-muted-foreground capitalize hidden sm:block">
                            {project.status}
                          </span>
                          <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
