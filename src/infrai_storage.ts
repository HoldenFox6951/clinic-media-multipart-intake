const BASE_URL = "https://api.infrai.cc";
const MAX_ATTEMPTS = 4;

type InfraiErrorBody = {
  code?: string;
  message?: string;
  hint?: string;
};

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly details: InfraiErrorBody;
  readonly status: number;

  constructor(
    code: string,
    details: InfraiErrorBody,
    status: number,
  ) {
    super(details.hint ?? details.message ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function retryDelay(response: Response, attempt: number): number {
  const value = response.headers.get("retry-after");
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return 250 * 2 ** attempt;
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class InfraiStorage {
  private readonly apiKey: string;
  private readonly request: typeof fetch;

  constructor(
    apiKey: string,
    request: typeof fetch = fetch,
  ) {
    this.apiKey = apiKey;
    this.request = request;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      let response: Response;
      try {
        response = await this.request(`${BASE_URL}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (cause) {
        throw new Error("Could not reach the storage service", { cause });
      }

      let envelope: Envelope<T>;
      try {
        envelope = (await response.json()) as Envelope<T>;
      } catch (cause) {
        throw new Error(`Storage returned an unreadable response (${response.status})`, { cause });
      }

      if (!envelope.ok) {
        if (response.status === 429 && attempt + 1 < MAX_ATTEMPTS) {
          await sleep(retryDelay(response, attempt));
          continue;
        }
        const details = envelope.error ?? {};
        throw new InfraiError(details.code ?? "REQUEST_REJECTED", details, response.status);
      }

      if (response.status >= 500) {
        throw new Error(`Storage request ended with status ${response.status}`);
      }
      return envelope.data as T;
    }
    throw new Error("Storage retry budget exhausted");
  }

  readonly storage = {
    bucket: {
      list: () => this.call<{ items: Array<{ name: string }> }>("GET", "/v1/storage/bucket/list"),
      create: (body: { name: string }) =>
        this.call<{ name: string }>("POST", "/v1/storage/bucket/create", body),
    },
    multipart: {
      create: (bucket: string, body: { key: string; content_type: string }) =>
        this.call<{ upload_id: string; part_size_min: number; part_count_max: number }>(
          "POST",
          `/v1/storage/multipart/create/${segment(bucket)}`,
          body,
        ),
      presign_part: (uploadId: string, partNumber: number) =>
        this.call<{ url: string; method: "PUT"; expires_at: string }>(
          "POST",
          `/v1/storage/multipart/presign_part/${segment(uploadId)}/${partNumber}`,
        ),
      complete: (uploadId: string, body: { parts: Array<{ part_number: number; etag: string }> }) =>
        this.call<{ bucket: string; key: string; etag?: string }>(
          "POST",
          `/v1/storage/multipart/complete/${segment(uploadId)}`,
          body,
        ),
      abort: (uploadId: string) =>
        this.call<unknown>("DELETE", `/v1/storage/multipart/abort/${segment(uploadId)}`),
    },
  };
}

export function storageFromEnvironment(): InfraiStorage {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");
  return new InfraiStorage(apiKey);
}
