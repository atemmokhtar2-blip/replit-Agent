import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import projectsRouter from "./projects";
import notificationsRouter from "./notifications";
import adminRouter from "./admin";
import auditRouter from "./audit";

// Placeholder module routers (architecture ready, no business logic yet)
import aiRouter from "./modules/ai";
import aiControlRouter from "./modules/ai-control";
import deploymentRouter from "./modules/deployment";
import memoryRouter from "./modules/memory";
import storageModuleRouter from "./modules/storage";
import agentsRouter from "./modules/agents";

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

// API v1 — Future Modules (architecture placeholders)
router.use("/v1/ai", aiRouter);
router.use("/v1/ai", aiControlRouter);
router.use("/v1/deployments", deploymentRouter);
router.use("/v1/memory", memoryRouter);
router.use("/v1/storage", storageModuleRouter);
router.use("/v1/agents", agentsRouter);

export default router;
