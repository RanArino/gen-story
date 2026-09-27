let csrfToken: string | null = null;

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
}

export async function getCsrfToken(): Promise<string> {
  if (csrfToken != null) return csrfToken;
  const response = await fetch(`${apiBase()}/api/auth/csrf`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("Could not initialize a secure session.");
  const body = (await response.json()) as { csrfToken?: string };
  if (body.csrfToken == null) {
    throw new Error("The API returned an invalid CSRF response.");
  }
  csrfToken = body.csrfToken;
  return csrfToken;
}

export async function establishSession(idToken: string): Promise<void> {
  const token = await getCsrfToken();
  const response = await fetch(`${apiBase()}/api/auth/session`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": token,
    },
    body: JSON.stringify({ idToken }),
  });
  if (!response.ok) throw new Error("Could not create the hosted session.");
  const body = (await response.json()) as { csrfToken?: string };
  csrfToken = body.csrfToken ?? null;
}

export async function endSession(): Promise<void> {
  const token = await getCsrfToken();
  const response = await fetch(`${apiBase()}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
    headers: { "X-CSRF-Token": token },
  });
  csrfToken = null;
  if (!response.ok) throw new Error("Could not close the hosted session.");
}
