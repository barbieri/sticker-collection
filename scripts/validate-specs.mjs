import { promises as fs } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

const cwd = process.cwd();
const specsDir = path.join(cwd, 'specs');
const schemaPath = path.join(cwd, 'schemas', 'specs.json');

const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
const validate = ajv.compile(schema);

const files = (await fs.readdir(specsDir)).filter((f) => f.endsWith('.json'));
let hasError = false;

for (const file of files) {
  const specPath = path.join(specsDir, file);
  const raw = await fs.readFile(specPath, 'utf8');
  const parsed = JSON.parse(raw);
  const ok = validate(parsed);
  if (!ok) {
    hasError = true;
    console.error(`Schema validation failed: ${file}`);
    for (const err of validate.errors ?? []) {
      const pointer = err.instancePath || '/';
      console.error(`  - ${pointer} ${err.message ?? 'invalid'}`);
    }
  }
}

if (hasError) process.exit(1);
console.log(`Validated ${files.length} spec file(s) with Ajv + JSON Schema.`);
