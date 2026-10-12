import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAndNormalizeProject } from '../src/projectFile.js';
import { buildComparison } from './lib/verification-comparison.mjs';
import { buildFixedMMComparison } from './lib/fixed-mm-comparison.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

export function validateCatalog(catalog) {
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.cases)) {
    throw new Error('Verification catalog must use schemaVersion 1 and a cases array.');
  }
  const ids = new Set();
  const files = new Set();
  for (const entry of catalog.cases) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id ?? '') || ids.has(entry.id)) {
      throw new Error(`Invalid or duplicate verification id: ${entry.id}`);
    }
    if (!/^[a-z0-9][a-z0-9-]*\.json$/.test(entry.modelFile ?? '') || files.has(entry.modelFile)) {
      throw new Error(`Invalid or duplicate model filename: ${entry.modelFile}`);
    }
    if (typeof entry.modelSource !== 'string' || !entry.modelSource.startsWith('verification/')) {
      throw new Error(`Model source must be inside verification/: ${entry.id}`);
    }
    const source = path.resolve(root, entry.modelSource);
    const relative = path.relative(path.join(root, 'verification'), source);
    if (relative.startsWith('..') || path.isAbsolute(relative) || path.extname(source) !== '.json') {
      throw new Error(`Model source escapes verification/ or is not JSON: ${entry.id}`);
    }
    for (const field of ['title', 'summary', 'description']) {
      if (typeof entry[field] !== 'string' || !entry[field].trim()) {
        throw new Error(`Missing ${field} for ${entry.id}`);
      }
    }
    if (!['model-ready', 'comparison-ready'].includes(entry.status) || !Array.isArray(entry.details) ||
        entry.details.some(detail => typeof detail.label !== 'string' || typeof detail.value !== 'string')) {
      throw new Error(`Invalid status or model details for ${entry.id}`);
    }
    if (!entry.source?.title || !entry.source?.report || !entry.source?.page ||
        !/^https:\/\//.test(entry.source?.url ?? '')) {
      throw new Error(`Missing published source for ${entry.id}`);
    }
    if (entry.status === 'comparison-ready') {
      for (const field of ['comparisonSource', 'resultsSource']) {
        const relativeSource = path.relative(path.join(root, 'verification'), path.resolve(root, entry[field] ?? ''));
        if (relativeSource.startsWith('..') || path.isAbsolute(relativeSource) || !relativeSource.endsWith('.json')) {
          throw new Error(`Invalid ${field} for ${entry.id}`);
        }
      }
    }
    if (entry.previewSource && (!entry.previewSource.startsWith('verification/') ||
        path.relative(path.join(root, 'verification'), path.resolve(root, entry.previewSource)).startsWith('..') ||
        !/^[a-z0-9-]+\.png$/.test(entry.previewFile ?? ''))) {
      throw new Error(`Invalid section preview for ${entry.id}`);
    }
    ids.add(entry.id);
    files.add(entry.modelFile);
  }
  return catalog;
}

export async function buildVerification() {
  const catalog = validateCatalog(JSON.parse(await fs.readFile(path.join(root, 'verification/catalog.json'), 'utf8')));
  // Validate all inputs before writing any generated output. Never normalize or
  // resave the fixtures: the downloadable model must match the source byte for byte.
  const models = await Promise.all(catalog.cases.map(async entry => {
    const bytes = await fs.readFile(path.join(root, entry.modelSource));
    const project = JSON.parse(bytes.toString('utf8'));
    const validation = validateAndNormalizeProject(project);
    if (!validation.canImport) throw new Error(`${entry.id}: ${validation.errors.join('; ')}`);
    const comparison = entry.status === 'comparison-ready' ? (() => {
      return Promise.all([
        fs.readFile(path.join(root, entry.resultsSource), 'utf8'),
        fs.readFile(path.join(root, entry.comparisonSource), 'utf8')
      ]).then(([resultsText, referenceText]) => {
        const results = JSON.parse(resultsText);
        const reference = JSON.parse(referenceText);
        return entry.comparisonType === 'fixed-mm'
          ? buildFixedMMComparison(project, results, reference)
          : buildComparison(project, results, reference);
      });
    })() : null;
    const resolvedComparison = await comparison;
    if (resolvedComparison) {
      if (resolvedComparison.kind === 'fixed-mm') {
        const demand = validation.project.analysisConfiguration.demandCases.find(item => item.P === -3770 && item.M2 === 734166.67 && item.M3 === 0);
        if (!demand) throw new Error(`${entry.id}: saved fixed-P demand does not match the published plastic-moment load case.`);
      } else {
        for (const row of resolvedComparison.rows) {
          const demand = validation.project.analysisConfiguration.demandCases.find(item => item.id === `spcolumn-${row.id}`);
          if (!demand || demand.P !== -row.published.P || demand.M2 !== row.published.M2 || demand.M3 !== row.published.M3) {
            throw new Error(`${entry.id}: saved demand ${row.id} does not match the published control point.`);
          }
        }
      }
    }
    return { entry, bytes, comparison: resolvedComparison };
  }));
  const staticRoot = path.join(root, 'public/static/concgui/verification');
  const deploymentRoot = path.join(root, 'deployment/verification');
  const publicCatalog = {
    schemaVersion: catalog.schemaVersion,
    cases: catalog.cases.map(({ modelSource, comparisonSource, resultsSource, previewSource, ...entry }) => entry)
  };
  await fs.mkdir(path.join(staticRoot, 'models'), { recursive: true });
  await fs.mkdir(path.join(deploymentRoot, 'python'), { recursive: true });
  await fs.mkdir(path.join(deploymentRoot, 'python/results'), { recursive: true });
  await fs.mkdir(path.join(staticRoot, 'results'), { recursive: true });
  await fs.cp(path.join(root, 'verification/site/python'), path.join(deploymentRoot, 'python'), { recursive: true });
  await fs.cp(path.join(root, 'verification/site/templates'), path.join(deploymentRoot, 'templates'), { recursive: true });
  await fs.copyFile(path.join(root, 'verification/site/verification.css'), path.join(staticRoot, 'verification.css'));
  await fs.copyFile(path.join(root, 'verification/site/verification.js'), path.join(staticRoot, 'verification.js'));
  const catalogText = `${JSON.stringify(publicCatalog, null, 2)}\n`;
  await fs.writeFile(path.join(staticRoot, 'catalog.json'), catalogText);
  await fs.writeFile(path.join(deploymentRoot, 'python/catalog.json'), catalogText);
  for (const { entry, bytes, comparison } of models) {
    await fs.writeFile(path.join(staticRoot, 'models', entry.modelFile), bytes);
    if (entry.previewSource) {
      await fs.copyFile(path.join(root, entry.previewSource), path.join(staticRoot, entry.previewFile));
    }
    if (comparison) {
      const json = `${JSON.stringify(comparison, null, 2)}\n`;
      await fs.writeFile(path.join(staticRoot, 'results', `${entry.id}.json`), json);
      await fs.writeFile(path.join(staticRoot, 'results', `${entry.id}.svg`), comparison.chartSvg);
      await fs.writeFile(path.join(deploymentRoot, 'python/results', `${entry.id}.json`), json);
    }
  }
  console.log(`Built ${models.length} verification case(s), checked numerical baselines, and copied saved JSON models.`);
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await buildVerification();
}
