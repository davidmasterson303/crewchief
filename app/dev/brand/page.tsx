import BrandLockup from '@/components/brand/BrandLockup';
import { CLEAR_SPACE, MIN_WIDTH } from '@wellkept/core/brand';

/*
 * The lockup at every size and on both grounds. Development only.
 *
 * ── Why this page exists ────────────────────────────────────────────────────
 *
 * The mark is drawn from constants rather than pasted as a file, so the way it
 * fails is not a broken image — it is a plate that renders with the wrong
 * tracking, or a maker line at a size nobody can read, or a glow on a ground
 * that cannot carry one. None of that is visible in a test, and all of it is
 * obvious in one screenful.
 *
 * `brand.test.ts` proves the numbers match Design's package. This is the half a
 * test cannot do: whether the drawing those numbers produce is the drawing
 * Design meant.
 *
 * ⚠ The reductions are the point. Design's rule is that each size takes the
 * largest drawing whose floor it clears — no intermediate drawings, no hinting
 * — so the interesting rows are the ones on either side of 240 and 160, where
 * the maker line and then the whole lockup drop out.
 */

const WIDTHS = [280, MIN_WIDTH.full, MIN_WIDTH.full - 1, 200, MIN_WIDTH.short, MIN_WIDTH.short - 1, 96, 40];

export default function BrandStatesPage() {
  return (
    <main className="min-h-screen bg-[#100F0D] px-6 py-10">
      <div className="mx-auto max-w-4xl space-y-12">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold text-white">Well Kept lockup — states</h1>
          <p className="text-sm text-white/60">
            Development only. Every drawing below comes from{' '}
            <code className="text-white/80">@wellkept/core/brand</code>, whose values are asserted
            against Design&rsquo;s SVG package.
          </p>
        </header>

        <section className="space-y-6">
          <h2 className="text-lg font-semibold text-white">By width, on the page ground</h2>
          <p className="text-sm text-white/60">
            The drawing is chosen from the width. Below {MIN_WIDTH.full}px the maker line goes;
            below {MIN_WIDTH.short}px the lockup becomes the icon.
          </p>

          <div className="space-y-8">
            {WIDTHS.map((width) => (
              <div key={width} className="space-y-2">
                <p className="font-mono text-xs uppercase tracking-widest text-white/40">
                  {width}px
                </p>
                <BrandLockup width={width} />
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-6">
          <h2 className="text-lg font-semibold text-white">On a light ground</h2>
          <p className="text-sm text-white/60">
            The glow cannot exist, so the plate goes hollow and the edge takes cyan-700. The only
            sanctioned substitution.
          </p>
          <div className="space-y-8 rounded-2xl bg-[#F5F3F0] p-8">
            <BrandLockup width={280} ground="light" />
            <BrandLockup width={200} ground="light" />
            <BrandLockup width={64} ground="light" />
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Clear space</h2>
          <p className="text-sm text-white/60">
            {CLEAR_SPACE} grid units on all sides. Nothing enters it — including the score mark.
            The dashed box is the boundary, not part of the mark.
          </p>
          <div className="inline-block border border-dashed border-white/25 p-[48px]">
            <BrandLockup width={280} />
          </div>
        </section>
      </div>
    </main>
  );
}
