import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./lib/i18n";
import { installApiOriginShim } from "./lib/install-api-origin-shim";

// Vor dem ersten Render einrichten: API-Calls aus Cross-Origin-iframes
// (z. B. Beta-Test-Plattform betahub.returnz.one) auf die richtige API-Origin
// umlenken. No-op, wenn die SPA unter ihrer eigenen Domain läuft.
installApiOriginShim();

createRoot(document.getElementById("root")!).render(<App />);
