/**
 * Content validation CLI.
 *   npx tsx tools/validate-content.ts            # summary + all errors + warnings grouped by code
 *   npx tsx tools/validate-content.ts --verbose  # list every warning
 * Exit code 1 when any error is found.
 */
import { FULL_CATALOG } from '../src/content/catalog';
import { validateContent, type Issue } from '../src/content/validate';

const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');
const { errors, warnings, stats } = validateContent(FULL_CATALOG);

const group = (issues: Issue[]): Map<string, Issue[]> => {
  const m = new Map<string, Issue[]>();
  for (const i of issues) m.set(i.code, [...(m.get(i.code) ?? []), i]);
  return new Map([...m.entries()].sort((a, b) => b[1].length - a[1].length));
};

console.log('Content catalog — validation report');
console.log('='.repeat(40));
for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(18)} ${v}`);
console.log('');

if (errors.length) {
  console.log(`ERRORS (${errors.length})`);
  for (const [code, list] of group(errors)) {
    console.log(`  [${code}] × ${list.length}`);
    for (const i of list.slice(0, verbose ? list.length : 25)) console.log(`    - ${i.message}`);
    if (!verbose && list.length > 25) console.log(`    … ${list.length - 25} more (use --verbose)`);
  }
  console.log('');
}

console.log(`WARNINGS (${warnings.length})`);
for (const [code, list] of group(warnings)) {
  console.log(`  [${code}] × ${list.length}`);
  for (const i of list.slice(0, verbose ? list.length : 5)) console.log(`    - ${i.message}`);
  if (!verbose && list.length > 5) console.log(`    … ${list.length - 5} more (use --verbose)`);
}
console.log('');
console.log(errors.length ? `FAILED: ${errors.length} error(s), ${warnings.length} warning(s)` : `OK: 0 errors, ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
