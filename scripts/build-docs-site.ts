#!/usr/bin/env node
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { generateSampleVideo } from "./sample-video.js";

const root = resolve(import.meta.dirname, "..", "..");
const docsDir = resolve(root, "docs");
const compiledPlaygroundDir = resolve(root, "lib", "playground");
const outDir = resolve(root, "dist", "docs-site");
const playgroundDir = resolve(root, "playground");
const browserDist = resolve(root, "dist", "browser");
const repoBase = "https://github.com/openclaw/ffmpeg-wasm";
const productName = "ffmpeg.sh";
const tagline = "Lightweight FFmpeg WebAssembly for local media automation";
const allowMissingBrowserBundle = process.argv.includes("--allow-missing-browser");

interface Frontmatter {
  description?: string;
  permalink?: string;
  title?: string;
}

interface Page {
  body: string;
  description: string;
  outRel: string;
  rel: string;
  title: string;
}

const nav = [
  ["Start", ["index.md", "install.md", "build-surface.md"]],
  ["Use", ["api.md", "cli.md", "playground.md", "recipes.md"]],
  ["Project", ["licensing.md", "ci.md", "domains.md"]],
] as const;

rmSync(outDir, { force: true, recursive: true });
mkdirSync(outDir, { recursive: true });

const pages = readPages();
const pageByRel = new Map(pages.map((page) => [page.rel, page]));
for (const page of pages) {
  const html = markdownToHtml(page.body, page);
  const outputPath = resolve(outDir, page.outRel);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, layout(page, html), "utf8");
}

copyWorkbench();
writeRedirectFallback();
copyBrowserWasm();
await writeSampleVideo();
copyAssets();
const cnamePath = resolve(docsDir, "CNAME");
if (existsSync(cnamePath)) {
  writeFileSync(resolve(outDir, "CNAME"), `${readFileSync(cnamePath, "utf8").trim()}\n`);
}
writeFileSync(resolve(outDir, ".nojekyll"), "");
writeFileSync(resolve(outDir, "_headers"), headersText(), "utf8");
writeFileSync(resolve(outDir, "llms.txt"), llmsText(), "utf8");
console.log(`built docs site: ${relative(root, outDir)}`);

function readPages() {
  return markdownFiles(docsDir).map((file) => {
    const rel = relative(docsDir, file).replaceAll(sep, "/");
    const raw = readFileSync(file, "utf8");
    const parsed = parseFrontmatter(raw);
    const title =
      parsed.frontmatter.title ?? firstHeading(parsed.body) ?? titleize(basename(rel, ".md"));
    return {
      body: parsed.body.trim(),
      description: parsed.frontmatter.description ?? tagline,
      outRel: outputRel(rel, parsed.frontmatter),
      rel,
      title,
    };
  });
}

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        return markdownFiles(full);
      }
      return entry.isFile() && entry.name.endsWith(".md") ? [full] : [];
    })
    .toSorted();
}

