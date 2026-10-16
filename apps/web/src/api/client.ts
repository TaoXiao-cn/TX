// 未设置时默认本地 API；显式空字符串表示与页面同源（生产 Nginx 反代 /api）
const _viteApi = import.meta.env.VITE_API_BASE_URL;
const API_BASE =
  _viteApi === undefined
    ? "http://localhost:8787"
    : String(_viteApi).replace(/\/$/, "");

const TOKEN_KEY = "progress_token";

export type User = {
  id: string;
  email: string;
  displayName: string;
};

export type Project = {
  id: string;
  title: string;
  description: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
};

export type Attachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  url: string;
  publicUrl?: string;
  createdAt: string;
};

function absoluteAttachmentUrl(url: string) {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${API_BASE}${url.startsWith("/") ? "" : "/"}${url}`;
}

export type ProgressEntry = {
  id: string;
  projectId: string;
  contentJson: unknown;
  contentHtml: string;
  createdAt: string;
  updatedAt: string;
  attachments: Attachment[];
};

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    let message = `请求失败 (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return res.json() as Promise<T>;
  }
  return res as unknown as T;
}

export const api = {
  register(email: string, password: string, displayName?: string) {
    return request<{ token: string; user: User }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, displayName }),
    });
  },
  login(email: string, password: string) {
    return request<{ token: string; user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },
  me() {
    return request<{ user: User }>("/api/auth/me");
  },
  listProjects(status: "active" | "archived" | "all" = "active") {
    return request<{ projects: Project[] }>(
      `/api/projects?status=${status}`,
    );
  },
  createProject(title: string, description = "") {
    return request<{ project: Project }>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ title, description }),
    });
  },
  updateProject(
    id: string,
    data: Partial<Pick<Project, "title" | "description" | "status">>,
  ) {
    return request<{ project: Project }>(`/api/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },
  getProject(id: string) {
    return request<{ project: Project }>(`/api/projects/${id}`);
  },
  async listEntries(projectId: string) {
    const res = await request<{ entries: ProgressEntry[] }>(
      `/api/projects/${projectId}/entries`,
    );
    const token = getToken();
    return {
      entries: res.entries.map((entry) => ({
        ...entry,
        attachments: entry.attachments.map((a) => ({
          ...a,
          url: absoluteAttachmentUrl(
            token ? `${a.url}${a.url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : a.url,
          ),
        })),
      })),
    };
  },
  createEntry(
    projectId: string,
    contentJson: unknown,
    contentHtml: string,
  ) {
    return request<{ entry: ProgressEntry }>(
      `/api/projects/${projectId}/entries`,
      {
        method: "POST",
        body: JSON.stringify({ contentJson, contentHtml }),
      },
    );
  },
  updateEntry(id: string, contentJson: unknown, contentHtml: string) {
    return request<{ entry: ProgressEntry }>(`/api/entries/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ contentJson, contentHtml }),
    });
  },
  deleteEntry(id: string) {
    return request<{ ok: boolean }>(`/api/entries/${id}`, {
      method: "DELETE",
    });
  },
  async uploadAttachment(entryId: string, file: File) {
    const form = new FormData();
    form.append("file", file);
    const res = await request<{ attachment: Attachment }>(
      `/api/entries/${entryId}/attachments`,
      { method: "POST", body: form },
    );
    return {
      attachment: {
        ...res.attachment,
        url: absoluteAttachmentUrl(res.attachment.url),
      },
    };
  },
  resolveAttachmentUrl(url: string) {
    return absoluteAttachmentUrl(url);
  },
  exportUrl(projectId: string, format: "md" | "docx" | "pdf") {
    return `${API_BASE}/api/projects/${projectId}/export/${format}`;
  },
  async downloadExport(projectId: string, format: "md" | "docx" | "pdf") {
    const token = getToken();
    const res = await fetch(api.exportUrl(projectId, format), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      throw new Error("导出失败");
    }
    const blob = await res.blob();
    const disposition = res.headers.get("content-disposition") || "";
    const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
    const filename = match
      ? decodeURIComponent(match[1])
      : `export.${format}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};
