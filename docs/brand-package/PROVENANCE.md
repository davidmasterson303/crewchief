# Where this came from, and what it is not

Design's **Well Kept brand identity redesign**, delivered 30 Aug 2026 as
`~/Downloads/Well Kept brand identity redesign.zip` and copied here verbatim so
it survives a cleared Downloads folder and is versioned with the code that will
implement it.

**Nothing here is wired up.** No component references these files, and the app
still draws the Sweep dial mark from `components/brand/Logo.tsx`. Implementation
is a separate piece of work — `REBRAND_PROMPT.md` §4 is its spec.

## Two things to do before any of it ships

Both are the package README's, restated because they are the kind of thing that
gets discovered at export time:

1. **Outline the type.** Every SVG declares `font-family="Newsreader, Georgia,
   serif"`. That is correct in a browser with the webfont loaded and wrong in a
   rasteriser, which silently substitutes Georgia and changes the W's shape.
   Convert `<text>` to paths when the PNG set is generated.
2. **Bake the ground into the icons.** iOS does not composite transparency on
   the home screen, so the icon files carry their own background and must not be
   exported transparent.

## The second pass changed two rulings

This copy is the **30 Aug 16:20** revision, not the first one. Two decisions
were reversed between them, and both reversals are load-bearing:

- **Bundle id: keep `co.davidmasterson.crewchief`.** The first pass said change
  it if no listing was live. ⚠ For the record, that condition *is* met here —
  `APP_STORE_URL` is null and no App Store Connect record exists, so a change
  would have cost nothing. The ruling stands on the other ground it gives: the
  id is invisible to users and a rebrand is not a reason to touch it.
- **Recalls are free.** The first pass gated them behind the subscription;
  the second endorses `packages/core/src/paid-features.ts` and says to keep the
  test that asserts it. See `design-system-drift.md` §7.4.

⚠ One line in §1 is already overtaken: it says `@crewchief/core` stays and
`@wellkept/core` is "the intended name, not a required rename this pass". The
scope was renamed on 30 Aug in `9d2dc41` — 586 sites, typecheck and production
build clean. Not required is not the same as unwelcome, and reverting it would
be churn for its own sake.
