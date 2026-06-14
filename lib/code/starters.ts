import type { PreviewKind } from "@/lib/data/types";

export interface StarterFile {
  path: string;
  content: string;
}
export interface Starter {
  id: string;
  name: string;
  language: string;
  previewMode: PreviewKind;
  gradient: [string, string];
  description: string;
  files: StarterFile[];
}

// Starters are minimal, runnable scaffolds — a real, working starting point
// (like create-react-app's default page), NOT demo content. New projects open
// to a visible "your new project" page so the preview works immediately and the
// build agent edits a live app instead of generating everything from scratch.

const HTML_INDEX = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New Project</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <main class="hero">
    <h1>Your new project</h1>
    <p>Edit the files, or describe what to build in the Build dock.</p>
  </main>
  <script src="script.js"></script>
</body>
</html>
`;

const HTML_STYLE = `* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  background: #0f1117;
  color: #e8eaf0;
}
.hero { text-align: center; padding: 2rem; }
.hero h1 { font-size: 2.4rem; margin: 0 0 0.5rem; letter-spacing: -0.02em; }
.hero p { color: #9aa1b2; margin: 0; }
`;

const HTML_SCRIPT = `// Your JavaScript runs here.
console.log("Project ready.");
`;

const REACT_INDEX = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New Project</title>
</head>
<body>
  <div id="root"></div>
</body>
</html>
`;

const REACT_MAIN = `import { createRoot } from "react-dom/client";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(<App />);
`;

const REACT_APP = `export default function App() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        background: "#0f1117",
        color: "#e8eaf0",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h1 style={{ margin: "0 0 0.5rem", letterSpacing: "-0.02em" }}>Your new React app</h1>
        <p style={{ color: "#9aa1b2", margin: 0 }}>Edit src/App.jsx, or describe what to build.</p>
      </div>
    </main>
  );
}
`;

const VUE_INDEX = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New Project</title>
</head>
<body>
  <div id="app"></div>
</body>
</html>
`;

const VUE_MAIN = `import { createApp, h } from "vue";

createApp({
  render() {
    return h(
      "main",
      { style: "min-height:100vh;display:grid;place-items:center;font-family:system-ui,-apple-system,sans-serif;background:#0f1117;color:#e8eaf0" },
      [
        h("div", { style: "text-align:center" }, [
          h("h1", { style: "margin:0 0 .5rem;letter-spacing:-0.02em" }, "Your new Vue app"),
          h("p", { style: "color:#9aa1b2;margin:0" }, "Edit src/main.js, or describe what to build."),
        ]),
      ]
    );
  },
}).mount("#app");
`;

export const STARTERS: Starter[] = [
  {
    id: "blank",
    name: "Blank",
    language: "Text",
    previewMode: "none",
    gradient: ["#6e6353", "#2a2118"],
    description: "An empty project.",
    files: [{ path: "README.md", content: "" }],
  },
  {
    id: "html",
    name: "HTML / CSS / JS",
    language: "HTML",
    previewMode: "web",
    gradient: ["#ff7a1a", "#c2470a"],
    description: "A static web page with live preview.",
    files: [
      { path: "index.html", content: HTML_INDEX },
      { path: "style.css", content: HTML_STYLE },
      { path: "script.js", content: HTML_SCRIPT },
    ],
  },
  {
    id: "react",
    name: "React",
    language: "React",
    previewMode: "react",
    gradient: ["#61dafb", "#2d7d9a"],
    description: "A React single-page app, bundled in-browser.",
    files: [
      { path: "index.html", content: REACT_INDEX },
      { path: "src/App.jsx", content: REACT_APP },
      { path: "src/main.jsx", content: REACT_MAIN },
    ],
  },
  {
    id: "vue",
    name: "Vue",
    language: "Vue",
    previewMode: "vue",
    gradient: ["#41b883", "#35495e"],
    description: "A Vue single-page app, bundled in-browser.",
    files: [
      { path: "index.html", content: VUE_INDEX },
      { path: "src/main.js", content: VUE_MAIN },
    ],
  },
  {
    id: "python",
    name: "Python",
    language: "Python",
    previewMode: "none",
    gradient: ["#3572A5", "#ffd43b"],
    description: "A Python script. Run locally or via the sandbox.",
    files: [{ path: "main.py", content: "" }],
  },
];

export function getStarter(id: string): Starter {
  return STARTERS.find((s) => s.id === id) ?? STARTERS[0];
}
