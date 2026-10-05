import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve('src');
const violations = [];
let count = 0;
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (file.endsWith('.ts')) inspect(file);
  }
}
function inspect(file) {
  count++;
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  function visit(node) {
    const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier
      : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0] : undefined;
    if (specifier && ts.isStringLiteral(specifier)) {
      const name = specifier.text;
      const resolved = name.startsWith('@/') ? path.resolve(root, name.slice(2))
        : name.startsWith('.') ? path.resolve(path.dirname(file), name) : null;
      const layer = resolved ? path.relative(root, resolved).split(path.sep)[0] : null;
      // The legacy bodies facade binds pure scaling to static body definitions, also safe in Node.
      const bodyCatalog = file === path.join(root, 'sim/bodies/index.ts') && resolved === path.join(root, 'data/bodies');
      if (!bodyCatalog && (resolved ? !['sim', 'util'].includes(layer) : true)) {
        const line = source.getLineAndCharacterOfPosition(specifier.getStart(source)).line + 1;
        violations.push(`${path.relative(process.cwd(), file)}:${line}: forbidden sim dependency ${name}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
walk(path.join(root, 'sim'));
if (violations.length) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else console.log(`Simulation layering verified across ${count} modules (static bodies facade exception documented).`);
