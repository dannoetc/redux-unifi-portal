export type ApiErrorPayload = { code: string; message: string };

export class ApiError extends Error {
  status: number;
  code?: string;
  payload?: ApiErrorPayload;

  constructor(message: string, status: number, code?: string, payload?: ApiErrorPayload) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const buildUrl = (path: string) => {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${API_BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
};

async function parseJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(buildUrl(path), {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    ...init,
  });

  const payload = await parseJson(response);
  if (!response.ok) {
    const errorPayload = payload?.error as ApiErrorPayload | undefined;
    const message = errorPayload?.message ?? response.statusText ?? "Request failed";
    throw new ApiError(message, response.status, errorPayload?.code, errorPayload);
  }

  if (payload && payload.ok === false) {
    const errorPayload = payload.error as ApiErrorPayload | undefined;
    const message = errorPayload?.message ?? "Request failed";
    throw new ApiError(message, response.status, errorPayload?.code, errorPayload);
  }

  return payload?.data ?? payload;
}

export async function apiDownloadCsv(
  path: string,
  filenameFallback = "export.csv",
  init: RequestInit = {}
) {
  const response = await fetch(buildUrl(path), {
    credentials: "include",
    ...init,
  });

  if (!response.ok) {
    const payload = await parseJson(response);
    const errorPayload = payload?.error as ApiErrorPayload | undefined;
    const message = errorPayload?.message ?? response.statusText ?? "Download failed";
    throw new ApiError(message, response.status, errorPayload?.code, errorPayload);
  }

  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename=([^;]+)/i.exec(disposition);
  const filename = match?.[1]?.replace(/"/g, "") ?? filenameFallback;

  if (typeof window !== "undefined") {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  return filename;
}

export { API_BASE_URL };
