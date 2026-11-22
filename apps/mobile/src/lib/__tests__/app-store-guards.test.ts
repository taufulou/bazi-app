/**
 * 1C static guards. Each one pins a property that ordinary feature work can
 * silently undo. Parsed with the TypeScript AST, not regexes, so comments never
 * match and `'https://…'` literals are never cut in half.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const SRC = path.resolve(__dirname, '../..');

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === '__tests__' || e.name === 'node_modules') continue;
        walk(p);
      } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) {
        out.push(p);
      }
    }
  };
  walk(SRC);
  return out;
}

const FILES = sourceFiles();
const rel = (p: string) => path.relative(SRC, p);

function parse(p: string): ts.SourceFile {
  return ts.createSourceFile(p, fs.readFileSync(p, 'utf8'), ts.ScriptTarget.Latest, true, p.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function walk(node: ts.Node, visit: (n: ts.Node) => void) {
  visit(node);
  node.forEachChild((c) => walk(c, visit));
}

/** Every piece of literal text a user could see: strings, template parts, JSX text. */
function literalTexts(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  walk(sf, (n) => {
    if (
      ts.isStringLiteral(n) ||
      ts.isNoSubstitutionTemplateLiteral(n) ||
      ts.isTemplateHead(n) ||
      ts.isTemplateMiddle(n) ||
      ts.isTemplateTail(n)
    ) {
      out.push(n.text);
    } else if (ts.isJsxText(n)) {
      out.push(n.getText());
    }
  });
  return out;
}

it('sanity: the sweep sees the app', () => {
  expect(FILES.length).toBeGreaterThan(50);
  expect(FILES.map(rel)).toContain('app/store.tsx');
});

describe('wrong domain (F2)', () => {
  // Assembled at runtime so this file never matches itself.
  const NEEDLE = ['bazi', 'app', '.com'].join('');
  it('no source file names the domain we do not own', () => {
    const hits = FILES.filter((f) => fs.readFileSync(f, 'utf8').toLowerCase().includes(NEEDLE)).map(rel);
    expect(hits).toEqual([]);
  });
});

describe('removed copy (F21–F23)', () => {
  // Placeholder text (2.1), accuracy / prediction claims, and the deleted 紫微斗數 feature.
  const BANNED = ['精準', '紫微斗數', '預見你的一生', '即將推出', '敬請期待', '婚變危機預測'];
  it.each(BANNED)('%s appears in no user-visible literal', (phrase) => {
    const hits = FILES.filter((f) => literalTexts(parse(f)).some((t) => t.includes(phrase))).map(rel);
    expect(hits).toEqual([]);
  });

  it('the store compliance line never names the other platform\'s store on its own', () => {
    const store = literalTexts(parse(path.join(SRC, 'app/store.tsx')));
    expect(store.some((t) => t.includes('App Store／Google Play'))).toBe(false);
  });
});

describe('single sign-out path (F19)', () => {
  it('`signOut()` is called only by lib/session.ts', () => {
    const hits: string[] = [];
    for (const f of FILES) {
      walk(parse(f), (n) => {
        if (!ts.isCallExpression(n)) return;
        const c = n.expression;
        const name = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : '';
        if (name === 'signOut') hits.push(rel(f));
      });
    }
    expect([...new Set(hits)]).toEqual(['lib/session.ts']);
  });
});

describe('entering the app after auth (1C line audit)', () => {
  it('only lib/enter-app.ts replaces to the home route — everyone else calls enterApp()', () => {
    const hits: string[] = [];
    for (const f of FILES) {
      walk(parse(f), (n) => {
        if (
          ts.isCallExpression(n) &&
          ts.isPropertyAccessExpression(n.expression) &&
          n.expression.name.text === 'replace' &&
          n.arguments[0] &&
          /\(authenticated\)\/home/.test(n.arguments[0].getText())
        ) {
          hits.push(rel(f));
        }
      });
    }
    expect(hits).toEqual([]);
  });
});

