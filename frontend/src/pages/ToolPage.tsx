import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { createJob, resolveUrl, uploadFile, waitForJob } from "../api";
import { readPdf } from "../pdfPreview";
import { findTool, type Tool } from "../tools";

const MAX_BYTES = 20 * 1024 * 1024;

interface LocalFile {
  key: string;
  file: File;
}

interface PageCard {
  key: string;
  index: number;
  rotation: number;
  thumb: string;
}

type Phase = "idle" | "working" | "done" | "error";
type Step = 0 | 1 | 2 | 3 | 4;

export function ToolPage() {
  const { toolId } = useParams();
  const tool = findTool(toolId);
  if (!tool) return <Navigate to="/" replace />;
  return <Workspace key={tool.id} tool={tool} />;
}

function Workspace({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [direction, setDirection] = useState<"pdf_to_images" | "images_to_pdf">("pdf_to_images");
  const [imageFormat, setImageFormat] = useState<"png" | "jpeg">("png");
  const [splitMode, setSplitMode] = useState<"range" | "each">("range");
  const [pageSpec, setPageSpec] = useState("1");
  const [quality, setQuality] = useState<"low" | "medium" | "high">("medium");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pages, setPages] = useState<PageCard[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [step, setStep] = useState<Step>(0);
  const [message, setMessage] = useState("Add a file to begin.");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [downloadName, setDownloadName] = useState("result");

  const imageMode = tool.id === "convert" && direction === "images_to_pdf";
  const multiple = tool.id === "merge" || imageMode;
  const accept = imageMode ? "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" : "application/pdf,.pdf";
  const maxFiles = tool.id === "merge" ? 10 : imageMode ? 20 : 1;

  useEffect(() => {
    const file = files[0]?.file;
    if (!file || imageMode || (tool.id !== "organize" && tool.id !== "split")) {
      setPages([]);
      setPageCount(0);
      return;
    }
    let cancelled = false;
    readPdf(file, tool.id === "organize")
      .then((preview) => {
        if (cancelled) return;
        setPageCount(preview.pageCount);
        setPages(
          preview.thumbs.map((thumb, index) => ({
            key: `${file.name}-${file.size}-${index}`,
            index,
            rotation: 0,
            thumb,
          })),
        );
        if (preview.pageCount > 40) {
          setPhase("error");
          setMessage("This PDF has more than 40 pages. Split it first, then try again.");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPageCount(0);
          setPages([]);
          setMessage("The preview could not be drawn. You can still run the job if the file is a valid PDF.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [files, imageMode, tool.id]);

  const stepLabels = useMemo(
    () => ["Create the job", "Upload to storage", "Worker runs the file", "Download the result"],
    [],
  );

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    if (incoming.length === 0) return;
    const next = multiple ? [...files] : [];
    let notice = "";
    for (const file of incoming) {
      if (next.length >= maxFiles) {
        notice = `This tool accepts up to ${maxFiles} file${maxFiles === 1 ? "" : "s"}.`;
        break;
      }
      const contentType = contentTypeOf(file);
      if (!isAccepted(contentType, imageMode)) {
        notice = imageMode ? "Use PNG, JPEG, or WebP images." : "Use a PDF file.";
        continue;
      }
      if (file.size > MAX_BYTES) {
        notice = "Each file must be 20 MB or smaller.";
        continue;
      }
      next.push({ key: crypto.randomUUID(), file });
    }
    setFiles(next);
    setPhase("idle");
    setStep(0);
    setDownloadUrl("");
    setMessage(notice || (next.length ? "Ready when you are." : "Add a file to begin."));
  }

  function moveFile(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= files.length) return;
    const next = [...files];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    setFiles(next);
  }

  async function onSubmit() {
    const problem = validate(tool, files, {
      imageMode,
      splitMode,
      pageSpec,
      password,
      confirmPassword,
      pages,
      pageCount,
    });
    if (problem) {
      setPhase("error");
      setMessage(problem);
      return;
    }

    const operation = tool.id === "convert" ? direction : tool.id;
    const options = buildOptions(tool, {
      direction,
      imageFormat,
      splitMode,
      pageSpec,
      quality,
      password,
      pages,
    });
    setPhase("working");
    setStep(1);
    setDownloadUrl("");
    setMessage("Creating the job.");

    try {
      const created = await createJob({
        operation,
        files: files.map((item) => ({
          name: item.file.name,
          contentType: contentTypeOf(item.file),
        })),
        options,
      });
      setStep(2);
      setMessage("Uploading files directly to storage.");
      await Promise.all(created.uploads.map((instruction, index) => uploadFile(instruction, files[index].file)));
      setStep(3);
      setMessage("Waiting for the worker. The queue starts it after the upload event.");
      const job = await waitForJob(created.jobId);
      if (job.status === "FAILED" || !job.downloadUrl) {
        throw new Error(job.error || "Processing failed");
      }
      setDownloadUrl(resolveUrl(job.downloadUrl));
      setDownloadName(job.fileName || "result");
      setStep(4);
      setPhase("done");
      setMessage("The file is ready.");
    } catch (error) {
      setPhase("error");
      setMessage(error instanceof Error ? error.message : "The job failed.");
    }
  }

  return (
    <main>
      <section className="tool-hero">
        <Link to="/" className="back">
          ← All PDF tools
        </Link>
        <div className="tool-badge" style={{ background: tool.accent }} aria-hidden="true">
          {tool.icon}
        </div>
        <h1>{tool.name}</h1>
        <p>{tool.detail}</p>
      </section>

      <div className="workspace">
        <div className="panel">
          <label
            className={dragging ? "dropzone dragging" : "dropzone"}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              addFiles(event.dataTransfer.files);
            }}
          >
            <input
              type="file"
              accept={accept}
              multiple={multiple}
              onChange={(event) => {
                if (event.target.files) addFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <span className="select-btn">{imageMode ? "Select image files" : "Select PDF file"}</span>
            <strong>or drop {multiple ? "files" : "a PDF"} here</strong>
            <span>{maxFiles === 1 ? "One file, up to 20 MB." : `Up to ${maxFiles} files, 20 MB each.`}</span>
          </label>

          {files.length > 0 && (
            <ol className="file-list">
              {files.map((item, index) => (
                <li key={item.key}>
                  <span>
                    <strong>{item.file.name}</strong>
                    <small>{formatBytes(item.file.size)}</small>
                  </span>
                  <span className="file-actions">
                    {multiple && (
                      <>
                        <button type="button" onClick={() => moveFile(index, -1)} disabled={index === 0}>
                          Up
                        </button>
                        <button type="button" onClick={() => moveFile(index, 1)} disabled={index === files.length - 1}>
                          Down
                        </button>
                      </>
                    )}
                    <button type="button" onClick={() => setFiles(files.filter((entry) => entry.key !== item.key))}>
                      Remove
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          )}

          <Options
            tool={tool}
            direction={direction}
            setDirection={(value) => {
              setDirection(value);
              setFiles([]);
              setPages([]);
              setPageCount(0);
              setPhase("idle");
              setMessage("Add a file to begin.");
            }}
            imageFormat={imageFormat}
            setImageFormat={setImageFormat}
            splitMode={splitMode}
            setSplitMode={setSplitMode}
            pageSpec={pageSpec}
            setPageSpec={setPageSpec}
            pageCount={pageCount}
            quality={quality}
            setQuality={setQuality}
            password={password}
            setPassword={setPassword}
            confirmPassword={confirmPassword}
            setConfirmPassword={setConfirmPassword}
            pages={pages}
            setPages={setPages}
          />

          <button type="button" className="primary" onClick={onSubmit} disabled={phase === "working" || files.length === 0}>
            {phase === "working" ? "Processing…" : `Process ${tool.name}`}
          </button>
        </div>

        <aside className="panel status-panel" aria-live="polite">
          <h2>Job progress</h2>
          <ol className="steps">
            {stepLabels.map((label, index) => (
              <li key={label} className={step === index + 1 ? "active" : step > index + 1 ? "complete" : ""}>
                {label}
              </li>
            ))}
          </ol>
          <p className={phase === "error" ? "message error" : "message"}>{message}</p>
          {downloadUrl && (
            <a className="primary download" href={downloadUrl}>
              Download {downloadName}
            </a>
          )}
        </aside>
      </div>
    </main>
  );
}

function Options(props: {
  tool: Tool;
  direction: "pdf_to_images" | "images_to_pdf";
  setDirection: (value: "pdf_to_images" | "images_to_pdf") => void;
  imageFormat: "png" | "jpeg";
  setImageFormat: (value: "png" | "jpeg") => void;
  splitMode: "range" | "each";
  setSplitMode: (value: "range" | "each") => void;
  pageSpec: string;
  setPageSpec: (value: string) => void;
  pageCount: number;
  quality: "low" | "medium" | "high";
  setQuality: (value: "low" | "medium" | "high") => void;
  password: string;
  setPassword: (value: string) => void;
  confirmPassword: string;
  setConfirmPassword: (value: string) => void;
  pages: PageCard[];
  setPages: (pages: PageCard[]) => void;
}) {
  const { tool } = props;
  if (tool.id === "convert") {
    return (
      <fieldset>
        <legend>Conversion</legend>
        <label className="choice">
          <input
            type="radio"
            name="direction"
            checked={props.direction === "pdf_to_images"}
            onChange={() => props.setDirection("pdf_to_images")}
          />
          PDF pages to images
        </label>
        <label className="choice">
          <input
            type="radio"
            name="direction"
            checked={props.direction === "images_to_pdf"}
            onChange={() => props.setDirection("images_to_pdf")}
          />
          Images to one PDF
        </label>
        {props.direction === "pdf_to_images" && (
          <label className="field">
            Image format
            <select value={props.imageFormat} onChange={(event) => props.setImageFormat(event.target.value as "png" | "jpeg")}>
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
            </select>
          </label>
        )}
      </fieldset>
    );
  }

  if (tool.id === "split") {
    return (
      <fieldset>
        <legend>Pages {props.pageCount > 0 ? `(${props.pageCount} in this file)` : ""}</legend>
        <label className="choice">
          <input type="radio" name="split" checked={props.splitMode === "range"} onChange={() => props.setSplitMode("range")} />
          Extract a range
        </label>
        {props.splitMode === "range" && (
          <label className="field">
            Page range
            <input
              value={props.pageSpec}
              onChange={(event) => props.setPageSpec(event.target.value)}
              placeholder="1-3,5"
            />
          </label>
        )}
        <label className="choice">
          <input type="radio" name="split" checked={props.splitMode === "each"} onChange={() => props.setSplitMode("each")} />
          Every page as its own PDF
        </label>
      </fieldset>
    );
  }

  if (tool.id === "compress") {
    return (
      <fieldset>
        <legend>Image quality</legend>
        {(["high", "medium", "low"] as const).map((level) => (
          <label key={level} className="choice">
            <input type="radio" name="quality" checked={props.quality === level} onChange={() => props.setQuality(level)} />
            {level === "high" ? "High, smaller change" : level === "medium" ? "Medium" : "Low, smallest file"}
          </label>
        ))}
      </fieldset>
    );
  }

  if (tool.id === "protect") {
    return (
      <fieldset>
        <legend>Password</legend>
        <label className="field">
          Open password
          <input
            type="password"
            autoComplete="new-password"
            value={props.password}
            onChange={(event) => props.setPassword(event.target.value)}
          />
        </label>
        <label className="field">
          Confirm password
          <input
            type="password"
            autoComplete="new-password"
            value={props.confirmPassword}
            onChange={(event) => props.setConfirmPassword(event.target.value)}
          />
        </label>
      </fieldset>
    );
  }

  if (tool.id === "organize") {
    return (
      <fieldset>
        <legend>Page order</legend>
        {props.pages.length === 0 ? (
          <p className="hint">Add a PDF to preview its pages.</p>
        ) : (
          <ol className="page-grid">
            {props.pages.map((page, position) => (
              <li key={page.key}>
                <img src={page.thumb} alt={`Page ${page.index + 1}`} style={{ transform: `rotate(${page.rotation}deg)` }} />
                <span>Page {page.index + 1}</span>
                <span className="file-actions">
                  <button type="button" onClick={() => props.setPages(movePage(props.pages, position, -1))} disabled={position === 0}>
                    Up
                  </button>
                  <button
                    type="button"
                    onClick={() => props.setPages(movePage(props.pages, position, 1))}
                    disabled={position === props.pages.length - 1}
                  >
                    Down
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      props.setPages(
                        props.pages.map((item) =>
                          item.key === page.key ? { ...item, rotation: (item.rotation + 90) % 360 } : item,
                        ),
                      )
                    }
                  >
                    Rotate
                  </button>
                  <button type="button" onClick={() => props.setPages(props.pages.filter((item) => item.key !== page.key))}>
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ol>
        )}
      </fieldset>
    );
  }

  return <p className="hint">Use Up and Down to set the order. That becomes the page order in the finished PDF.</p>;
}

function movePage(pages: PageCard[], index: number, delta: number): PageCard[] {
  const target = index + delta;
  if (target < 0 || target >= pages.length) return pages;
  const next = [...pages];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

function buildOptions(
  tool: Tool,
  input: {
    direction: "pdf_to_images" | "images_to_pdf";
    imageFormat: "png" | "jpeg";
    splitMode: "range" | "each";
    pageSpec: string;
    quality: "low" | "medium" | "high";
    password: string;
    pages: PageCard[];
  },
): Record<string, unknown> {
  if (tool.id === "convert" && input.direction === "pdf_to_images") return { format: input.imageFormat };
  if (tool.id === "split") return { mode: input.splitMode, pages: input.pageSpec };
  if (tool.id === "compress") return { quality: input.quality };
  if (tool.id === "protect") return { password: input.password };
  if (tool.id === "organize") {
    return { pages: input.pages.map((page) => ({ index: page.index, rotation: page.rotation })) };
  }
  return {};
}

function validate(
  tool: Tool,
  files: LocalFile[],
  input: {
    imageMode: boolean;
    splitMode: "range" | "each";
    pageSpec: string;
    password: string;
    confirmPassword: string;
    pages: PageCard[];
    pageCount: number;
  },
): string {
  if (tool.id === "merge" && files.length < 2) return "Add at least two PDFs.";
  if (files.length === 0) return "Add a file to begin.";
  if (input.pageCount > 40) return "This PDF has more than 40 pages.";
  if (tool.id === "split" && input.splitMode === "range" && !input.pageSpec.trim()) {
    return "Enter a page range such as 1-3,5.";
  }
  if (tool.id === "protect") {
    if (!input.password) return "Enter a password.";
    if (input.password !== input.confirmPassword) return "The passwords do not match.";
  }
  if (tool.id === "organize" && input.pages.length === 0) return "Keep at least one page.";
  return "";
}

function contentTypeOf(file: File): string {
  const raw = file.type.toLowerCase().split(";")[0].trim();
  if (raw === "image/jpg") return "image/jpeg";
  if (raw) return raw;
  const extension = file.name.split(".").pop()?.toLowerCase();
  const mapped: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
  };
  return extension ? mapped[extension] || "" : "";
}

function isAccepted(contentType: string, imageMode: boolean): boolean {
  if (imageMode) return ["image/png", "image/jpeg", "image/webp"].includes(contentType);
  return contentType === "application/pdf";
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
