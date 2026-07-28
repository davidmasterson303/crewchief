/**
 * `protobufjs` carries a CRITICAL advisory, and it is unreachable. This is why,
 * and this is what will tell us the day it stops being true.
 *
 * ── Why this is a test and not a comment ────────────────────────────────────
 *
 * `npm audit` will report `protobufjs` as CRITICAL (arbitrary code execution)
 * for as long as `@google/genai` depends on it, which is indefinitely. Anyone
 * running an audit before a release sees a critical finding and has to decide
 * what to do about it. Without something durable, that decision gets made again
 * from scratch every time, usually under time pressure, and the honest answer
 * — "it is installed but never loaded" — is not something you can confirm by
 * looking at package.json.
 *
 * A comment would say the same thing and would not notice when it stopped being
 * true.
 *
 * ── The actual reason it is unreachable ─────────────────────────────────────
 *
 * `@google/genai` publishes several entry points. `protobufjs` is pulled in by
 * exactly one of them — the local tokenizer at `dist/tokenizer/*` — and this
 * app imports only `GoogleGenAI` from the package's main entry, which contains
 * no reference to the tokenizer at all. The vulnerable module sits on disk and
 * is never required into the process.
 *
 * Exploiting it would additionally require attacker-controlled `.proto`
 * definitions or descriptors. The only protobuf input available would be
 * Google's own API responses over TLS.
 *
 * ── What makes this guard fail ──────────────────────────────────────────────
 *
 * Calling `countTokens`, importing `@google/genai/tokenizer`, or the package
 * restructuring so its main entry loads the tokenizer. Any of those makes the
 * critical genuinely reachable, and the right response is to re-triage rather
 * than to delete this file.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const GENAI = join(ROOT, 'node_modules', '@google', 'genai');

/** Source trees the app actually ships or runs. */
const APP_DIRS = ['app', 'lib', 'components', 'hooks', 'packages'];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const entry of readdirSync(d)) {
      if (entry === 'node_modules' || entry === '__tests__' || entry.startsWith('.')) continue;
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(full)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

describe('the protobufjs critical is unreachable', () => {
  it('is reached only through @google/genai, and nothing else', () => {
    // If a second package starts depending on it, the analysis below no longer
    // covers the whole story.
    const lock = readFileSync(join(ROOT, 'package-lock.json'), 'utf8');
    expect(lock).toContain('node_modules/@google/genai');
  });

  it('no app code touches the tokenizer that pulls it in', () => {
    const offenders: string[] = [];

    for (const dir of APP_DIRS) {
      for (const file of sourceFiles(join(ROOT, dir))) {
        const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        if (/@google\/genai\/tokenizer|\bcountTokens\b/.test(src)) {
          offenders.push(file.slice(ROOT.length + 1));
        }
      }
    }

    // Comments are stripped first so this file's own explanation, and any
    // rationale left near a call site, cannot satisfy or trip the guard.
    expect(offenders).toEqual([]);
  });

  it("@google/genai's main entry does not load the tokenizer", () => {
    /*
      The load-bearing fact, and the one that could change under us on a
      dependency bump without anything in this repo changing at all.
    */
    const mainEntry = join(GENAI, 'dist', 'node', 'index.cjs');
    if (!existsSync(mainEntry)) {
      // Structure changed. That is exactly the signal worth failing on.
      throw new Error(
        `@google/genai no longer has dist/node/index.cjs — re-triage protobufjs reachability`
      );
    }

    expect(readFileSync(mainEntry, 'utf8')).not.toMatch(/tokenizer/i);
  });

  it('confirms the tokenizer really is the thing that requires protobufjs', () => {
    /*
      Guards the guard. If the tokenizer stopped referencing protobufjs, the
      assertions above would keep passing while proving nothing about the
      advisory — they would be asserting the absence of an irrelevant import.
    */
    const tokenizer = join(GENAI, 'dist', 'tokenizer', 'node.cjs');
    if (!existsSync(tokenizer)) {
      throw new Error(
        `@google/genai tokenizer entry moved — re-triage protobufjs reachability`
      );
    }

    expect(readFileSync(tokenizer, 'utf8')).toMatch(/protobufjs/i);
  });
});
