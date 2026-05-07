import http from "node:http";
import { createActionManifest } from "./runtime/manifest.js";
import { parseRequestBody, sendJson, sendText } from "./transports/http.js";

export function createDevServer(options) {
  const name = options.name ?? "Ageniti";
  const runtime = options.runtime;

  if (!runtime) {
    throw new TypeError("createDevServer() requires a runtime.");
  }

  const actions = options.actions ?? Array.from(runtime.registry.values());

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");

      if (request.method === "GET" && url.pathname === "/") {
        sendText(response, renderDevConsole({ name }), "text/html; charset=utf-8");
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/actions") {
        sendJson(response, {
          app: name,
          actions: createActionManifest(actions, { surface: "dev", includePrivate: true, includeLocal: true }),
        });
        return;
      }

      if (request.method === "POST" && url.pathname.startsWith("/api/actions/") && url.pathname.endsWith("/invoke")) {
        const actionName = decodeURIComponent(url.pathname.split("/")[3]);
        const body = await parseRequestBody(request);
        // Preserve `null` and other primitive root inputs.
        const rawInput = body && typeof body === "object" && "input" in body ? body.input : {};
        const result = await runtime.invoke(actionName, rawInput, {
          surface: "dev",
          confirm: body.confirm === true,
          user: body.user,
          auth: body.auth,
          metadata: body.metadata,
        });
        sendJson(response, result, result.ok ? 200 : 400);
        return;
      }

      sendJson(response, { ok: false, error: { code: "NOT_FOUND", message: "Route not found." } }, 404);
    } catch (error) {
      sendJson(response, {
        ok: false,
        error: {
          code: "DEV_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Unknown dev server error.",
        },
      }, 500);
    }
  });

  return {
    server,
    listen(port = 4321, host = "127.0.0.1") {
      return new Promise((resolve, reject) => {
        const onError = (error) => {
          reject(error);
        };
        server.once("error", onError);
        server.listen(port, host, () => {
          server.off("error", onError);
          const address = server.address();
          const resolvedPort = typeof address === "object" && address ? address.port : port;
          resolve({
            port: resolvedPort,
            host,
            url: `http://${host}:${resolvedPort}`,
            close: () => new Promise((closeResolve) => server.close(closeResolve)),
          });
        });
      });
    },
  };
}

function renderDevConsole({ name }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(name)} Dev Console</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f4ed;
      --panel: #ffffff;
      --ink: #1b1b1d;
      --muted: #696761;
      --line: #ded8cc;
      --accent: #0f766e;
      --accent-ink: #ffffff;
      --danger: #b42318;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--ink); }
    header { padding: 24px 28px 16px; border-bottom: 1px solid var(--line); }
    h1 { margin: 0; font-size: 22px; letter-spacing: 0; }
    main { display: grid; grid-template-columns: 320px minmax(0, 1fr); min-height: calc(100vh - 73px); }
    nav { border-right: 1px solid var(--line); padding: 16px; overflow: auto; }
    section { padding: 20px; min-width: 0; }
    button { border: 1px solid var(--line); background: var(--panel); color: var(--ink); border-radius: 6px; padding: 8px 10px; cursor: pointer; font: inherit; }
    button.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
    button.action { display: block; width: 100%; text-align: left; margin-bottom: 8px; }
    button.action.active { border-color: var(--accent); box-shadow: inset 3px 0 0 var(--accent); }
    label { display: block; margin: 14px 0 6px; color: var(--muted); font-size: 13px; }
    input, textarea { width: 100%; border: 1px solid var(--line); border-radius: 6px; padding: 9px; font: inherit; background: var(--panel); color: var(--ink); }
    textarea { min-height: 160px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    pre { overflow: auto; background: #211f1a; color: #f7f4ed; padding: 14px; border-radius: 6px; min-height: 180px; }
    .muted { color: var(--muted); }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .toolbar { display: flex; gap: 8px; align-items: center; margin: 12px 0; }
    .pill { display: inline-block; font-size: 12px; padding: 3px 7px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); margin-right: 6px; }
    @media (max-width: 820px) { main { grid-template-columns: 1fr; } nav { border-right: 0; border-bottom: 1px solid var(--line); } .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(name)} Dev Console</h1>
    <div class="muted">Inspect schemas, run actions, and view structured results.</div>
  </header>
  <main>
    <nav>
      <div class="muted">Actions</div>
      <div id="actions"></div>
    </nav>
    <section>
      <h2 id="title">Select an action</h2>
      <p id="description" class="muted"></p>
      <div id="meta"></div>
      <div class="grid">
        <div>
          <label for="input">Input JSON</label>
          <textarea id="input">{}</textarea>
          <div class="toolbar">
            <button class="primary" id="run">Run</button>
            <button id="format">Format JSON</button>
          </div>
          <label for="schema">Input Schema</label>
          <pre id="schema"></pre>
        </div>
        <div>
          <label for="result">Result</label>
          <pre id="result"></pre>
        </div>
      </div>
    </section>
  </main>
  <script>
    let actions = [];
    let selected = null;
    const $ = (id) => document.getElementById(id);

    async function load() {
      const response = await fetch("/api/actions");
      const payload = await response.json();
      actions = payload.actions;
      renderActions();
      if (actions[0]) selectAction(actions[0].name);
    }

    function renderActions() {
      $("actions").innerHTML = actions.map((action) =>
        '<button class="action" data-name="' + action.name + '">' +
        '<strong>' + action.name + '</strong><br><span class="muted">' + escapeHtml(action.description) + '</span></button>'
      ).join("");
      document.querySelectorAll("button.action").forEach((button) => {
        button.addEventListener("click", () => selectAction(button.dataset.name));
      });
    }

    function selectAction(name) {
      selected = actions.find((action) => action.name === name);
      document.querySelectorAll("button.action").forEach((button) => button.classList.toggle("active", button.dataset.name === name));
      $("title").textContent = selected.title + " (" + selected.name + ")";
      $("description").textContent = selected.description;
      $("meta").innerHTML = [
        selected.visibility,
        selected.sideEffects,
        selected.idempotency
      ].map((value) => '<span class="pill">' + value + '</span>').join("");
      $("schema").textContent = JSON.stringify(selected.inputSchema, null, 2);
      $("input").value = JSON.stringify(exampleInput(selected.inputSchema), null, 2);
      $("result").textContent = "";
    }

    $("run").addEventListener("click", async () => {
      if (!selected) return;
      try {
        const input = JSON.parse($("input").value);
        const response = await fetch("/api/actions/" + encodeURIComponent(selected.name) + "/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input, confirm: true })
        });
        $("result").textContent = JSON.stringify(await response.json(), null, 2);
      } catch (error) {
        $("result").textContent = String(error.message || error);
      }
    });

    $("format").addEventListener("click", () => {
      $("input").value = JSON.stringify(JSON.parse($("input").value), null, 2);
    });

    function exampleInput(schema) {
      if (!schema || schema.default !== undefined) return schema?.default ?? null;
      if (schema.type === "object") {
        const value = {};
        for (const [key, child] of Object.entries(schema.properties || {})) value[key] = exampleInput(child);
        return value;
      }
      if (schema.type === "array") return [];
      if (schema.type === "number" || schema.type === "integer") return 0;
      if (schema.type === "boolean") return false;
      if (schema.enum) return schema.enum[0];
      return "";
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    }

    load();
  </script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}