describe('Sentry scope (F7 — native crash reports bypass beforeSend)', () => {
  const SETTERS = new Set(['setUser', 'setExtra', 'setExtras', 'setContext', 'setTag', 'setTags']);
  it('nothing puts data on the Sentry scope', () => {
    const hits: string[] = [];
    for (const f of FILES) {
      walk(parse(f), (n) => {
        if (
          ts.isCallExpression(n) &&
          ts.isPropertyAccessExpression(n.expression) &&
          ts.isIdentifier(n.expression.expression) &&
          n.expression.expression.text === 'Sentry' &&
          SETTERS.has(n.expression.name.text)
        ) {
          hits.push(`${rel(f)}: Sentry.${n.expression.name.text}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });

  it('Sentry.init is only ever called with sentryInitOptions', () => {
    const inits: string[] = [];
    for (const f of FILES) {
      walk(parse(f), (n) => {
        if (
          ts.isCallExpression(n) &&
          ts.isPropertyAccessExpression(n.expression) &&
          n.expression.getText() === 'Sentry.init'
        ) {
          inits.push(`${rel(f)}: ${n.arguments[0]?.getText()}`);
        }
      });
    }
    expect(inits).toEqual(['app/_layout.tsx: sentryInitOptions(env.sentryDsn)']);
  });
});

describe('AI-consent UX ratchet (1C item 2)', () => {
  // Layer 1 (inside src/lib) is the enforcement; this ratchet keeps the TAP-side
  // ask in place, so a new AI surface cannot ship that silently refuses instead.
  const AI_ENTRY_POINTS = [
    'streamDailyFortune', 'streamMonthlyFortune', 'streamYearlyFortune',
    'fetchMonthlyFortune', 'createBaziReading', 'regenerateBaziReading', 'streamBaziReading',
    'generateCompatibilityAI', 'streamCompatibilityReading', 'createChatSession',
    'streamChatMessage', 'extendSession', 'useFortuneNarrativeStream',
  ];
  const AI_MODALS = ['ChatSheet', 'UnlockConfirmModal'];
  /** Files that reach the AI but correctly do not ask themselves — each with its reason. */
  const ALLOWLIST: Record<string, string> = {
    'components/chat/hooks/useChatSession.ts': 'runs under ChatSheet; every opener asks first',
    'components/chat/hooks/useChatStream.ts': 'runs under ChatSheet; every opener asks first',
    'components/chat/ChatSheet.tsx': 'is the Modal; its openers ask',
    'components/fortune/hooks/useFortuneNarrativeStream.ts': 'the hook; fortune.tsx gates enabled + asks',
    'components/fortune/FortuneChat.tsx': 'controlled: its open goes through fortune.tsx onChatOpenChange',
    'components/reading/UnlockConfirmModal.tsx': 'is the Modal; reading/[type].tsx asks before opening it',
  };

  function reachesAi(sf: ts.SourceFile): string[] {
    const found = new Set<string>();
    walk(sf, (n) => {
      if (ts.isImportDeclaration(n) && n.importClause) {
        const names: string[] = [];
        if (n.importClause.name) names.push(n.importClause.name.text);
        const nb = n.importClause.namedBindings;
        if (nb && ts.isNamedImports(nb)) nb.elements.forEach((e) => names.push(e.name.text));
        names.filter((x) => AI_ENTRY_POINTS.includes(x) || AI_MODALS.includes(x)).forEach((x) => found.add(x));
      }
    });
    return [...found];
  }

  it('every screen that reaches the AI asks for consent from a tap', () => {
    const missing: string[] = [];
    for (const f of FILES) {
      const r = rel(f);
      if (r.startsWith('lib/') || ALLOWLIST[r]) continue;
      const sf = parse(f);
      const used = reachesAi(sf);
      if (used.length && !sf.getFullText().includes('requireAiConsent')) {
        missing.push(`${r} (${used.join(', ')})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('the allowlist has no stale entries', () => {
    for (const r of Object.keys(ALLOWLIST)) {
      expect(fs.existsSync(path.join(SRC, r))).toBe(true);
    }
  });
});
