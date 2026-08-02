import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

/* The diff view's own stylesheet first, so the theme's variable overrides win. */
import "@git-diff-view/react/styles/diff-view.css";
import "./theme.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
