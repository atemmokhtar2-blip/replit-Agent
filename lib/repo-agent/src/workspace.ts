/**
 * Temporary AI Workspace Manager
 *
 * Creates and manages isolated copies of a repository for AI editing.
 * All AI changes happen inside a workspace — the original clone is never touched.
 *
 * Lifecycle:
 *   clone (source) → copy to workspace → AI edits → validate → commit → push → PR → cleanup
 */

import { mkdir, rm } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { copyToWorkspace, createBranch, getCurrentBranch, isGitRepo, setRemoteUrl, buildAuthenticatedCloneUrl } from "@workspace/github";
import type { DiffSummary } from "@workspace/github";
import { getDiffSummary, commitChanges, pushBranch, undoLastCommit, rollbackToCommit, resetToHead, getLog } from "@workspace/github";
import type { LogEntry } from "@workspace/github";

export interface CreateWorkspaceOptions {
  userId: string;
  sessionId: string;
  sourcePath: string;
  branchName: string;
  baseBranch: string;
  pat: string;
  cloneUrl: string;
  authorName?: string;
  authorEmail?: string;
}

export interface WorkspaceInfo {
  sessionId: string;
  localPath: string;
  currentBranch: string;
  baseBranch: string;
}

/**
 * Get the workspace root directory on the server filesystem.
 */
export function getWorkspaceRoot(): string {
  return join(tmpdir(), "ai-agent-workspaces");
}

/**
 * Get the path for a specific workspace session.
 */
export function getWorkspacePath(userId: string, sessionId: string): string {
  return join(getWorkspaceRoot(), userId, sessionId);
}

/**
 * Create a new temporary workspace by copying the source clone.
 */
export async function createWorkspace(options: CreateWorkspaceOptions): Promise<WorkspaceInfo> {
  const { userId, sessionId, sourcePath, branchName, baseBranch, pat, cloneUrl } = options;

  if (!isGitRepo(sourcePath)) {
    throw new Error(`Source path is not a git repository: ${sourcePath}`);
  }

  const workspacePath = getWorkspacePath(userId, sessionId);
  await mkdir(workspacePath, { recursive: true });

  // Copy the source clone to the workspace
  await copyToWorkspace(sourcePath, workspacePath);

  // Update remote URL to include PAT for push access
  const authUrl = buildAuthenticatedCloneUrl(cloneUrl, pat);
  await setRemoteUrl(workspacePath, authUrl);

  // Create and checkout the new AI branch
  await createBranch(workspacePath, branchName, baseBranch);

  return {
    sessionId,
    localPath: workspacePath,
    currentBranch: branchName,
    baseBranch,
  };
}

/**
 * Get a summary of all uncommitted changes in the workspace.
 */
export async function getWorkspaceDiff(workspacePath: string): Promise<DiffSummary> {
  return getDiffSummary(workspacePath);
}

/**
 * Commit all current changes in the workspace.
 */
export async function commitWorkspaceChanges(
  workspacePath: string,
  message: string,
  author?: { name: string; email: string }
): Promise<string> {
  return commitChanges(workspacePath, { message, author });
}

/**
 * Push the workspace branch to remote.
 */
export async function pushWorkspaceBranch(
  workspacePath: string,
  branchName: string
): Promise<void> {
  await pushBranch(workspacePath, branchName);
}

/**
 * Undo the last commit (keep changes staged).
 */
export async function undoWorkspaceLastCommit(workspacePath: string): Promise<void> {
  await undoLastCommit(workspacePath);
}

/**
 * Rollback workspace to a specific commit.
 */
export async function rollbackWorkspace(workspacePath: string, commitHash: string): Promise<void> {
  await rollbackToCommit(workspacePath, commitHash);
}

/**
 * Reset workspace to HEAD (discard all uncommitted changes).
 */
export async function resetWorkspace(workspacePath: string): Promise<void> {
  await resetToHead(workspacePath);
}

/**
 * Get commit log for the workspace.
 */
export async function getWorkspaceLog(workspacePath: string, count = 20): Promise<LogEntry[]> {
  return getLog(workspacePath, count);
}

/**
 * Get the current branch name.
 */
export async function getWorkspaceBranch(workspacePath: string): Promise<string> {
  return getCurrentBranch(workspacePath);
}

/**
 * Delete a workspace directory (cleanup after PR is merged or session ends).
 */
export async function deleteWorkspaceSession(userId: string, sessionId: string): Promise<void> {
  const workspacePath = getWorkspacePath(userId, sessionId);
  if (existsSync(workspacePath)) {
    await rm(workspacePath, { recursive: true, force: true });
  }
}

/**
 * Delete all workspaces for a user.
 */
export async function deleteAllUserWorkspaces(userId: string): Promise<void> {
  const userRoot = join(getWorkspaceRoot(), userId);
  if (existsSync(userRoot)) {
    await rm(userRoot, { recursive: true, force: true });
  }
}

/**
 * Generate a safe branch name from a description.
 */
export function generateBranchName(description: string): string {
  const timestamp = Date.now();
  const slug = description
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40)
    .replace(/-$/, "");
  return `ai/${slug}-${timestamp}`;
}
