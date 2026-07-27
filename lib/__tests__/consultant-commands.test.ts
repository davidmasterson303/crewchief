import {
  parseWishlistCommands,
  parsePerformanceCommands,
  parseStatusCommands,
  parseInvoiceFlag,
} from '@crewchief/core/consultant-commands';

describe('parseWishlistCommands', () => {
  it('parses a well-formed command and strips it from the response', () => {
    const r = 'Sure. [ADD_TO_WISHLIST: Brake pads | maintenance | Front axle set] Done.';
    const { commands, cleaned } = parseWishlistCommands(r);
    expect(commands).toEqual([{ name: 'Brake pads', type: 'maintenance', description: 'Front axle set' }]);
    expect(cleaned).not.toContain('ADD_TO_WISHLIST');
  });

  it('parses multiple commands', () => {
    const r = '[ADD_TO_WISHLIST: A1 | issue | d1][ADD_TO_WISHLIST: B2 | modification | d2]';
    expect(parseWishlistCommands(r).commands).toHaveLength(2);
  });

  it('ignores malformed tags but still strips them', () => {
    const r = 'text [ADD_TO_WISHLIST: only-one-field] more';
    const { commands, cleaned } = parseWishlistCommands(r);
    expect(commands).toHaveLength(0);
    expect(cleaned).not.toContain('ADD_TO_WISHLIST');
  });

  it('rejects single-character names (hallucination guard)', () => {
    const r = '[ADD_TO_WISHLIST: x | issue | desc]';
    expect(parseWishlistCommands(r).commands).toHaveLength(0);
  });
});

describe('parsePerformanceCommands', () => {
  it('parses numeric key=value pairs', () => {
    const r = '[UPDATE_PERFORMANCE_STATS: modified_hp=450 | modified_torque=430]';
    const { updates } = parsePerformanceCommands(r);
    expect(updates).toEqual([{ modified_hp: 450, modified_torque: 430 }]);
  });

  it('drops non-numeric values instead of writing NaN', () => {
    const r = '[UPDATE_PERFORMANCE_STATS: modified_hp=lots | modified_torque=400]';
    expect(parsePerformanceCommands(r).updates).toEqual([{ modified_torque: 400 }]);
  });

  it('emits nothing when no pair is valid', () => {
    const r = '[UPDATE_PERFORMANCE_STATS: hp=fast]';
    expect(parsePerformanceCommands(r).updates).toHaveLength(0);
  });
});

describe('parseStatusCommands', () => {
  it('accepts only whitelisted statuses', () => {
    const r = '[UPDATE_ISSUE_STATUS: Valve cover gasket|completed][UPDATE_ISSUE_STATUS: Rod bearings|deleted_everything]';
    const { commands } = parseStatusCommands(r, 'UPDATE_ISSUE_STATUS');
    expect(commands).toEqual([{ identifier: 'Valve cover gasket', status: 'completed' }]);
  });

  it('skips too-short identifiers', () => {
    const r = '[UPDATE_MOD_STATUS: %|completed]';
    expect(parseStatusCommands(r, 'UPDATE_MOD_STATUS').commands).toHaveLength(0);
  });

  it('always strips tags from the visible response', () => {
    const r = 'Marked done. [UPDATE_MOD_STATUS: Intake|completed]';
    const { cleaned } = parseStatusCommands(r, 'UPDATE_MOD_STATUS');
    expect(cleaned).toBe('Marked done.');
  });
});

describe('parseInvoiceFlag', () => {
  it('detects and strips the flag', () => {
    const { flagged, cleaned } = parseInvoiceFlag('Processing now [PROCESS_INVOICE]');
    expect(flagged).toBe(true);
    expect(cleaned).toBe('Processing now');
  });

  it('is false when absent', () => {
    expect(parseInvoiceFlag('hello').flagged).toBe(false);
  });
});
