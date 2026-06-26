/**
 * Git operations via simple-git.
 * Handles clone, branch, commit, push, diff, reset, and rollback.
 * All operations are scoped to a local workspace path.
 */

import simpleGit, { type SimpleGit, type DiffResult, type LogResult } from "simple-git";
import { mkdir, rm, cp } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

export interface CloneOptions {
  url: string;
  destination: string;
  branch?: string;
  depth?: number;
}

export interface CommitOptions {
  message: string;
  author?: { name: string; email: string };
}

export interface DiffSummary {
  files: Array<{
    file: string;
    changes: number;
    insertions: number;
    deletions: number;
    status: "added" | "modified" | "deleted" | "renamed";
  }>;
  totalInsertions: number;
  totalDeletions: number;
  rawDiff: string;
}

export interface LogEntry {
  hash: string;
  date: string;
  message: string;
  author_name: string;
  author_email: string;
}

/**
 * Clone a repository to the given destination.
 * Returns a SimpleGit instance scoped to the cloned directory.
 */
export async function cloneRepository(options: CloneOptions): Promise<SimpleGit> {
  const { url, destination, branch, depth = 50 } = options;

  await mkdir(destination, { recursive: true });

  const args: string[] = [`--depth=${depth}`];
  if (branch) args.push(`--branch=${branch}`);

  const git = simpleGit();
  await git.clone(url, destination, args);

  return simpleGit(destination);
}

/**
 * Copy an existing cloned repo to a new workspace directory.
 * Used to create a "temporary AI workspace" without re-cloning.
 */
export async function copyToWorkspace(sourcePath: string, workspacePath: string): Promise<SimpleGit> {
  await mkdir(workspacePath, { recursive: true });
  await cp(sourcePath, workspacePath, { recursive: true });
  return simpleGit(workspacePath);
}

/**
 * Create and checkout a new branch.
 */
export async function createBranch(
  workspacePath: string,
  branchName: string,
  fromBranch?: string
): Promise<void> {
  const git = simpleGit(workspacePath);
  if (fromBranch) {
    await git.checkout(fromBranch);
    await git.pull();
  }
  await git.checkoutLocalBranch(branchName);
}

/**
 * Get current branch name.
 */
export async function getCurrentBranch(workspacePath: string): Promise<string> {
  const git = simpleGit(workspacePath);
  const branch = await git.revparse(["--abbrev-ref", "HEAD"]);
  return branch.trim();
}

/**
 * Stage all changes and commit.
 */
export async function commitChanges(
  workspacePath: string,
  options: CommitOptions
): Promise<string> {
  const git = simpleGit(workspacePath);

  if (options.author) {
    await git.addConfig("user.name", options.author.name);
    await git.addConfig("user.email", options.author.email);
  }

  await git.add(".");
  const result = await git.commit(options.message);
  return result.commit;
}

/**
 * Push the current branch to origin.
 */
export async function pushBranch(
  workspacePath: string,
  branch: string,
  remote = "origin"
): Promise<void> {
  const git = simpleGit(workspacePath);
  await git.push(remote, branch, ["--set-upstream"]);
}

/**
 * Get a diff summary of uncommitted changes.
 */
export async function getDiffSummary(workspacePath: string): Promise<DiffSummary> {
  const git = simpleGit(workspacePath);

  // Get stat summary
  const stat: DiffResult = await git.diffSummary(["HEAD"]);

  // Get full diff text
  let rawDiff = "";
  try {
    rawDiff = await git.diff(["HEAD", "--unified=3"]);
  } catch {
    rawDiff = await git.diff(["--unified=3"]);
  }

  const files = stat.files.map((f) => {
    let status: "added" | "modified" | "deleted" | "renamed" = "modified";
    if ("binary" in f && f.binary) status = "modified";
    if (rawDiff.includes(`new file mode`) && rawDiff.includes(f.file)) status = "added";
    if (rawDiff.includes(`deleted file mode`) && rawDiff.includes(f.file)) status = "deleted";
    return {
      file: f.file,
      changes: f.changes,
      insertions: f.insertions,
      deletions: f.deletions,
      status,
    };
  });

  return {
    files,
    totalInsertions: stat.insertions,
    totalDeletions: stat.deletions,
    rawDiff,
  };
}

/**
 * Get diff between two branches.
 */
export async function getDiffBetweenBranches(
  workspacePath: string,
  base: string,
  head: string
): Promise<DiffSummary> {
  const git = simpleGit(workspacePath);
  const stat: DiffResult = await git.diffSummary([`${base}...${head}`]);
  const rawDiff = await git.diff([`${base}...${head}`, "--unified=3"]);

  const files = stat.files.map((f) => ({
    file: f.file,
    changes: f.changes,
    insertions: f.insertions,
    deletions: f.deletions,
    status: "modified" as const,
  }));

  return {
    files,
    totalInsertions: stat.insertions,
    totalDeletions: stat.deletions,
    rawDiff,
  };
}

/**
 * Get recent git log entries.
 */
export async function getLog(workspacePath: string, count = 20): Promise<LogEntry[]> {
  const git = simpleGit(workspacePath);
  const log: LogResult = await git.log({ maxCount: count });
  return log.all.map((entry) => ({
    hash: entry.hash,
    date: entry.date,
    message: entry.message,
    author_name: entry.author_name,
    author_email: entry.author_email,
  }));
}

/**
 * Reset the working tree to the last commit (undo unstaged changes).
 */
export async function resetToHead(workspacePath: string): Promise<void> {
  const git = simpleGit(workspacePath);
  await git.checkout(["."]);
  await git.clean("f", ["-d"]);
}

/**
 * Hard reset to a specific commit hash.
 */
export async function rollbackToCommit(
  workspacePath: string,
  commitHash: string
): Promise<void> {
  const git = simpleGit(workspacePath);
  await git.reset(["--hard", commitHash]);
}

/**
 * Undo the last commit (soft reset — keeps changes staged).
 */
export async function undoLastCommit(workspacePath: string): Promise<void> {
  const git = simpleGit(workspacePath);
  await git.reset(["--soft", "HEAD~1"]);
}

/**
 * Pull latest from remote.
 */
export async function pullLatest(workspacePath: string, branch?: string): Promise<void> {
  const git = simpleGit(workspacePath);
  await git.pull("origin", branch ?? "HEAD");
}

/**
 * List all local branches.
 */
export async function listLocalBranches(workspacePath: string): Promise<string[]> {
  const git = simpleGit(workspacePath);
  const result = await git.branchLocal();
  return result.all;
}

/**
 * Check whether a path is a valid git repo.
 */
export function isGitRepo(path: string): boolean {
  return existsSync(join(path, ".git"));
}

/**
 * Delete a workspace directory entirely.
 */
export async function deleteWorkspace(workspacePath: string): Promise<void> {
  if (existsSync(workspacePath)) {
    await rm(workspacePath, { recursive: true, force: true });
  }
}

/**
 * Configure remote URL (useful to update PAT when token rotates).
 */
export async function setRemoteUrl(workspacePath: string, url: string, remote = "origin"): Promise<void> {
  const git = simpleGit(workspacePath);
  await git.remote(["set-url", remote, url]);
}

/**
 * Fetch all remotes to sync state.
 */
export async function fetchAll(workspacePath: string): Promise<void> {
  const git = simpleGit(workspacePath);
  await git.fetch(["--all", "--prune"]);
}
