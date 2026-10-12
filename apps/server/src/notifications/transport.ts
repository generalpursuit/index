import type { DeliveryResult } from "@index/api/features/notifications/delivery";

/** Only fixed reason codes cross into the outbox; never persist provider bodies or errors. */
export function responseOutcome(response: Response): DeliveryResult {
  if (response.ok) return { status: "sent" };
  if (response.status === 404 || response.status === 410)
    return { status: "dead", reason: "invalid_destination" };
  if (response.status === 429 || response.status >= 500) {
    const value = response.headers.get("retry-after");
    const seconds =
      value && /^\d+$/.test(value)
        ? Number(value)
        : value
          ? (Date.parse(value) - Date.now()) / 1000
          : 0;
    return {
      status: "retry",
      reason: response.status === 429 ? "rate_limited" : "provider_unavailable",
      retryAfter: Number.isFinite(seconds) ? Math.max(0, seconds) : 0,
    };
  }
  // A rejected credential/request does not mean the subscription is dead.
  return {
    status: "retry",
    reason:
      response.status === 401 || response.status === 403
        ? "provider_authentication"
        : "provider_rejected",
  };
}

export async function requestPush(network: typeof fetch, url: string, init: RequestInit) {
  try {
    return await network(url, {
      ...init,
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }
}
