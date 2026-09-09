import "./storage";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { DesktopGate } from "./ui/DesktopGate";
import "./styles.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("missing #root element in index.html");
}

createRoot(rootEl).render(
  <DesktopGate>
    <App />
  </DesktopGate>,
);
