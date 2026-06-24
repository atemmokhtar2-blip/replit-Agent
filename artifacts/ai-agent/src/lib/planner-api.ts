/**
 * Planner API Client
 *
 * Sends user messages to the dedicated Planner Engine endpoint.
 * Reads the access token from localStorage automatically.
 */

export interface PlannerMessageResult {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  metadata: unknown;
  created_at: string;
}

export interface PlannerResponse {
  success: boolean;
  plan: string;
  conversation_id: string;
  user_message: PlannerMessageResult;
  assistant_message: PlannerMessageResult;
}

export async function sendToPlannerEngine(
  message: string,
  conversationId: string,
): Promise<PlannerResponse> {
  const token = localStorage.getItem("access_token");

  const response = await fetch("/api/v1/ai/planner", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ message, conversation_id: conversationId }),
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

  return response.json() as Promise<PlannerResponse>;
}