function parseFrontmatter(raw: string) {
  const match = /^---\n(?<frontmatter>[\s\S]*?)\n---\n?/u.exec(raw);
  if (!match?.groups) {
    return { body: raw, frontmatter: {} satisfies Frontmatter };
  }
  const frontmatter: Frontmatter = {};
  for (const line of match.groups.frontmatter.split("\n")) {
    const item = /^(?<key>[A-Za-z0-9_-]+):\s*(?<value>.*?)\s*$/u.exec(line);
    if (!item?.groups) {
      continue;
    }
    const value = item.groups.value.replaceAll(/^["']|["']$/gu, "");
    switch (item.groups.key) {
      case "description": {
        frontmatter.description = value;
        break;
      }
      case "permalink": {
        frontmatter.permalink = value;
        break;
      }
      case "title": {
        frontmatter.title = value;
        break;
      }
      default: {
        break;
      }
    }
  }
  return { body: raw.slice(match[0].length), frontmatter };
}

function outputRel(rel: string, frontmatter: Frontmatter) {
  if (typeof frontmatter.permalink === "string" && frontmatter.permalink.length > 0) {
    const permalink = normalizePermalink(frontmatter.permalink);
    return permalink === "/" ? "index.html" : `${permalink.slice(1)}/index.html`;
  }
  if (rel === "index.md") {
    return "index.html";
  }
  return `docs/${rel.replaceAll(/\.md$/gu, ".html")}`;
}

function normalizePermalink(value: string) {
  let permalink = value.trim();
  if (!permalink.startsWith("/")) {
    permalink = `/${permalink}`;
  }
  if (permalink.length > 1 && permalink.endsWith("/")) {
    permalink = permalink.slice(0, -1);
  }
  return permalink;
}

function markdownToHtml(markdown: string, page: Page) {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const html: string[] = [];
  let paragraph: string[] = [];
  let list: "ol" | "ul" | undefined;
  let code: { language: string; lines: string[] } | undefined;

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }
    html.push(`<p>${inline(paragraph.join(" "), page)}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!list) {
      return;
    }
    html.push(`</${list}>`);
    list = undefined;
  };

  for (const line of lines) {
    const fence = /^```(?<language>[A-Za-z0-9_-]*)\s*$/u.exec(line);
    if (fence?.groups) {
      if (code) {
        html.push(
          `<pre><code class="language-${escapeHtml(code.language)}">${escapeHtml(code.lines.join("\n"))}</code></pre>`,
        );
        code = undefined;
      } else {
        flushParagraph();
        closeList();
        code = { language: fence.groups.language, lines: [] };
      }
      continue;
    }
    if (code) {
      code.lines.push(line);
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = /^(?<level>#{1,4})\s+(?<text>.+)$/u.exec(line);
    if (heading?.groups) {
      flushParagraph();
      closeList();
      const level = heading.groups.level.length;
      const text = heading.groups.text.trim();
      const id = slug(text);
      html.push(
        `<h${level} id="${id}">${inline(text, page)}<a href="#${id}" aria-label="Link to ${escapeAttribute(text)}">#</a></h${level}>`,
      );
      continue;
    }

    const unordered = /^-\s+(?<text>.+)$/u.exec(line);
    if (unordered?.groups) {
      flushParagraph();
      if (list !== "ul") {
        closeList();
        list = "ul";
        html.push("<ul>");
      }
      html.push(`<li>${inline(unordered.groups.text, page)}</li>`);
      continue;
    }

    const ordered = /^\d+\.\s+(?<text>.+)$/u.exec(line);
    if (ordered?.groups) {
      flushParagraph();
      if (list !== "ol") {
        closeList();
        list = "ol";
        html.push("<ol>");
      }
      html.push(`<li>${inline(ordered.groups.text, page)}</li>`);
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  closeList();
  return html.join("\n");
}

function inline(markdown: string, page: Page) {
  let html = escapeHtml(markdown);
  html = html.replaceAll(
    /!\[(?<alt>[^\]]*)\]\((?<href>[^)]+)\)/gu,
    (_match: string, alt: string, href: string) =>
      `<img src="${escapeAttribute(rewriteLink(href, page))}" alt="${escapeAttribute(alt)}" />`,
  );
  html = html.replaceAll(
    /\[(?<text>[^\]]+)\]\((?<href>[^)]+)\)/gu,
    (_match: string, text: string, href: string) =>
      `<a href="${escapeAttribute(rewriteLink(href, page))}">${text}</a>`,
  );
  html = html.replaceAll(
    /`(?<code>[^`]+)`/gu,
    (_match: string, code: string) => `<code>${code}</code>`,
  );
  html = html.replaceAll(/\*\*(?<text>[^*]+)\*\*/gu, "<strong>$<text></strong>");
  return html;
}

function rewriteLink(rawHref: string, page: Page) {
  if (/^[a-z][a-z0-9+.-]*:/iu.test(rawHref) || rawHref.startsWith("#")) {
    return rawHref;
  }
  const [target, hash = ""] = rawHref.split("#");
  if (target.endsWith(".md")) {
    const targetPage = pageByRel.get(target);
    if (!targetPage) {
      throw new Error(`Broken docs link in ${page.rel}: ${rawHref}`);
    }
    return relativeLink(dirname(page.outRel), targetPage.outRel, hash);
  }
  if (target.startsWith("assets/")) {
    return relativeLink(dirname(page.outRel), target, hash);
  }
  return relativeLink(dirname(page.outRel), `docs/${target}`, hash);
}

function relativeLink(fromDir: string, toRel: string, hash: string) {
  const link =
    relative(fromDir === "." ? "" : fromDir, toRel).replaceAll(sep, "/") || basename(toRel);
  return hash ? `${link}#${hash}` : link;
}

