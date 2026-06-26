import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import projectsRouter from "./projects";
import notificationsRouter from "./notifications";
import adminRouter from "./admin";
import auditRouter from "./audit";

import aiRouter from "./modules/ai";
import aiControlRouter from "./modules/ai-control";
import deploymentRouter from "./modules/deployment";
import memoryRouter from "./modules/memory";
import storageModuleRouter from "./modules/storage";
import agentsRouter from "./modules/agents";
import understandingRouter from "./modules/understanding";

import tasksRouter from "./modules/tasks";

import githubRouter from "./modules/github";
import repositoriesRouter from "./modules/repositories";
import secretsCenterRouter from "./modules/secrets-center";
import workspacesRouter from "./modules/workspaces";

const router: IRouter = Router();

// Health
router.use(healthRouter);

// API v1 — Core Modules
router.use("/v1/auth", authRouter);
router.use("/v1/users", usersRouter);
router.use("/v1/projects", projectsRouter);
router.use("/v1/notifications", notificationsRouter);
router.use("/v1/admin", adminRouter);
router.use("/v1/audit", auditRouter);

// API v1 — AI Modules
router.use("/v1/ai", aiRouter);
router.use("/v1/ai", aiControlRouter);
router.use("/v1/deployments", deploymentRouter);
router.use("/v1/memory", memoryRouter);
router.use("/v1/storage", storageModuleRouter);
router.use("/v1/agents", agentsRouter);
router.use("/v1/understanding", understandingRouter);

router.use("/v1/tasks", tasksRouter);

// API v1 — Repository Agent Modules
router.use("/v1/github", githubRouter);
router.use("/v1/repositories", repositoriesRouter);
router.use("/v1/secrets", secretsCenterRouter);
router.use("/v1/workspaces", workspacesRouter);

export default router;
