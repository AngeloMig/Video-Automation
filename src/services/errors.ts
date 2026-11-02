/** A required provider has no credentials. Retrying can't help until someone configures it. */
export class IntegrationMissingError extends Error {
  readonly code = "integration_missing";
  constructor(
    readonly integration: string,
    readonly envVars: string[],
  ) {
    super(`${integration} is not configured. Set ${envVars.join(" or ")} and retry this job.`);
  }
}

/** The input or provider response can never succeed, so the job fails without retrying. */
export class PermanentError extends Error {
  readonly code: string;
  constructor(message: string, code = "permanent") {
    super(message);
    this.code = code;
  }
}

/** The provider asked us to slow down. The queue honours retryAfterSeconds. */
export class RateLimitError extends Error {
  readonly code = "rate_limited";
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super(message);
  }
}

/** Maps a provider HTTP failure to the right retry behaviour. */
export async function assertOk(response: Response, provider: string): Promise<void> {
  if (response.ok) return;
  const body = (await response.text().catch(() => "")).slice(0, 500);
  const message = `${provider} returned ${response.status}: ${body}`;
  if (response.status === 429) {
    throw new RateLimitError(message, Number(response.headers.get("retry-after")) || 30);
  }
  if (response.status >= 400 && response.status < 500 && response.status !== 408) {
    throw new PermanentError(message, "provider_rejected");
  }
  throw new Error(message);
}
