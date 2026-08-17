import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('scene selection uses minification-safe Three.js type flags', async () => {
  const source = await readFile(
    new URL('../src/threeJSscenefunctions.js', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(source, /constructor\.name/);
  assert.match(source, /obj\.isPoints === true/);
  assert.match(source, /obj\.isMesh === true/);
});
