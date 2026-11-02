import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import "./fonts.css";
import "./styles.css";
import "./chat-type.css";
import "./welcome.css";
import "./radius.css";

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

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
