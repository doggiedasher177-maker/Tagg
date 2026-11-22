import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const html = readFileSync("index.html", "utf8");
const scripts = [...html.matchAll(/<script\\b([^>]*)>([\\s\\S]*?)<\\/script\\s*>/gi)]
  .map((match) => ({ attributes: match[1] || "", source: match[2] || "" }))
  .filter((item) => item.source.trim().length > 0);

if (scripts.length === 0) {
  throw new Error("No inline JavaScript was found in index.html.");
}

const directory = join(tmpdir(), `tag-client-check-${process.pid}`);
mkdirSync(directory, { recursive: true });

try {
  scripts.forEach((script, index) => {
    const isModule = /\\btype\\s*=\\s*["']module["']/i.test(script.attributes);
    const filename = join(directory, `inline-${index + 1}${isModule ? ".mjs" : ".js"}`);
    writeFileSync(filename, script.source, "utf8");

    const check = spawnSync(process.execPath, ["--check", filename], {
      encoding: "utf8",
    });

    if (check.status !== 0) {
      const details = [check.stdout, check.stderr].filter(Boolean).join("\\n").trim();
      throw new Error(`JavaScript syntax check failed for inline script ${index + 1}:\\n${details}`);
    }
  });

  console.log(`Validated ${scripts.length} inline JavaScript block(s).`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
