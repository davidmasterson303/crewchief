import { Text } from 'react-native';
import { render, userEvent } from '@testing-library/react-native';

import AlertBanner from '../AlertBanner';
import Button from '../Button';
import Chip from '../Chip';
import EmptyState from '../EmptyState';
import Field from '../Field';
import ListRow from '../ListRow';
import ProvenanceRow from '../ProvenanceRow';
import { FIELD_FONT_MIN, TARGET_MIN, TYPE_MIN, surface, text } from '../../theme';

/**
 * The primitive set's invariants.
 *
 * These are the rules that cannot live in a docblock, because every one of them
 * has already been broken once in this product by someone who had read the
 * docblock. The handoff's phrasing is the standard: **states are not optional**.
 *
 * Deliberately not snapshots. A snapshot records what the component renders and
 * fails when anything changes, which trains people to re-record it; these
 * assert the handful of properties that must survive a redesign.
 */

const flat = (style: unknown) =>
  Object.assign({}, ...[style].flat(Infinity).filter(Boolean)) as Record<string, unknown>;

describe('Button', () => {
  it('keeps its accessible name while working', async () => {
    // The <Text> naming it is swapped for a spinner, so a control named by its
    // child goes anonymous exactly when it has something to say.
    const view = await render(<Button label="Saving" busy onPress={jest.fn()} />);

    const control = view.getByLabelText('Saving');
    expect(control.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
  });

  it('does not fire while busy', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    const view = await render(<Button label="Save" busy onPress={onPress} />);

    await user.press(view.getByLabelText('Save'));

    expect(onPress).not.toHaveBeenCalled();
  });

  it('disables with an explicit fill rather than a group opacity', async () => {
    /*
      The 1.61:1 defect. An `opacity` on the container composites everything
      beneath it including ink that was compliant at full strength, and both
      contrast guards were blind to it.
    */
    const view = await render(<Button label="Delete" disabled onPress={jest.fn()} />);
    const style = flat(view.getByLabelText('Delete').props.style);

    expect(style.opacity).toBeUndefined();
    expect(style.backgroundColor).toBe(surface.disabled);
  });

  it('keeps the small size on the 44pt floor', async () => {
    // "Small" is narrower and lighter in type. It is not shorter — the floor is
    // a coarse-pointer target, not a style.
    const view = await render(<Button label="Add" size="small" onPress={jest.fn()} />);
    const style = flat(view.getByLabelText('Add').props.style);

    expect(style.minHeight).toBeGreaterThanOrEqual(TARGET_MIN);
  });

  it('renders every variant', async () => {
    for (const variant of ['primary', 'quiet', 'outline', 'ghost', 'delete'] as const) {
      const view = await render(<Button label={variant} variant={variant} onPress={jest.fn()} />);
      expect(view.getByLabelText(variant)).toBeTruthy();
    }
  });
});

describe('Chip', () => {
  it('cannot render below the type floor', async () => {
    /*
      The design system's own stylesheet ships `.chip` at 11px and every chip on
      the board overrides it back. Encoded here so a call site cannot repeat it:
      there is no size prop.
    */
    const view = await render(<Chip label="Overdue" tone="critical" />);
    const style = flat(view.getByText('Overdue').props.style);

    expect(style.fontSize).toBeGreaterThanOrEqual(TYPE_MIN);
  });
});

describe('Field', () => {
  it('holds the 16px floor against a caller trying to lower it', async () => {
    // Under 16px iOS zooms on focus and never zooms back, stranding someone
    // mid-form at 1.3x. The floor is applied after the caller's style.
    const view = await render(
      <Field label="Current mileage" value="48210" style={{ fontSize: 11 }} />
    );
    const style = flat(view.getByLabelText('Current mileage').props.style);

    expect(style.fontSize).toBe(FIELD_FONT_MIN);
  });

  it('names the input by its visible label, not its placeholder', async () => {
    // VoiceOver reads a placeholder as the field's *value* when empty, and it
    // disappears once someone types.
    const view = await render(<Field label="VIN" placeholder="17 characters" value="" />);

    expect(view.getByLabelText('VIN')).toBeTruthy();
  });

  it('describes a problem rather than only colouring the edge', async () => {
    const view = await render(
      <Field label="VIN" value="JF1VA1E6XJ98" problem="A VIN is 17 characters. This one has 12." />
    );

    expect(view.getByText(/17 characters/)).toBeTruthy();
    expect(view.getByLabelText('VIN').props['aria-invalid']).toBe(true);
  });
});

