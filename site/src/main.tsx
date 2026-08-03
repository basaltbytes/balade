import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Landing } from "./Landing";
import "./site.css";

const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <Landing />
    </StrictMode>,
  );
}
