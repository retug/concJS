import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { convertIndexToDjangoTemplate } from '../scripts/generate-django-template.mjs';

test('Django deployment template keeps production integrations and current app UI', async () => {
  const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const template = convertIndexToDjangoTemplate(indexHtml);

  assert.ok(template.startsWith('{% load static %}\n<!doctype html>'));
  assert.match(template, /\{% static 'css\/tailwind\.css' %\}/);
  assert.match(template, /\{% static 'concgui\/concgui\.bundle\.js' %\}/);
  assert.match(template, /googletagmanager\.com\/gtag\/js\?id=G-QHHKT2DQKV/);
  assert.match(template, /page_title: document\.title/);
  assert.match(template, /cookieconsent\.popupsmart\.com/);
  assert.match(template, /id="saveProjectModal"/);
  assert.match(template, /id="importProjectModal"/);
  assert.doesNotMatch(template, /\/src\/main\.js|\/vite\.svg/);
});