describe('AlertBanner', () => {
  it('announces headline and body as one utterance', async () => {
    const view = await render(
      <AlertBanner tone="critical" headline="Do not drive" body="Fuel pump assembly" />
    );

    expect(view.getByLabelText('Do not drive. Fuel pump assembly')).toBeTruthy();
    expect(view.getByLabelText('Do not drive. Fuel pump assembly').props.accessibilityRole).toBe(
      'alert'
    );
  });
});

describe('ListRow', () => {
  it('renders a missing value as an em dash rather than dropping the row', async () => {
    /*
      If the row exists, its label is a promise that the fact is tracked.
      Dropping it silently rewrites what the product claims to know.
    */
    const view = await render(<ListRow label="Average per month" value={null} />);

    expect(view.getByText('—')).toBeTruthy();
    expect(view.getByText('Average per month')).toBeTruthy();
  });

  it('reads a tappable row as one sentence', async () => {
    const view = await render(
      <ListRow label="Mileage" value="66,000 mi" detail="Read 4 days ago" onPress={jest.fn()} />
    );

    expect(view.getByLabelText('Mileage, 66,000 mi, Read 4 days ago')).toBeTruthy();
  });
});

describe('ProvenanceRow', () => {
  it('says "Based on", never "Sources"', async () => {
    const view = await render(<ProvenanceRow kinds={['service history', 'open recalls']} />);

    expect(view.getByText(/^Based on/)).toBeTruthy();
    expect(view.queryByText(/Sources/)).toBeNull();
  });

  it('is never confirm-coloured, because nothing here is verified', async () => {
    // A green badge beside a generated answer reads as verified. It is a quiet
    // line of muted text on purpose, and deliberately not a Chip.
    const view = await render(<ProvenanceRow kinds={['service history']} />);
    const style = flat(view.getByText(/^Based on/).props.style);

    expect(style.color).toBe(text.muted);
  });

  it('renders nothing when there is no provenance to state', async () => {
    const view = await render(<ProvenanceRow kinds={[]} />);

    expect(view.queryByText(/Based on/)).toBeNull();
  });
});

describe('pressed states', () => {
  /*
    ⚠ Only one of these three claims can be made here, and the missing two are
    the interesting ones.

    React Native's `Pressable` drives its pressed state through `usePressability`
    and the responder system, not through a prop this runner can fire at: a
    synthetic `pressIn` on the host node leaves `style` resolved for
    `pressed: false`, so the tree only ever shows the resting state. Measured —
    both a `props.style` read and a `fireEvent(row, 'pressIn')` returned the
    resting value.

    So "a pressed style must change something" lives in
    `lib/__tests__/mobile-pressed-states.test.ts` as a source rule instead. That
    is a weaker kind of check and it is the kind available: the defect it exists
    for — `ListRow`'s `pressed: { opacity: 1 }`, a declaration that changes
    nothing while looking like feedback — is visible in source and invisible
    here.
  */
  it('leaves an untappable row alone', async () => {
    // No handler, no button role, and nothing to acknowledge.
    const view = await render(<ListRow label="Mileage" value="66,000 mi" />);

    expect(view.queryByRole('button')).toBeNull();
  });

  it('gives a tappable one the role that says it can be pressed', async () => {
    const view = await render(<ListRow label="Mileage" value="66,000 mi" onPress={jest.fn()} />);

    expect(view.getByRole('button')).toBeTruthy();
  });
});

