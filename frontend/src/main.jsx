import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import "./fonts.css";
import "./styles.css";
import "./chat-type.css";
import "./welcome.css";
import "./radius.css";
import "./page-style.css";

// A lazy chunk that fails to load is either gone (a deploy removed it) or, more often, a bad copy sitting in the browser cache:
// /assets/** is cached for a year, so an HTML page that a CDN edge answered with during a deploy sticks. Re-fetch the file bypassing
// the cache (that overwrites the bad entry), then reload once. The error boundary shows the message if it still fails.
window.addEventListener("vite:preloadError", (e) => {
  const key = String(Math.floor(Date.now() / 60000));
  try {
    if (sessionStorage.getItem("chunk-reload") === key) return; // already tried this minute: let the error boundary show
    sessionStorage.setItem("chunk-reload", key);
  } catch { return; } // storage blocked: fall through to the boundary
  e.preventDefault();
  const url = (String(e.payload?.message || "").match(/\/assets\/[^\s"')]+/) || [])[0];
  const done = () => location.reload();
  if (url) fetch(url, { cache: "reload" }).then(done, done);
  else done();
});

// /share/:id is a read-only page of its own (a shared, de-identified conversation); everything else is the app.
const SharePage = lazy(() => import("./SharePage.jsx"));
const shareId = (location.pathname.match(/^\/share\/([\w-]{6,64})\/?$/) || [])[1];

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      {shareId ? <Suspense fallback={null}><SharePage id={shareId} /></Suspense> : <App />}
    </ErrorBoundary>
  </React.StrictMode>,
);
