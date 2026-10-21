export interface UploadInstruction {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
}

export interface CreatedJob {
  jobId: string;
  status: string;
  uploads: UploadInstruction[];
}

export interface JobView {
  jobId: string;
  operation: string;
  status: "UPLOADING" | "PROCESSING" | "DONE" | "FAILED" | string;
  error: string | null;
  fileName: string | null;
  downloadUrl: string | null;
}

const base = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

export function resolveUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return `${base}${url}`;
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: T & { error?: string } = {} as T & { error?: string };
  if (text) {
    try {
      payload = JSON.parse(text) as T & { error?: string };
    } catch {
      if (!response.ok) {
        throw new Error(
          response.status === 500
            ? "API is not reachable. Start the local server with make api, or set VITE_API_URL to the AWS API."
            : `Request failed (${response.status})`,
        );
      }
      throw new Error("The API returned an unexpected response.");
    }
  }
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

export async function createJob(body: {
  operation: string;
  files: { name: string; contentType: string }[];
  options?: Record<string, unknown>;
}): Promise<CreatedJob> {
  const response = await fetch(`${base}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJson<CreatedJob>(response);
}

export async function uploadFile(instruction: UploadInstruction, file: File): Promise<void> {
  const response = await fetch(resolveUrl(instruction.url), {
    method: instruction.method,
    headers: instruction.headers,
    body: file,
  });
  if (!response.ok) {
    let message = `Upload failed (${response.status})`;
    const text = await response.text();
    try {
      const payload = JSON.parse(text) as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      if (text.includes("<Message>")) {
        message = "Storage rejected the upload. Check that the bucket CORS rule allows this site.";
      }
    }
    throw new Error(message);
  }
}

export async function getJob(jobId: string): Promise<JobView> {
  const response = await fetch(`${base}/jobs/${jobId}`);
  return readJson<JobView>(response);
}

export async function waitForJob(jobId: string): Promise<JobView> {
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    const job = await getJob(jobId);
    if (job.status === "DONE" || job.status === "FAILED") {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("The job took too long. Try a smaller file, then check the worker logs.");
}
