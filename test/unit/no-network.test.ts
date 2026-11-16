// Enforces B1 and D3: the tool never calls an AI, never touches the network,
// and ships no dependency with an install script.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");

const FORBIDDEN_MODULES = [
  "http",
  "https",
  "http2",
  "net",
  "tls",
  "dgram",
  "dns",
  "undici",
  "node-fetch",
  "axios",
  "got",
  "ky",
  "openai",
  "@anthropic-ai/sdk",
  "langchain",
  "ai",
  "@google/generative-ai",
  "@google/genai",
  "cohere-ai",
  "@mistralai/mistralai",
  "ollama",
  "posthog-node",
  "@sentry/node",
  "@opentelemetry/api",
];
const FORBIDDEN_PREFIXES = ["@langchain/", "@ai-sdk/", "@opentelemetry/"];

function isForbidden(spec: string): boolean {
  const bare = spec.startsWith("node:") ? spec.slice(5) : spec;
  // Normalise "pkg/sub" and "@scope/pkg/sub" to the package name.
  const parts = bare.split("/");
  const pkg = bare.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? "");
  return FORBIDDEN_MODULES.includes(pkg) || FORBIDDEN_PREFIXES.some((p) => bare.startsWith(p));
}

function listTs(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return listTs(p);
    return /\.(ts|mts|cts|js|mjs)$/.test(name) ? [p] : [];
  });
}

const IMPORT_RE =
  /(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\s*\(\s*["']([^"']+)["']\s*\)|import\s*["']([^"']+)["']/g;

describe("no network, no AI (B1, D3)", () => {
  it("src/ imports no network module, AI SDK or telemetry package", () => {
    const hits: string[] = [];
    for (const file of listTs(join(root, "src"))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(IMPORT_RE)) {
        const spec = m[1] ?? m[2] ?? m[3] ?? m[4] ?? "";
        if (isForbidden(spec)) hits.push(`${relative(root, file)}: imports "${spec}"`);
      }
      if (/\bfetch\s*\(/.test(text)) hits.push(`${relative(root, file)}: calls fetch()`);
      if (/\bWebSocket\b/.test(text)) hits.push(`${relative(root, file)}: uses WebSocket`);
    }
    expect(hits).toEqual([]);
  });

  it("the detector itself catches forbidden imports", () => {
    expect(isForbidden("node:https")).toBe(true);
    expect(isForbidden("@anthropic-ai/sdk")).toBe(true);
    expect(isForbidden("@langchain/core/llms")).toBe(true);
    expect(isForbidden("ai")).toBe(true);
    expect(isForbidden("node:fs")).toBe(false);
    expect(isForbidden("commander")).toBe(false);
    expect(isForbidden("aiden")).toBe(false);
  });

  it("package.json lists no forbidden runtime dependency", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const bad = Object.keys(pkg.dependencies ?? {}).filter(isForbidden);
    expect(bad).toEqual([]);
  });

  it("no runtime dependency (direct or transitive) has an install script", () => {
    const seen = new Set<string>();
    const withScripts: string[] = [];
    const visit = (name: string) => {
      if (seen.has(name)) return;
      seen.add(name);
      const manifest = join(root, "node_modules", ...name.split("/"), "package.json");
      if (!existsSync(manifest)) return;
      const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
      };
      for (const s of ["preinstall", "install", "postinstall"]) {
        if (pkg.scripts?.[s]) withScripts.push(`${name} (${s})`);
      }
      Object.keys(pkg.dependencies ?? {}).forEach(visit);
    };
    const own = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    for (const s of ["preinstall", "install", "postinstall"]) {
      if (own.scripts?.[s]) withScripts.push(`@pyscoparth/capsules itself (${s})`);
    }
    Object.keys(own.dependencies ?? {}).forEach(visit);
    expect(withScripts).toEqual([]);
  });
});
