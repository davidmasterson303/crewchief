# @crewchief/core

Logic shared by the Next web app and, in time, the Expo client.

**The rule for what lives here:** no `next/*` import, no `@supabase/*`, no Node
built-in, no browser global. Enforced two ways —
`lib/__tests__/portability.test.ts` checks it statically and transitively, and
this package's own `tsconfig.json` omits the `dom` lib so a stray `document`
fails to compile here rather than in a mobile bundle later.

Import from the app as `@crewchief/core/<module>`. The alias is declared in the
root `tsconfig.json`; npm workspaces links the package itself.

See `CREWCHIEF_PHASE_2_PLAN.md` task 2.4.
