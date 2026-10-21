import { lazy, Suspense } from "react";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { Home } from "./pages/Home";

const ToolPage = lazy(() => import("./pages/ToolPage").then((module) => ({ default: module.ToolPage })));

export function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <header className="topbar">
          <div className="topbar-inner">
            <Link to="/" className="brand">
              <span className="brand-mark" aria-hidden="true">
                ❤
              </span>
              <span className="brand-text">
                cloud<span>PDF</span>
              </span>
            </Link>
            <nav className="top-nav" aria-label="Primary">
              <Link to="/">Tools</Link>
              <Link to="/#how-it-works">How it works</Link>
              <span className="nav-pill">AWS serverless</span>
            </nav>
          </div>
        </header>

        <Suspense
          fallback={
            <main className="page">
              <p className="loading">Loading the tool…</p>
            </main>
          }
        >
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/tools/:toolId" element={<ToolPage />} />
          </Routes>
        </Suspense>

        <footer className="site-footer">
          <div className="footer-inner">
            <div>
              <strong className="brand-text">
                cloud<span>PDF</span>
              </strong>
              <p>Serverless cloud-based PDF processing platform</p>
            </div>
            <p className="footer-note">Files stay in private storage and expire after one day.</p>
          </div>
        </footer>
      </div>
    </BrowserRouter>
  );
}