describe('Button — the inverse variant', () => {
  /*
    The treatment that lived as a private copy in six screens before it was a
    variant: sign-in, add-vehicle, the wishlist, the advisor, the invoice scan
    and the service milestone. Four tokens existed for it and no primitive
    owned any of them, so the copies drifted — 15pt against 16, weight 600
    against 700, letter-spacing on some and not others — on the app's most
    important control.
  */
  it('wears the light fill a control that outranks everything gets', async () => {
    const view = await render(
      <Button label="Sign in" variant="inverse" onPress={jest.fn()} />
    );

    expect(flat(view.getByLabelText('Sign in').props.style).backgroundColor).toBe(
      surface.inverse
    );
  });

  it('stays light when disabled, and keeps its ink dark', async () => {
    /*
      ⚠ The defect the rendered contrast suite caught within a minute of this
      variant existing. The first version muffled the label to
      `text.onInverseMuted`, which measures **4.17:1** on the disabled fill and
      failed both sign-in states.

      `surface.inverseDisabled`'s own note in the theme had the answer — it
      "keeps its ink near 9:1 while reading as off". The dimmed fill is the
      whole signal; the ink does not dim with it. WCAG 1.4.3 exempts disabled
      controls, and taking that exemption is how one becomes unreadable rather
      than unavailable.
    */
    const view = await render(
      <Button label="Sign in" variant="inverse" disabled onPress={jest.fn()} />
    );
    const control = view.getByLabelText('Sign in');

    expect(flat(control.props.style).backgroundColor).toBe(surface.inverseDisabled);
    expect(flat(control.props.style).opacity).toBeUndefined();
    expect(flat(view.getByText('Sign in').props.style).color).toBe(text.onInverse);
  });

  it('keeps its accessible name while working', async () => {
    // The label is swapped for a spinner, so a control named by its child goes
    // anonymous exactly when it has something to say.
    const view = await render(
      <Button label="Create account" variant="inverse" busy onPress={jest.fn()} />
    );

    const control = view.getByLabelText('Create account');
    expect(control.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
  });

  it('spins in ink that is visible on a white control', async () => {
    /*
      The platform default and `text.primary` are both white. On this fill that
      is a control which looks empty at exactly the moment it is working.
    */
    const view = await render(
      <Button label="Sign in" variant="inverse" busy onPress={jest.fn()} />
    );

    /*
      Walked out of the rendered tree rather than queried: RNTL v14 has no
      type query, and a spinner has no accessible name to find it by — which
      is the whole reason the *button* has to carry one.
    */
    const spinners: Array<Record<string, unknown>> = [];
    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      const host = node as { type?: unknown; props?: Record<string, unknown>; children?: unknown[] };
      if (typeof host.type === 'string' && host.type.includes('ActivityIndicator') && host.props) {
        spinners.push(host.props);
      }
      for (const child of host.children ?? []) walk(child);
    };
    walk(view.toJSON());

    expect(spinners).toHaveLength(1);
    expect(spinners[0].color).toBe(text.onInverse);
  });
});

describe('EmptyState', () => {
  /*
    Zero callers until 16 Aug, while four screens rolled their own — the garage,
    the advisor, service history and the wishlist, at three different title
    sizes.

    ⚠ The advisor's was the reason the gap survived an audit: it was a local
    function *named `EmptyState`*, shadowing the import that would have replaced
    it. A private copy called `emptyBlock` is easy to spot; one wearing the
    primitive's own name is invisible.
  */
  it('says what, says why, and offers the door', async () => {
    const onAction = jest.fn();
    const view = await render(
      <EmptyState
        headline="No vehicles yet"
        body="Add your first car and CrewChief gets to work on it."
        actionLabel="Add a car"
        onAction={onAction}
      />
    );

    view.getByText('No vehicles yet');
    view.getByText('Add your first car and CrewChief gets to work on it.');
    await userEvent.setup().press(view.getByLabelText('Add a car'));
    expect(onAction).toHaveBeenCalled();
  });

  it('lets the action carry its own spoken name', async () => {
    /*
      The garage needs it: the header already has an "Add a car" control, and
      two controls with the same spoken name on one screen are ambiguous to a
      screen reader in a way they are not to the eye, which has position to go
      on. The visible label stays short.
    */
    const view = await render(
      <EmptyState
        headline="No vehicles yet"
        body="Add your first car."
        actionLabel="Add a car"
        actionAccessibilityLabel="Add your first car"
        onAction={jest.fn()}
      />
    );

    view.getByLabelText('Add your first car');
    view.getByText('Add a car');
  });

  it('renders quiet extra content without turning it into controls', async () => {
    /*
      The advisor's three example questions. Its own note is the rule: they are
      examples, not prompts, and making them buttons would turn a conversation
      into a menu on the first screen a new user meets.
    */
    const view = await render(
      <EmptyState headline="Ask about this car" body="It already knows the history.">
        <Text>“What should I do at the next service?”</Text>
      </EmptyState>
    );

    view.getByText('“What should I do at the next service?”');
    expect(view.queryByRole('button')).toBeNull();
  });

  it('offers no door when there is nowhere to go', async () => {
    // Service history has no navigation callbacks, so an action there could
    // not lead anywhere. The body names the routes in instead.
    const view = await render(
      <EmptyState headline="Nothing recorded yet" body="Scan an invoice and it appears here." />
    );

    expect(view.queryByRole('button')).toBeNull();
  });
});
