import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

type RawCell = {
  cell_type: "markdown" | "code" | "raw";
  source: string | string[];
  outputs?: Array<{
    output_type: string;
    text?: string | string[];
    name?: string;
    data?: Record<string, string | string[]>;
    ename?: string;
    evalue?: string;
    traceback?: string[];
  }>;
};

type SlimCell =
  | { kind: "markdown"; src: string }
  | { kind: "code"; src: string; outputs: SlimOutput[] };

type SlimOutput =
  | { kind: "text"; text: string }
  | { kind: "image"; mime: string; b64: string }
  | { kind: "error"; ename: string; evalue: string; traceback: string };

const here = dirname(fileURLToPath(import.meta.url));
const nbDir = join(here, "../../../../notebooks");
const outDir = join(here, "../public/notebooks");
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) {
  if (f.endsWith(".json")) rmSync(join(outDir, f));
}

const join_src = (s: string | string[]): string => (Array.isArray(s) ? s.join("") : s);

function slimCell(c: RawCell): SlimCell | null {
  const src = join_src(c.source).trimEnd();
  if (c.cell_type === "markdown") return { kind: "markdown", src };
  if (c.cell_type === "code") {
    const outputs: SlimOutput[] = [];
    for (const o of c.outputs ?? []) {
      if (o.output_type === "stream") {
        outputs.push({ kind: "text", text: join_src(o.text ?? "") });
      } else if (o.output_type === "error") {
        outputs.push({
          kind: "error",
          ename: o.ename ?? "Error",
          evalue: o.evalue ?? "",
          traceback: (o.traceback ?? []).join("\n").replace(/\[[0-9;]*m/g, ""),
        });
      } else if (o.output_type === "display_data" || o.output_type === "execute_result") {
        const data = o.data ?? {};
        if (data["image/png"]) {
          outputs.push({ kind: "image", mime: "image/png", b64: join_src(data["image/png"]) });
        } else if (data["image/jpeg"]) {
          outputs.push({ kind: "image", mime: "image/jpeg", b64: join_src(data["image/jpeg"]) });
        } else if (data["text/plain"]) {
          outputs.push({ kind: "text", text: join_src(data["text/plain"]) });
        }
      }
    }
    return { kind: "code", src, outputs };
  }
  return null;
}

const files = readdirSync(nbDir).filter((f) => f.endsWith(".ipynb")).sort();
for (const f of files) {
  const raw = JSON.parse(readFileSync(join(nbDir, f), "utf-8")) as { cells: RawCell[] };
  const cells = raw.cells.map(slimCell).filter((c): c is SlimCell => c !== null);
  const slug = basename(f, ".ipynb");
  const id = slug.slice(0, 2);
  writeFileSync(join(outDir, `${id}.json`), JSON.stringify({ slug, cells }));
  console.log(`✓ ${id} ${slug} · ${cells.length} cells`);
}
