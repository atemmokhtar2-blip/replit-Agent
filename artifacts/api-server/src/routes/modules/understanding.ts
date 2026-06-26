/**
 * Understanding Engine API Routes
 *
 * POST /v1/understanding/analyze        — analyze request → ProjectUnderstanding
 * POST /v1/understanding/specify        — build ExecutionSpec from understanding
 * POST /v1/understanding/validate       — validate a spec
 * POST /v1/understanding/execute        — run phased execution from spec
 * POST /v1/understanding/pipeline       — analyze + specify + validate in one call
 * GET  /v1/understanding/spec/:convId   — get stored spec for a conversation
 * GET  /v1/understanding/phases/:specId — get execution phases for a spec
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import {
  analyzeProject,
  buildSpec,
  saveSpec,
  getSpecByConversation,
  getSpecById,
  updateSpecStatus,
  validateArchitecture,
  runPhases,
  getDefaultPhasePlan,
} from "@workspace/ai-orchestrator";
import type { ProjectUnderstanding, ExecutionSpec } from "@workspace/ai-orchestrator";
import { db, executionPhasesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();
router.use(authenticate);

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getUserId(req: Request): string | null {
  return (req as Request & { userId?: string }).userId ?? null;
}

// ─── POST /analyze ─────────────────────────────────────────────────────────────

router.post("/analyze", async (req: Request, res: Response) => {
  const { request: userRequest } = req.body as { request?: string };
  if (!userRequest || typeof userRequest !== "string" || userRequest.trim().length < 5) {
    return res.status(400).json({ error: "request is required (min 5 characters)" });
  }

  try {
    const understanding = await analyzeProject(userRequest.trim(), (req as { signal?: AbortSignal }).signal);
    return res.json({
      understanding,
      meta: {
        projectType: understanding.projectType,
        confidence: understanding.confidence,
        complexity: understanding.complexity,
        inferredCount: understanding.inferredRequirements.length,
        ambiguities: understanding.ambiguities.length,
      },
    });
  } catch (err) {
    console.error("[POST /understanding/analyze]", err);
    return res.status(500).json({ error: "Failed to analyze project request" });
  }
});

// ─── POST /specify ─────────────────────────────────────────────────────────────

router.post("/specify", async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { understanding, conversationId } = req.body as {
    understanding?: unknown;
    conversationId?: string;
  };

  if (!understanding) return res.status(400).json({ error: "understanding is required" });
  if (!conversationId) return res.status(400).json({ error: "conversationId is required" });

  try {
    const spec = await buildSpec(
      conversationId,
      understanding as ProjectUnderstanding,
      (req as { signal?: AbortSignal }).signal,
    );

    const validation = validateArchitecture(spec);
    const specId = await saveSpec(userId, spec, validation);

    return res.json({
      spec,
      specId,
      validation,
      meta: {
        features: spec.features.length,
        pages: spec.pages.length,
        components: spec.components.length,
        dbTables: spec.dbSchema.length,
        apiContracts: spec.apiContracts.length,
        roadmapPhases: spec.developmentRoadmap.length,
        validationScore: validation.score,
      },
    });
  } catch (err) {
    console.error("[POST /understanding/specify]", err);
    return res.status(500).json({ error: "Failed to build execution spec" });
  }
});

// ─── POST /validate ────────────────────────────────────────────────────────────

router.post("/validate", async (req: Request, res: Response) => {
  const { spec, specId } = req.body as { spec?: unknown; specId?: string };

  let specToValidate: ExecutionSpec | null = null;

  if (specId) {
    specToValidate = await getSpecById(specId).catch(() => null);
    if (!specToValidate) return res.status(404).json({ error: "Spec not found" });
  } else if (spec) {
    specToValidate = spec as ExecutionSpec;
  } else {
    return res.status(400).json({ error: "Provide either spec object or specId" });
  }

  try {
    const result = validateArchitecture(specToValidate);
    if (specId) {
      await updateSpecStatus(specId, result.valid ? "validated" : "validation_failed", result).catch(() => {});
    }
    return res.json({ validation: result });
  } catch (err) {
    console.error("[POST /understanding/validate]", err);
    return res.status(500).json({ error: "Validation failed" });
  }
});

// ─── POST /execute ─────────────────────────────────────────────────────────────

router.post("/execute", async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { specId, planOnly } = req.body as { specId?: string; planOnly?: boolean };
  if (!specId) return res.status(400).json({ error: "specId is required" });

  const spec = await getSpecById(specId).catch(() => null);
  if (!spec) return res.status(404).json({ error: "Spec not found" });

  try {
    if (planOnly) {
      const phasePlan = getDefaultPhasePlan(spec);
      return res.json({
        specId,
        phasePlan,
        totalPhases: phasePlan.length,
        estimatedHours: spec.developmentRoadmap.reduce((sum, r) => sum + (r.estimatedHours ?? 0), 0),
      });
    }

    const executionResult = await runPhases(specId, spec, (phase) => {
      console.log(`[Execution] Phase ${phase.phaseNumber} "${phase.phaseName}": ${phase.status}`);
    });

    return res.json({
      execution: executionResult,
      meta: {
        completedPhases: executionResult.completedPhases,
        skippedPhases: executionResult.skippedPhases,
        failedPhases: executionResult.failedPhases,
        productionReady: executionResult.verificationReport?.productionReady ?? false,
      },
    });
  } catch (err) {
    console.error("[POST /understanding/execute]", err);
    return res.status(500).json({ error: "Execution failed" });
  }
});

// ─── POST /pipeline — analyze + specify + validate in one call ─────────────────

router.post("/pipeline", async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { request: userRequest, conversationId } = req.body as {
    request?: string;
    conversationId?: string;
  };

  if (!userRequest || userRequest.trim().length < 5) {
    return res.status(400).json({ error: "request is required" });
  }
  if (!conversationId) return res.status(400).json({ error: "conversationId is required" });

  try {
    console.log("[Pipeline] Stage 1: Analyzing project...");
    const understanding = await analyzeProject(userRequest.trim(), (req as { signal?: AbortSignal }).signal);

    console.log("[Pipeline] Stage 2: Building execution spec...");
    const spec = await buildSpec(conversationId, understanding, (req as { signal?: AbortSignal }).signal);

    console.log("[Pipeline] Stage 3: Validating architecture...");
    const validation = validateArchitecture(spec);

    const specId = await saveSpec(userId, spec, validation);
    const phasePlan = getDefaultPhasePlan(spec);

    return res.json({
      understanding,
      spec,
      specId,
      validation,
      phasePlan,
      meta: {
        projectType: understanding.projectType,
        confidence: understanding.confidence,
        complexity: understanding.complexity,
        features: spec.features.length,
        pages: spec.pages.length,
        components: spec.components.length,
        dbTables: spec.dbSchema.length,
        apiContracts: spec.apiContracts.length,
        validationScore: validation.score,
        validationPassed: validation.valid,
        roadmapPhases: spec.developmentRoadmap.length,
        techStack: spec.techStack,
      },
    });
  } catch (err) {
    console.error("[POST /understanding/pipeline]", err);
    return res.status(500).json({ error: "Pipeline failed" });
  }
});

// ─── GET /spec/:conversationId ─────────────────────────────────────────────────

router.get("/spec/:conversationId", async (req: Request, res: Response) => {
  const { conversationId } = req.params as { conversationId: string };

  try {
    const spec = await getSpecByConversation(conversationId);
    if (!spec) return res.status(404).json({ error: "No spec found for this conversation" });
    return res.json({ spec });
  } catch (err) {
    console.error("[GET /understanding/spec]", err);
    return res.status(500).json({ error: "Failed to retrieve spec" });
  }
});

// ─── GET /phases/:specId ───────────────────────────────────────────────────────

router.get("/phases/:specId", async (req: Request, res: Response) => {
  const { specId } = req.params as { specId: string };

  try {
    const rows = await db
      .select()
      .from(executionPhasesTable)
      .where(eq(executionPhasesTable.specificationId, specId))
      .orderBy(executionPhasesTable.phaseNumber);

    return res.json({
      phases: rows.map((r) => ({
        id: r.id,
        phaseNumber: r.phaseNumber,
        phaseName: r.phaseName,
        description: r.description,
        status: r.status,
        tasks: r.tasks,
        reviewResult: r.reviewResult,
        artifacts: r.artifacts,
        errorMessage: r.errorMessage,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
      })),
      total: rows.length,
    });
  } catch (err) {
    console.error("[GET /understanding/phases]", err);
    return res.status(500).json({ error: "Failed to retrieve phases" });
  }
});

export default router;