function layout(page: Page, html: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escapeAttribute(page.description)}" />
    <title>${escapeHtml(page.title)} · ${productName}</title>
    <style>${css()}</style>
    ${canonicalRedirectScript()}
  </head>
  <body class="docs">
    <aside>
      <a class="brand" href="${relativeLink(dirname(page.outRel), "index.html", "")}">
        <span>${productName}</span>
        <small>${tagline}</small>
      </a>
      <nav>${navHtml(page)}</nav>
      <a class="repo" href="${repoBase}">GitHub</a>
    </aside>
    <main>
      <article>${html}</article>
    </main>
  </body>
</html>
`;
}

function navHtml(current: Page) {
  return nav
    .map(([title, rels]) => {
      const links = rels
        .map((rel) => pageByRel.get(rel))
        .filter((page): page is Page => page !== undefined)
        .map((page) => {
          const active = page.outRel === current.outRel ? " active" : "";
          return `<a class="${active}" href="${relativeLink(dirname(current.outRel), page.outRel, "")}">${escapeHtml(page.title)}</a>`;
        })
        .join("");
      return `<section><h2>${title}</h2>${links}</section>`;
    })
    .join("");
}

function copyAssets() {
  const assetsDir = resolve(docsDir, "assets");
  if (!existsSync(assetsDir)) {
    return;
  }
  const outputAssets = resolve(outDir, "assets");
  mkdirSync(outputAssets, { recursive: true });
  for (const entry of readdirSync(assetsDir)) {
    const source = resolve(assetsDir, entry);
    if (statSync(source).isFile()) {
      copyFileSync(source, resolve(outputAssets, entry));
    }
  }
}

function copyWorkbench() {
  const index = readFileSync(resolve(playgroundDir, "index.html"), "utf8")
    .replace("__PLAYGROUND_TOKEN__", "")
    .replace("</head>", `${canonicalRedirectScript()}\n  </head>`)
    .replace('href="/styles.css"', 'href="styles.css"')
    .replace('href="/docs/"', 'href="docs/"')
    .replace('src="/app.js"', 'src="app.js"');
  writeFileSync(resolve(outDir, "index.html"), index, "utf8");
  copyFileSync(resolve(compiledPlaygroundDir, "app.js"), resolve(outDir, "app.js"));
  copyFileSync(resolve(compiledPlaygroundDir, "app.js.map"), resolve(outDir, "app.js.map"));
  copyFileSync(
    resolve(compiledPlaygroundDir, "ffmpac-worker.js"),
    resolve(outDir, "ffmpac-worker.js"),
  );
  copyFileSync(
    resolve(compiledPlaygroundDir, "ffmpac-worker.js.map"),
    resolve(outDir, "ffmpac-worker.js.map"),
  );
  copyFileSync(resolve(playgroundDir, "styles.css"), resolve(outDir, "styles.css"));
}

function canonicalRedirectScript() {
  return `<script>
