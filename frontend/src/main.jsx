import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import "./fonts.css";
import "./styles.css";
import "./chat-type.css";
import "./welcome.css";
import "./radius.css";

// After a deploy, an open tab still points at chunk files that no longer exist: reload once to pick up the new version.
window.addEventListener("vite:preloadError", (e) => {
  try {
    if (sessionStorage.getItem("chunk-reload") === String(Math.floor(Date.now() / 60000))) return; // already tried this minute: let the error boundary show
    sessionStorage.setItem("chunk-reload", String(Math.floor(Date.now() / 60000)));
  } catch { /* storage blocked: fall through to the boundary */ return; }
  e.preventDefault();
  location.reload();
});

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
