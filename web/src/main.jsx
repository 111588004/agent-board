import { createRoot } from "react-dom/client";
import AgentBoard from "./App.jsx";
import Guide from "./Guide.jsx";
import { applyTheme, readTheme } from "./theme.jsx";

applyTheme(readTheme());

const page = new URLSearchParams(window.location.search).has("guide") ? <Guide /> : <AgentBoard />;
createRoot(document.getElementById("root")).render(page);
