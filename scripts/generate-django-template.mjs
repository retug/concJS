import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GOOGLE_TAG_ID = 'G-QHHKT2DQKV';
const BUNDLE_TAG = `<script defer src="{% static 'concgui/concgui.bundle.js' %}"></script>`;

export function convertIndexToDjangoTemplate(source) {
  let html = source.replace(/\r\n/g, '\n').trimStart();

  html = html.replace(
    /\s*<link\s+rel="icon"\s+type="image\/svg\+xml"\s+href="\/vite\.svg"\s*\/?>/,
    `\n    <link rel="shortcut icon" type="image/png" href="{% static 'logo/favicon.ico' %}">`
  );
  html = html.replace(
    /href="\/static\/css\/tailwind\.css"/,
    `href="{% static 'css/tailwind.css' %}"`
  );
  html = html.replace(
    /gtag\(\s*['"]config['"]\s*,\s*['"]G-QHHKT2DQKV['"]\s*(?:,\s*\{[\s\S]*?\})?\s*\);/,
    `gtag("config", "${GOOGLE_TAG_ID}", {\n        page_title: document.title\n      });`
  );
  html = html.replace(
    /\s*<script\s+type="module"\s+src="\/src\/main\.js"><\/script>/,
    `\n    ${BUNDLE_TAG}`
  );
  html = html.replace(/\s*<!--\s*<script\s+src="\/static\/concgui\/concgui\.bundle\.js"><\/script>\s*-->/, '');

  if (!html.startsWith('{% load static %}')) html = `{% load static %}\n${html}`;
  validateDeploymentTemplate(html);
  return `${html.trimEnd()}\n`;
}

export function validateDeploymentTemplate(html) {
  const required = [
    '{% load static %}',
    `{% static 'css/tailwind.css' %}`,
    `{% static 'logo/favicon.ico' %}`,
    BUNDLE_TAG,
    `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_TAG_ID}`,
    `gtag("config", "${GOOGLE_TAG_ID}"`,
    'https://cookieconsent.popupsmart.com/src/js/popper.js',
    'https://www.re-tug.com/disclaimer',
    'id="saveProjectModal"',
    'id="importProjectModal"',
    'id="projectNotice"'
  ];
  const missing = required.filter(marker => !html.includes(marker));
  if (missing.length) throw new Error(`Deployment template is missing: ${missing.join(', ')}`);

  const forbidden = ['/src/main.js', '/static/css/tailwind.css', '/vite.svg'];
  const present = forbidden.filter(marker => html.includes(marker));
  if (present.length) throw new Error(`Development-only references remain: ${present.join(', ')}`);

  const bundleCount = html.split(BUNDLE_TAG).length - 1;
  if (bundleCount !== 1) throw new Error(`Expected one production bundle tag, found ${bundleCount}.`);
}

async function main() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = path.resolve(scriptDirectory, '..');
  const sourcePath = path.join(repositoryRoot, 'index.html');
  const outputPath = path.resolve(repositoryRoot, process.argv[2] ?? 'deployment/conc_gui.html');
  const template = convertIndexToDjangoTemplate(await fs.readFile(sourcePath, 'utf8'));
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, template, 'utf8');
  console.log(`Generated ${path.relative(repositoryRoot, outputPath)}`);
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await main();
}

