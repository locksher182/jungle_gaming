export interface RetryOptions {
  maxRetries?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
}

export function isTransientDbError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const msg = String((error as any).message || "");
  const code = (error as any).code || "";

  // 23505: unique_violation (concurrent idempotency race)
  // 55P03: lock_not_available (lock_timeout)
  // 40001: serialization_failure / deadlock_detected (40P01)
  return (
    code === "23505" ||
    code === "55P03" ||
    code === "40001" ||
    code === "40P01" ||
    msg.includes("unique_idempotency_key") ||
    msg.includes("lock_timeout") ||
    msg.includes("deadlock detected")
  );
}

export async function retryWithJitter<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const minDelayMs = options.minDelayMs ?? 10;
  const maxDelayMs = options.maxDelayMs ?? 50;
  const shouldRetry = options.shouldRetry ?? isTransientDbError;

  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      attempt++;
      if (attempt > maxRetries || !shouldRetry(error)) {
        throw error;
      }
      // Full jitter sleep
      const delay = Math.floor(minDelayMs + Math.random() * (maxDelayMs - minDelayMs));
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
