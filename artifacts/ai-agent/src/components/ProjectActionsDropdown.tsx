import { useState } from "react";
import { useUpdateProject, useArchiveProject, useDeleteProject, getListProjectsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { MoreVertical, Edit2, Archive, Trash2, Loader2 } from "lucide-react";
import type { Project } from "@workspace/api-client-react";

export function ProjectActionsDropdown({ project }: { project: Project }) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [newName, setNewName] = useState(project.name);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const updateMutation = useUpdateProject();
  const archiveMutation = useArchiveProject();
  const deleteMutation = useDeleteProject();

  const handleRename = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    updateMutation.mutate(
      { projectId: project.id, data: { name: newName } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          toast({ title: "Project renamed" });
          setRenameOpen(false);
        },
        onError: (err) => toast({ variant: "destructive", title: "Error", description: (err as { data?: { error?: string } }).data?.error || err.message })
      }
    );
  };

  const handleArchive = () => {
    if (!confirm("Archive this project?")) return;
    archiveMutation.mutate(
      { projectId: project.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          toast({ title: "Project archived" });
        },
        onError: (err) => toast({ variant: "destructive", title: "Error", description: (err as { data?: { error?: string } }).data?.error || err.message })
      }
    );
  };

  const handleDelete = () => {
    if (!confirm("Delete this project permanently?")) return;
    deleteMutation.mutate(
      { projectId: project.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          toast({ title: "Project deleted" });
        },
        onError: (err) => toast({ variant: "destructive", title: "Error", description: (err as { data?: { error?: string } }).data?.error || err.message })
      }
    );
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setRenameOpen(true); }}>
            <Edit2 className="mr-2 h-4 w-4" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleArchive(); }} disabled={project.status === 'archived'}>
            <Archive className="mr-2 h-4 w-4" /> Archive
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive focus:bg-destructive/10 focus:text-destructive" onClick={(e) => { e.stopPropagation(); handleDelete(); }}>
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Rename Project</DialogTitle>
            <DialogDescription>Enter a new name for your project.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRename} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input 
                id="name" 
                value={newName} 
                onChange={(e) => setNewName(e.target.value)} 
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={updateMutation.isPending || !newName.trim() || newName === project.name}>
                {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
