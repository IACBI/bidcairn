let csrf = "";
class APIError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch("/api" + path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => {
    throw new APIError(
      "The service returned an unreadable response. Retry shortly.",
      response.status,
    );
  });
  if (!response.ok)
    throw new APIError(
      body.error || "The operation could not be completed.",
      response.status,
    );
  return body as T;
}
export async function signIn(email: string, password: string) {
  const result = await api<{ csrf: string }>("/session", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  csrf = result.csrf;
}
export async function session() {
  try {
    const current = await api<{ csrf: string }>("/session");
    csrf = current.csrf;
  } catch (error) {
    if (!(error instanceof APIError) || error.status !== 401) throw error;
    const created = await api<{ csrf: string }>("/session", {
      method: "POST",
      body: "{}",
    });
    csrf = created.csrf;
  }
}