(() => {
  const { hostname, pathname, search, hash } = window.location;
  if (hostname === "www.ffmpeg.sh") {
    window.location.replace(\`https://ffmpeg.sh\${pathname}\${search}\${hash}\`);
    return;
  }
  if (hostname === "docs.ffmpeg.sh") {
    const docsPath = pathname === "/" || pathname === "/docs" ? "/docs/" : pathname.startsWith("/docs/") ? pathname : \`/docs\${pathname}\`;
    window.location.replace(\`https://ffmpeg.sh\${docsPath}\${search}\${hash}\`);
  }
})();
</script>`;
}

function writeRedirectFallback() {
  writeFileSync(
    resolve(outDir, "404.html"),
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Redirecting · ${productName}</title>
    ${canonicalRedirectScript()}
  </head>
  <body>
    <p>Not found.</p>
  </body>
</html>
`,
    "utf8",
  );
}

function copyBrowserWasm() {
  if (!existsSync(browserDist)) {
    if (allowMissingBrowserBundle) {
      return;
    }
    throw new Error("Missing dist/browser. Run pnpm build before building deployable docs.");
  }
  for (const required of ["ffmpeg.js", "ffmpeg_g.wasm", "ffprobe.js", "ffprobe_g.wasm"]) {
    if (!existsSync(resolve(browserDist, required))) {
      throw new Error(`Missing dist/browser/${required}. Run pnpm build before building docs.`);
    }
  }
  const outputWasm = resolve(outDir, "wasm");
  mkdirSync(outputWasm, { recursive: true });
  for (const name of [
    "ffmpeg.js",
    "ffmpeg.worker.js",
    "ffmpeg_g",
    "ffmpeg_g.wasm",
    "ffprobe.js",
    "ffprobe.worker.js",
    "ffprobe_g",
    "ffprobe_g.wasm",
  ]) {
    const source = resolve(browserDist, name);
    if (existsSync(source)) {
      copyFileSync(source, resolve(outputWasm, name));
    }
  }
  copyGeneratedLicenses(outputWasm);
}

function copyGeneratedLicenses(outputDir: string) {
  for (const name of [
    "LICENSE.md",
    "COPYING.LGPLv2.1",
    "COPYING.LGPLv3",
    "COPYING.GPLv2",
    "COPYING.GPLv3",
    "LICENSE.libvpx",
    "PATENTS.libvpx",
  ]) {
    const source = resolve(distRoot(), name);
    if (!existsSync(source)) {
      throw new Error(`Missing dist/${name}. Run pnpm build before building docs.`);
    }
    copyFileSync(source, resolve(outputDir, name));
  }
}

function distRoot() {
  return resolve(root, "dist");
}

async function writeSampleVideo() {
  const samplePath = resolve(outDir, "sample.webm");
  if (allowMissingBrowserBundle && !existsSync(resolve(distRoot(), "ffmpeg.js"))) {
    console.warn("sample video skipped: wasm bundle unavailable");
    return;
  }
  await generateSampleVideo(samplePath, { format: "webm" });
}

function llmsText() {
  const lines = [
    `# ${productName}`,
    "",
    tagline,
    "",
    "Documentation:",
    ...pages.map(
      (page) =>
        `- ${page.title}: https://ffmpeg.sh/${page.outRel === "index.html" ? "" : page.outRel}`,
    ),
    "",
    `Source: ${repoBase}`,
  ];
  return `${lines.join("\n")}\n`;
}

function headersText() {
  return `/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff

/wasm/*.wasm
  Content-Type: application/wasm

/wasm/*.js
  Content-Type: text/javascript; charset=utf-8

/wasm/ffmpeg_g
  Content-Type: text/javascript; charset=utf-8

/wasm/ffprobe_g
  Content-Type: text/javascript; charset=utf-8
`;
}

function firstHeading(markdown: string) {
  return /^#\s+(?<title>.+)$/mu.exec(markdown)?.groups?.title.trim();
}

function titleize(input: string) {
  return input.replaceAll("-", " ").replaceAll(/\b\w/gu, (match) => match.toUpperCase());
}

function slug(text: string) {
  return text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-|-$/gu, "");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function css() {
  return `
:root{color-scheme:dark;--bg:#080a08;--panel:#111610;--panel-2:#151a14;--text:#f4f1e8;--muted:#a8ada0;--line:#283024;--accent:#b8e48c;--accent-2:#9cc7ff;--code:#060706}
*{box-sizing:border-box}html{scroll-padding-top:24px}body{margin:0;min-height:100vh;background:linear-gradient(180deg,#0b0e0b,#050605);color:var(--text);font:16px/1.65 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:grid;grid-template-columns:280px minmax(0,1fr)}
body:before{content:"";position:fixed;inset:0;pointer-events:none;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:48px 48px;mask-image:linear-gradient(#000,transparent 85%)}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline;text-underline-offset:.2em}
aside{position:sticky;top:0;height:100vh;overflow:auto;padding:28px 22px;background:rgba(17,22,16,.92);border-right:1px solid var(--line)}
.brand{display:block;color:var(--text);margin-bottom:28px}.brand:hover{text-decoration:none}.brand span{display:block;font-size:1.5rem;font-weight:800;letter-spacing:0}.brand small{display:block;color:var(--muted);font-size:.82rem;line-height:1.35;margin-top:4px}
nav section{margin:0 0 22px}nav h2{margin:0 0 8px;color:var(--accent);font-size:.72rem;text-transform:uppercase;letter-spacing:.04em}nav a{display:block;color:var(--muted);padding:6px 9px;border-radius:6px;margin:1px 0}nav a:hover,nav a.active{background:#1b2418;color:var(--text);text-decoration:none}.repo{display:inline-block;margin-top:10px;border:1px solid var(--line);border-radius:7px;padding:7px 10px;color:var(--text)}
main{width:min(100%,1080px);padding:40px clamp(22px,5vw,70px) 90px}article{max-width:820px}body.home article{max-width:980px}
h1{font-size:clamp(2.4rem,7vw,5.8rem);line-height:.95;margin:.05em 0 .35em;letter-spacing:0}body.docs h1{font-size:clamp(2.2rem,5vw,4rem)}
h2{font-size:1.55rem;margin:2em 0 .55em;line-height:1.15}h3{font-size:1.15rem;margin:1.5em 0 .4em}h1,h2,h3,h4{color:var(--text)}h1 a,h2 a,h3 a,h4 a{opacity:0;margin-left:.35em;color:var(--muted);font-size:.75em}h1:hover a,h2:hover a,h3:hover a,h4:hover a{opacity:1;text-decoration:none}
p{margin:0 0 1.05em;color:#d8d8cf}ul,ol{padding-left:1.35rem;margin:0 0 1.2em}li{margin:.22em 0;color:#d8d8cf}strong{color:var(--text)}
img{display:block;max-width:100%;max-height:720px;height:auto;object-fit:contain;object-position:top;border:1px solid var(--line);border-radius:8px;margin:22px 0;background:#000}
code{font: .9em ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#171d15;border:1px solid var(--line);border-radius:5px;padding:.08em .32em;color:#e6f6d8}
pre{overflow:auto;background:var(--code);border:1px solid #20281d;border-radius:8px;padding:16px 18px;margin:1.25em 0;color:#e8efdf}pre code{display:block;background:transparent;border:0;padding:0;color:inherit;white-space:pre}
article>p:first-of-type{font-size:1.18rem;color:#ece8dc;max-width:68ch}.home article>p:first-of-type{font-size:1.35rem;max-width:52ch}
@media(max-width:850px){body{display:block}aside{position:relative;height:auto;border-right:0;border-bottom:1px solid var(--line)}main{padding:28px 18px 64px}nav{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px 14px}}
`;
}
