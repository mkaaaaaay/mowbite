import {existsSync, readFileSync, statSync} from 'node:fs';
import {builtinModules} from 'node:module';
import {dirname, join, relative, resolve} from 'node:path';
import ts from 'typescript';
import {describe, expect, it} from 'vitest';

// the mock mower (mowbite-sim) bundles these for node with only clipper-lib and mqtt besides node's own, without react
const ENTRIES = ['openmower', 'rings', 'demo/garden', 'demo/world'];
const PACKAGES = ['clipper-lib', 'mqtt'];
// the mock brings its own english for the language switch
const SWAPPED = /(^|\/)i18n$/;
const LIB = resolve(__dirname, '..');
const SRC = resolve(LIB, '..');

// the modules a file still imports when it runs: no import type, no imports of types only
function runtimeImports(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = ts.isImportDeclaration(node) ? node.importClause : undefined;
      const named = clause?.namedBindings ?? (ts.isExportDeclaration(node) ? node.exportClause : undefined);
      const typesOnly = ts.isImportDeclaration(node)
        ? !!clause && (clause.isTypeOnly || (!clause.name && !!named && ts.isNamedImports(named) && named.elements.every((e) => e.isTypeOnly)))
        : node.isTypeOnly || (!!named && ts.isNamedExports(named) && named.elements.every((e) => e.isTypeOnly));
      if (!typesOnly) found.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) {
      found.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const resolveFile = (base: string) => ['.ts', '.tsx', '/index.ts', ''].map((ext) => base + ext).find((f) => existsSync(f) && statSync(f).isFile());

describe('the demo core', () => {
  it('runs in node with only clipper-lib and mqtt', () => {
    const seen = new Set<string>();
    const outside: string[] = [];
    const todo = ENTRIES.map((e) => resolveFile(join(LIB, e))!);
    while (todo.length) {
      const file = todo.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      if (!/\.tsx?$/.test(file)) continue;
      for (const spec of runtimeImports(file).filter((s) => !SWAPPED.test(s))) {
        const local = spec.startsWith('.') ? join(dirname(file), spec) : spec.startsWith('@/') ? join(SRC, spec.slice(2)) : null;
        if (!local) {
          if (!PACKAGES.includes(spec) && !builtinModules.includes(spec.replace(/^node:/, ''))) outside.push(`${relative(SRC, file)}: ${spec}`);
          continue;
        }
        const next = resolveFile(local);
        if (next) todo.push(next);
        else outside.push(`${relative(SRC, file)}: ${spec} not found`);
      }
    }
    expect(outside).toEqual([]);
  });
});
