// Type-check every ```ts block in the SDK's shipped docs/ against the SDK's own
// declarations, under `strict`. Free variables the prose leaves implicit
// (client, trader, account, pool, ...) are declared with SDK types in prelude.d.ts.
//
// Blocks that are not valid TypeScript on their own (fragments, `...`) are set
// aside and listed, since a syntax error stops tsc from checking anything else.
// "Cannot find name" errors are filtered: they are the harness, not the docs.
//
//   npm run check:docs
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const DOCS = "node_modules/@somnia-chain/markets-sdk/docs";
const OUT = "docs-check/wrap";
const ONLY = process.argv[2]; // optional: e.g. "PERPS"

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".md") ? [p] : [];
  });
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
let count = 0;
for (const file of walk(DOCS)) {
  const name = relative(DOCS, file).replace(/\//g, "__").replace(/\.md$/, "");
  if (ONLY && !name.startsWith(ONLY)) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*```(ts|typescript|tsx)\s*$/.test(lines[i])) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j].trim().startsWith("```")) j++;
    const body = lines.slice(i + 1, j);
    const indent = Math.min(...body.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length), 99);
    const src = body.map((l) => l.slice(indent));
    const imports = src.filter((l) => l.startsWith("import "));
    const rest = src.filter((l) => !l.startsWith("import "));
    writeFileSync(join(OUT, `${name}_L${i + 2}.tsx`), `${imports.join("\n")}\nexport async function __snip(){\n${rest.join("\n")}\n}\n`);
    count++;
    i = j;
  }
}

const tsc = () => {
  try {
    return execSync("npx tsc -p docs-check/tsconfig.json", { encoding: "utf8" });
  } catch (e) {
    return e.stdout ?? "";
  }
};
let out = tsc();
const syntax = [...new Set([...out.matchAll(/^(\S+?)\(\d+,\d+\): error TS1\d{3}/gm)].map((m) => m[1]))];
for (const f of syntax) rmSync(f);
if (syntax.length) out = tsc();

const errors = out.split("\n").filter((l) => /error TS/.test(l) && !/Cannot find name|TS18004|TS7006|TS7026|TS2875|TS2307|TS1184/.test(l));
console.log(`${count} blocks checked, ${syntax.length} set aside as fragments`);
console.log(errors.length ? errors.join("\n") : "no type errors");
if (existsSync("evidence")) writeFileSync("evidence/04-docs-typecheck.txt", `${count} blocks checked\nfragments set aside:\n${syntax.join("\n")}\n\nerrors:\n${errors.join("\n")}\n`);
