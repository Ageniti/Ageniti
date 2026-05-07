import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeAttribution } from "../runtime/attribution.js";

export function createGuideDoc(options) {
  const context = normalizeContext(options);
  const lines = [
    `# ${context.appName} Guide`,
    "",
    "## Overview",
    context.summary,
    "",
  ];

  if (context.audience) {
    lines.push("## Intended User");
    lines.push(context.audience);
    lines.push("");
  }

  if (context.whenToUse.length > 0) {
    lines.push("## When To Use");
    for (const item of context.whenToUse) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  if (context.setup.length > 0) {
    lines.push("## Setup");
    for (const [index, item] of context.setup.entries()) {
      lines.push(`${index + 1}. ${item}`);
    }
    lines.push("");
  }

  if (context.quickStart.length > 0) {
    lines.push("## How To Use");
    for (const [index, item] of context.quickStart.entries()) {
      lines.push(`${index + 1}. ${item}`);
    }
    lines.push("");
  }

  if (context.operationalNotes.length > 0) {
    lines.push("## Operational Notes");
    for (const item of context.operationalNotes) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  if (context.attribution) {
    lines.push("## Attribution");
    lines.push(context.attribution.text);
    if (context.attribution.vendor) {
      lines.push(`- Vendor: ${context.attribution.vendor}`);
    }
    if (context.attribution.product) {
      lines.push(`- Product: ${context.attribution.product}`);
    }
    if (context.attribution.licenseNotice) {
      lines.push(`- License notice: ${context.attribution.licenseNotice}`);
    }
    if (context.attribution.url) {
      lines.push(`- URL: ${context.attribution.url}`);
    }
    if (context.attribution.docsUrl) {
      lines.push(`- Docs: ${context.attribution.docsUrl}`);
    }
    lines.push("");
  }

  lines.push("## Available Actions");
  lines.push("");
  for (const action of context.actions) {
    lines.push(`### ${action.title}`);
    lines.push(`- Action name: \`${action.name}\``);
    lines.push(`- Description: ${action.description}`);
    lines.push(`- Side effects: \`${action.sideEffects}\``);
    lines.push(`- Visibility: \`${action.visibility}\``);
    if (action.permissions.length > 0) {
      lines.push(`- Permissions: ${action.permissions.map((value) => `\`${value}\``).join(", ")}`);
    }
    if (action.supportedSurfaces.length > 0) {
      lines.push(`- Supported surfaces: ${action.supportedSurfaces.map((value) => `\`${value}\``).join(", ")}`);
    }
    if (action.docs.whenToUse) {
      lines.push(`- Best for: ${action.docs.whenToUse}`);
    }
    if (action.docs.whenNotToUse) {
      lines.push(`- Avoid when: ${action.docs.whenNotToUse}`);
    }
    for (const note of action.docs.usageNotes) {
      lines.push(`- Note: ${note}`);
    }
    if (action.publicMetadata && Object.keys(action.publicMetadata).length > 0) {
      lines.push("- Public metadata:");
      lines.push("```json");
      lines.push(JSON.stringify(action.publicMetadata, null, 2));
      lines.push("```");
    }
    if (action.docs.inputExample !== undefined) {
      lines.push("- Example input:");
      lines.push("```json");
      lines.push(JSON.stringify(action.docs.inputExample, null, 2));
      lines.push("```");
    }
    if (action.docs.outputExample !== undefined) {
      lines.push("- Example output:");
      lines.push("```json");
      lines.push(JSON.stringify(action.docs.outputExample, null, 2));
      lines.push("```");
    }
    lines.push("");
  }

  if (context.examples.length > 0) {
    lines.push("## Usage Examples");
    lines.push("");
    for (const example of context.examples) {
      lines.push(`### ${example.title}`);
      if (example.description) {
        lines.push(example.description);
      }
      if (example.action) {
        lines.push(`- Action: \`${example.action}\``);
      }
      if (example.input !== undefined) {
        lines.push("```json");
        lines.push(JSON.stringify(example.input, null, 2));
        lines.push("```");
      }
      lines.push("");
    }
  }

  if (context.additionalSections.length > 0) {
    for (const section of context.additionalSections) {
      lines.push(`## ${section.title}`);
      lines.push(section.content);
      lines.push("");
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

export async function exportDocs(options) {
  const outDir = path.resolve(options.cwd ?? process.cwd(), options.outDir ?? path.join("dist", "ageniti"));
  const files = [];

  await mkdir(outDir, { recursive: true });

  const guidePath = path.join(outDir, options.filename ?? "GUIDE.md");
  await writeFile(guidePath, createGuideDoc(options));
  files.push({ kind: "guide-doc", path: guidePath });

  return {
    ok: true,
    outDir,
    files,
  };
}

function normalizeContext(options) {
  const docs = options.docs ?? {};
  const appDescription = options.appDescription ?? docs.summary ?? `${options.appName} exposes application capabilities to external tools, automation systems, and agent callers.`;

  return {
    appName: options.appName,
    attribution: normalizeAttribution(options.attribution),
    summary: docs.summary ?? appDescription,
    audience: docs.audience ?? "",
    whenToUse: docs.whenToUse ?? [],
    quickStart: docs.quickStart ?? defaultQuickStart(options),
    setup: docs.setup ?? [],
    operationalNotes: docs.operationalNotes ?? [],
    additionalSections: docs.sections ?? [],
    examples: docs.examples ?? [],
    actions: (options.actions ?? []).map((action) => ({
      ...action,
      docs: {
        whenToUse: action.docs?.whenToUse ?? "",
        whenNotToUse: action.docs?.whenNotToUse ?? "",
        usageNotes: action.docs?.usageNotes ?? [],
        inputExample: action.docs?.inputExample,
        outputExample: action.docs?.outputExample,
      },
    })),
  };
}

function defaultQuickStart(options) {
  return [
    `Review the available actions exposed by ${options.appName}.`,
    "Choose the action that best matches the requested capability.",
    "Provide structured input that matches the action schema.",
    "Inspect the structured result envelope, logs, and artifacts.",
  ];
}
