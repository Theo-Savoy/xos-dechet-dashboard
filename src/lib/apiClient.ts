/** Client HTTP typé partagé — Bearer + Content-Type auto, pas de cache/retry. */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type ApiFetchOptions = {
  method?: string;
  body?: BodyInit;
  signal?: AbortSignal;
};

async function readErrorMessage(res: Response): Promise<{ message: string; body: unknown }> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object") {
      const { message, error } = body as { message?: unknown; error?: unknown };
      if (typeof message === "string") return { message, body };
      if (typeof error === "string") return { message: error, body };
    }
    return { message: `http_${res.status}`, body };
  } catch {
    return { message: `http_${res.status}`, body: undefined };
  }
}

export async function apiFetch<T>(
  token: string,
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const res = await fetch(path, {
    method: options.method,
    body: options.body,
    signal: options.signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const { message, body } = await readErrorMessage(res);
    throw new ApiError(res.status, message, body);
  }

  return res.json() as Promise<T>;
}
