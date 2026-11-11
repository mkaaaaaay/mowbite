import {readdirSync, readFileSync} from 'node:fs';
import {join, relative} from 'node:path';
import ts from 'typescript';
import {describe, expect, it} from 'vitest';
import de from './de';

// de.ts against the source: every english text the app shows has its german, every german is still used, both with the
// same placeholders. texts are what goes through tr(), and the strings in the places a component hands to tr() later:
// the props in UI_PROPS of objects (lists of fields, choices, steps) and of jsx elements. names (models, imagery
// providers) and words without a small letter (OK, STOP) stay as they are in every language

const SRC = join(__dirname, '..', '..');
const DE = join(__dirname, 'de.ts');
const UI_PROPS = new Set(['label', 'help', 'osLabel', 'osHelp', 'hint', 'title', 'text', 'osText', 'undoText', 'placeholder', 'aria-label', 'alt', 'choices']);
// a name: two words or more, each with a capital, a digit or a dot ("John Deere Tango E5", "Österreich basemap.at")
const isName = (s: string) => /\s/.test(s) && s.split(/\s+/).every((w) => !/\p{L}/u.test(w) || /^[\p{Lu}\d]|[.\d]/u.test(w));
// a text has a word with small letters, an id, a url or a css value isn't one
const isText = (s: string) => /[a-z]/.test(s) && !/^[a-z0-9_.:/#-]+$/.test(s) && !/^(var\(|#|\d|https?:)/.test(s) && !isName(s);
const placeholders = (s: string) => [...new Set(s.match(/\{\w+(?::\d)?\}/g))].sort();
// jsx text that is the same in every language
const SAME_EVERYWHERE = ['Ho ho ho!'];

function sources(dir: string): string[] {
  return readdirSync(dir, {withFileTypes: true}).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return sources(p);
    return /\.(ts|tsx|json)$/.test(d.name) && !d.name.endsWith('.test.ts') && p !== DE ? [p] : [];
  });
}

function jsonStrings(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(jsonStrings);
  if (v && typeof v === 'object') return Object.values(v).flatMap(jsonStrings);
  return [];
}

// the fixed texts an expression can be: 'a', c ? 'a' : 'b', x ?? 'a'
function texts(e: ts.Expression): string[] {
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [e.text];
  if (ts.isParenthesizedExpression(e)) return texts(e.expression);
  if (ts.isConditionalExpression(e)) return [...texts(e.whenTrue), ...texts(e.whenFalse)];
  if (ts.isBinaryExpression(e) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(e.operatorToken.kind))
    return [...texts(e.left), ...texts(e.right)];
  if (ts.isArrayLiteralExpression(e)) return e.elements.flatMap((x) => texts(x));
  return [];
}

const literals = new Set<string>();
const shown = new Map<string, string>(); // english text -> where
const varsOff: string[] = [];
const jsxText: string[] = [];

for (const file of sources(SRC)) {
  const src = readFileSync(file, 'utf8');
  const at = (n: ts.Node, sf: ts.SourceFile) => `${relative(SRC, file)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  // reasons.json is made from de.ts, the others are data the app shows
  if (file.endsWith('.json')) {
    if (!file.endsWith('reasons.json')) jsonStrings(JSON.parse(src)).forEach((s) => literals.add(s));
    continue;
  }
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const show = (s: string, n: ts.Node) => isText(s) && !shown.has(s) && shown.set(s, at(n, sf));
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) literals.add(n.text);
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'tr' && n.arguments.length) {
      const vars = n.arguments[1];
      const given =
        vars && ts.isObjectLiteralExpression(vars) && !vars.properties.some(ts.isSpreadAssignment)
          ? vars.properties.map((p) => `{${p.name!.getText(sf)}}`).sort()
          : vars
            ? null
            : [];
      for (const s of texts(n.arguments[0])) {
        show(s, n);
        const need = [...new Set(s.match(/\{\w+\}/g) ?? [])].sort();
        if (given && need.join() !== given.join()) varsOff.push(`${at(n, sf)} ${JSON.stringify(s)} needs ${need.join() || '-'}, gets ${given.join() || '-'}`);
      }
    }
    if (ts.isPropertyAssignment(n) && UI_PROPS.has(n.name.getText(sf).replace(/['"]/g, ''))) texts(n.initializer).forEach((s) => show(s, n));
    if (ts.isJsxAttribute(n) && UI_PROPS.has(n.name.getText(sf)) && n.initializer) {
      const v = ts.isJsxExpression(n.initializer) ? n.initializer.expression : n.initializer;
      if (v && ts.isStringLiteral(v)) show(v.text, n);
    }
    const said = ts.isJsxText(n) && n.text.trim();
    if (said && /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(said) && isText(said) && !SAME_EVERYWHERE.includes(said)) jsxText.push(`${at(n, sf)} ${said}`);
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

describe('de.ts', () => {
  it('has every english text the app shows', () => {
    const missing = [...shown].filter(([s]) => !(s in de)).map(([s, where]) => `${where} ${JSON.stringify(s)}`);
    expect(missing, 'add these to de.ts').toEqual([]);
  });

  it('has no text written straight into jsx, past tr()', () => {
    expect(jsxText, 'put these through tr()').toEqual([]);
  });

  it('only has texts the source still has', () => {
    expect(Object.keys(de).filter((k) => !literals.has(k)), 'not used anywhere, delete them from de.ts').toEqual([]);
  });

  it('keeps the placeholders of the english text', () => {
    const off = Object.entries(de).filter(([en, g]) => placeholders(en).join() !== placeholders(g).join());
    expect(off.map(([en, g]) => `${JSON.stringify(en)} -> ${JSON.stringify(g)}`)).toEqual([]);
  });

  it('gets the placeholders a text has from tr()', () => {
    expect(varsOff).toEqual([]);
  });
});
