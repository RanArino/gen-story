// Trusted child-process entry. Candidate modules receive only JSON ABI inputs.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [implementation, inputFile, repetitions] = process.argv.slice(2);
try {
  const { default: run } = await import(pathToFileURL(implementation).href);
  const inputs = JSON.parse(readFileSync(inputFile, 'utf8'));
  const outputs = inputs.map((input) => Array.from({ length: Number(repetitions) }, () => {
    const output = run(structuredClone(input));
    if (!output || typeof output !== 'object' || typeof output.then === 'function') throw new Error('output must be synchronous JSON');
    return JSON.stringify(output, (_key, value) => {
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('non-finite output');
      if (typeof value === 'function' || typeof value === 'undefined' || typeof value === 'bigint') throw new Error('non-JSON output');
      return value;
    });
  }));
  process.stdout.write(JSON.stringify({ outputs }));
} catch (error) {
  process.stderr.write(String(error));
  process.exitCode = 1;
}
