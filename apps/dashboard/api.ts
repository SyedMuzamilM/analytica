export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = (await response.json().catch(() => null)) as {
    error?: unknown;
    message?: unknown;
  } | null;
  if (!response.ok) {
    const nested =
      typeof data?.error === "object" &&
      data.error !== null &&
      "message" in data.error
        ? data.error.message
        : undefined;
    const message = nested ?? data?.message ?? data?.error;
    const readable: Record<string, string> = {
      invalid_domain: "Enter a valid website domain, such as example.com.",
      invalid_timezone: "Choose a valid reporting timezone.",
      name_required: "Enter a name for this website.",
      site_limit_reached: "This workspace has reached its website limit.",
      site_not_found:
        "This website is no longer available. Refresh your workspace.",
      forbidden: "Your workspace role does not allow this action.",
      invalid_key_configuration:
        "Enter a key name and a namespace using letters, numbers, periods, underscores, or hyphens.",
      key_limit:
        "This website has reached its active server-key limit. Revoke an unused key first.",
      invalid_integration:
        "Check the merchant identifier and webhook secret. Dodo secrets begin with whsec_.",
      integration_already_exists: "This merchant account is already connected.",
      export_too_large:
        "This export exceeds the download limit. Use the operator export procedure.",
    };
    throw new Error(
      typeof message === "string"
        ? (readable[message] ??
            (/^[a-z]+(?:_[a-z]+)+$/.test(message)
              ? `${message.replaceAll("_", " ")}. Try again.`
              : message))
        : `The request failed (${response.status}). Try again.`,
    );
  }
  return data as T;
}

export function post<T>(path: string, body: unknown = {}) {
  return api<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(
    value,
  );
}

export function compact(value: number) {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatDuration(milliseconds: number) {
  const seconds = Math.round(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export function friendlyError(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something interrupted this request. Try again.";
}
