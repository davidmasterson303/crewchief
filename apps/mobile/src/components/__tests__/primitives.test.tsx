import { render, userEvent } from '@testing-library/react-native';

import AlertBanner from '../AlertBanner';
import Button from '../Button';
import Chip from '../Chip';
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
