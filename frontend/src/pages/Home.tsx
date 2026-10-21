import { Link } from "react-router-dom";
import { TOOLS } from "../tools";

const FLOW = [
  { title: "Choose a tool", text: "Pick merge, split, compress, convert, organize, or protect." },
  { title: "Upload to the cloud", text: "Your browser sends files straight to private S3 storage." },
  { title: "Process on demand", text: "SQS wakes a Lambda worker only when every file is ready." },
  { title: "Download the result", text: "Poll the API and fetch a short-lived download link." },
];

export function Home() {
  return (
    <main>
      <section className="hero">
        <p className="eyebrow">Serverless cloud-based PDF processing platform</p>
        <h1>Every tool you need to work with PDFs, powered by AWS.</h1>
        <p className="lede">
          Merge, split, compress, convert, rotate, organize and protect PDFs with a few clicks. cloudPDF runs on
          scalable, event-driven cloud infrastructure — no server left running between jobs.
        </p>
      </section>

      <section className="tool-grid" aria-label="PDF tools">
        {TOOLS.map((tool) => (
          <Link key={tool.id} to={`/tools/${tool.id}`} className="tool-card">
            <span className="tool-icon" style={{ background: tool.accent }} aria-hidden="true">
              {tool.icon}
            </span>
            <h2>{tool.name}</h2>
            <p>{tool.summary}</p>
          </Link>
        ))}
      </section>

      <section className="trust-band">
        <div>
          <strong>Private by design</strong>
          <p>Uploads and results live in locked S3 buckets with short-lived links.</p>
        </div>
        <div>
          <strong>Event-driven</strong>
          <p>API Gateway, SQS and Lambda scale to zero when idle.</p>
        </div>
        <div>
          <strong>Course-ready limits</strong>
          <p>20 MB per file, 40 pages, results deleted after one day.</p>
        </div>
      </section>

      <section className="how" id="how-it-works">
        <h2>How cloudPDF works</h2>
        <ol>
          {FLOW.map((step, index) => (
            <li key={step.title}>
              <span className="step-num">{index + 1}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
