/**
 * Planner Streaming Client
 *
 * Reads the SSE stream from POST /api/v1/ai/planner/stream using fetch +
 * ReadableStream (EventSource does not support custom headers, so we roll our own).
 */

export type PlannerStreamEvent =
  | { type: "stage_start"; stage: number; name: string }
  | { type: "stage_complete"; stage: number }
  | { type: "content_chunk"; text: string }
  | { type: "section_detected"; section: number; title: string }
  | { type: "done"; content: string; model: string; conversationId: string; messageId: string }
  | { type: "conversation"; content: string; conversationId: string; messageId: string }
  | { type: "error"; message: string }
  | { type: "thinking_start"; model: string }
  | { type: "thinking_chunk"; text: string }
  | { type: "thinking_complete" }
  | { type: "model_switch"; stage: number; toModel: string; taskType: string }
  | { type: "provider_status"; event: "key_try" | "key_success" | "key_fail" | "key_switch" | "provider_switch"; provider: string; providerDisplay: string; keyName?: string; keyIndex?: number; totalKeys?: number; model?: string; reason?: string; nextProvider?: string; nextProviderDisplay?: string };

export const PLANNER_STAGES = [
  { id: 1, name: "Understanding Request",      action: "Scanning" },
  { id: 2, name: "Analyzing Requirements",     action: "Mapping" },
  { id: 3, name: "Designing Architecture",     action: "Structuring" },
  { id: 4, name: "Planning Project Structure", action: "Structuring" },
  { id: 5, name: "Designing Database & APIs",  action: "Synthesizing" },
  { id: 6, name: "Preparing Dev Roadmap",      action: "Synthesizing" },
  { id: 7, name: "Finalizing Architecture",    action: "Finalizing" },
  { id: 8, name: "Blueprint Ready",            action: "Sealing" },
] as const;

export async function streamToPlannerEngine(
  message: string,
  conversationId: string,
  onEvent: (event: PlannerStreamEvent) => void,
  signal?: AbortSignal,
  repositoryId?: string,
): Promise<void> {
  const { getAccessToken } = await import("./token-manager");
  const token = await getAccessToken();

  const response = await fetch("/api/v1/ai/planner/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      message,
      conversation_id: conversationId,
      ...(repositoryId ? { repository_id: repositoryId } : {}),
    }),
    signal,
  });

  if (!response.ok) {
    let errorMsg = `Planner request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) errorMsg = body.error;
    } catch {
      // ignore parse error
    }
    throw new Error(errorMsg);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") return;

        try {
          const event = JSON.parse(data) as PlannerStreamEvent;
          onEvent(event);
        } catch {
          // malformed event — skip
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
