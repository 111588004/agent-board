import { createRoot } from "react-dom/client";
import AgentBoard from "./App.jsx";
import Guide from "./Guide.jsx";

const page = new URLSearchParams(window.location.search).has("guide") ? <Guide /> : <AgentBoard />;
createRoot(document.getElementById("root")).render(page);
