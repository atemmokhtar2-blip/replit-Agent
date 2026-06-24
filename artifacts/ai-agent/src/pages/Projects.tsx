import { useState } from "react";
import { useListProjects } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FolderGit2, Search, Globe, Code2 } from "lucide-react";
import { Link } from "wouter";
import { CreateProjectDialog } from "@/components/CreateProjectDialog";
import { ProjectActionsDropdown } from "@/components/ProjectActionsDropdown";

export default function Projects() {
  const [search, setSearch] = useState("");
  const { data: projects, isLoading } = useListProjects({
    page: 1,
    per_page: 20,
    search: search || undefined,
  });

  return (
    <div className="page-content">
      {/* Header */}
      <div className="page-header">
        <div className="min-w-0">
          <h2 className="page-title">Projects</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage your websites and bots.
          </p>
        </div>
        <div className="flex-shrink-0">
          <CreateProjectDialog />
        </div>
      </div>

      {/* Search */}
      <div className="mb-5">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search projects..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Grid */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 sm:gap-4">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="flex flex-col">
              <CardHeader className="pb-2">
                <Skeleton className="h-5 w-[150px]" />
              </CardHeader>
              <CardContent className="flex-1 pb-2">
                <Skeleton className="h-4 w-[200px]" />
              </CardContent>
            </Card>
          ))
        ) : projects?.items.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center p-8 text-center border rounded-lg border-dashed">
            <FolderGit2 className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">No projects found</h3>
            <p className="text-sm text-muted-foreground mt-1 mb-4">
              You don't have any projects yet.
            </p>
            <CreateProjectDialog />
          </div>
        ) : (
          projects?.items.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <Card className="flex flex-col cursor-pointer hover:border-primary/50 transition-colors h-[152px] sm:h-[160px]">
                <CardHeader className="pb-2 flex flex-row items-start justify-between space-y-0 px-4 pt-4">
                  <CardTitle className="text-sm font-medium flex items-center gap-2 min-w-0">
                    <span className="flex-shrink-0">
                      {project.project_type === "website" ? (
                        <Globe className="h-4 w-4" />
                      ) : (
                        <Code2 className="h-4 w-4" />
                      )}
                    </span>
                    <span className="truncate">{project.name}</span>
                  </CardTitle>
                  <div
                    className="flex-shrink-0 -mt-1 -mr-1"
                    onClick={(e) => e.preventDefault()}
                  >
                    <ProjectActionsDropdown project={project} />
                  </div>
                </CardHeader>
                <CardContent className="flex-1 pb-3 px-4 flex flex-col justify-between">
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {project.description || "No description provided."}
                  </p>
                  <div className="flex items-center justify-between mt-3">
                    <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold border-transparent bg-secondary text-secondary-foreground capitalize">
                      {project.status}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(project.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
