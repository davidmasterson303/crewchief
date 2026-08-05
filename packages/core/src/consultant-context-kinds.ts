/**
 * What the advisor's answer was grounded in — the vocabulary, without the chips.
 *
 * ── Why this is in core ─────────────────────────────────────────────────────
 *
 * `ContextKind` was declared in `lib/consultant-context.ts` and its display
 * names lived as a `CONTEXT_LABELS` literal inside `ConsultantChat.tsx`. Both
 * are now read by a second client: the Expo advisor screen renders the same
 * provenance row, and it can import neither. `lib/consultant-context.ts` pulls
 * in `SupabaseClient` and server-only loading; `ConsultantChat.tsx` is a
 * `'use client'` React DOM component.
 *
 * The alternative was a copy of six strings in the mobile app, which is the
 * health-band mistake at a different scale — and worse here, because these
 * labels are not decoration. They are a **provenance claim**, and the one time
 * they were wrong (`wishlist` and `service` collapsed into one chip) the app
 * asserted a mod profile for a car that had none. A label that drifts between
 * clients means the phone and the laptop make different claims about the same
 * answer.
 *
 * So the split follows `health-band`'s rule: what a kind **means** and what to
 * call it is product judgement and lives here. How a chip looks — a Lucide icon
 * and Tailwind classes on web, a `View` with a border on the phone — is
 * presentation and stays with the platform.
 *
 * ── The wording is load-bearing, not cosmetic ───────────────────────────────
 *
 * `wishlist` means the `wishlist_items` table — mods the owner wants. It does
 * **not** mean `wishlistItems` in `ConsultantContext`, which is outstanding
 * `service_items` and is deliberately not a chip at all. The field names are
 * what mislead; these labels are what tell the truth. `loadedContextKinds` in
 * `lib/consultant-context.ts` carries the full account of that bug.
 *
 * Both clients must also keep prefixing the row **"Based on"** rather than
 * "Sources". These kinds report what was loaded and put in front of the model,
 * which the server can check. What the model actually used is not knowable from
 * anywhere, and the earlier wording claimed it.
 */

export type ContextKind = 'knowledge' | 'service' | 'issues' | 'mods' | 'wishlist' | 'recalls';

export const CONTEXT_KIND_LABELS: Record<ContextKind, string> = {
  knowledge: 'Knowledge base',
  service: 'Service records',
  issues: 'Issue history',
  mods: 'Mod profile',
  wishlist: 'Wishlist',
  recalls: 'Recall data',
};

/**
 * Narrow an unvalidated string to a `ContextKind`.
 *
 * The mobile client reads `contextKinds` off a JSON response, so what arrives
 * is `unknown` no matter what the route's type says. An unrecognised kind — a
 * server that has shipped a seventh one to a phone that has not been updated —
 * renders nothing rather than an empty chip or a crash on an undefined label.
 * That is the honest degradation: a client that cannot name a source should not
 * draw one.
 *
 * **`hasOwn`, not `in`** — and this was written as `in` first and caught by
 * `context-kind-labels.test.ts` before it ran anywhere. `in` walks the
 * prototype chain, so `'toString'` and `'constructor'` are members of any
 * object literal: a response carrying `contextKinds: ['toString']` would have
 * passed the guard, and the chip would then have rendered
 * `CONTEXT_KIND_LABELS['toString']` — a *function* — inside a React Native
 * `<Text>`, which throws. The lookup is keyed by data off the wire, so the
 * check has to be about own keys rather than about membership.
 *
 * `Object.hasOwn` is ES2022 and this module runs on Hermes as well as Node, so
 * it was checked rather than assumed: the `hermesvm.framework` binary inside
 * the installed simulator build carries `hasOwn` in its builtin-name table and
 * exports `objectHasOwn`. Worth knowing the check is cheap, because Jest runs
 * on Node and would pass either way — the same shape as the three "green but
 * did not run" defects of 4 Aug.
 */
export function isContextKind(value: unknown): value is ContextKind {
  return typeof value === 'string' && Object.hasOwn(CONTEXT_KIND_LABELS, value);
}
