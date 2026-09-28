import "./storage";
import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { DesktopGate } from "./ui/DesktopGate";
import "./styles.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("missing #root element in index.html");
}

const EDITOR_HASH = "#editor";
const MapEditor = import.meta.env.DEV ? lazy(() => import("./editor/EditorRoot")) : null;

createRoot(rootEl).render(
  MapEditor && window.location.hash.startsWith(EDITOR_HASH) ? (
    <Suspense fallback={null}>
      <MapEditor />
    </Suspense>
  ) : (
    <DesktopGate>
      <App />
    </DesktopGate>
  ),
);
