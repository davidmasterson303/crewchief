import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon, { type IconName } from '../components/Icon';
import { TARGET_MIN, border, brand, space, surface, text, type } from '../theme';

export type TabName = 'Garage' | 'Advisor' | 'Account';

const TABS: ReadonlyArray<{ name: TabName; label: string; icon: IconName }> = [
  { name: 'Garage', label: 'Garage', icon: 'car' },
  { name: 'Advisor', label: 'Advisor', icon: 'message-square' },
  { name: 'Account', label: 'Account', icon: 'sliders' },
];

/**
 * ── R13 · three destinations, always in reach ───────────────────────────────
 *
 * **The advisor is the product.** "AI auto-ownership consultant" is what this
 * app is, and it shipped as a *leaf screen pushed off a car* — so asking a
 * question meant opening the garage, choosing a car, scrolling a hub and
 * pressing a button. Three navigations to reach the thing the product is named
 * for.
 *
 * **Account was a text link in the garage header**, and account deletion is
 * required by App Store 5.1.1(v) to be reachable — which
 * `mobile-account-reachable.test.ts` had already caught being lost in a loading
 * state once. On the bar it is reachable by construction rather than by
 * remembering to render it.
 *
 * ── ⚠ Why this is not `@react-navigation/bottom-tabs` ───────────────────────
 *
 * That package is JS-only, so it would cost no EAS build — but installing it
 * runs an install across this workspace, and `package.json`'s own notes record
 * what that has cost here before: a full workspace install hoists `apps/mobile`'s
 * jest 29 to the root and splits the web app's jest 30 across two trees, which
 * killed **every** web suite before its first test with a `TypeError` nobody
 * could place. The pins exist to stop that by construction.
 *
 * What bottom-tabs buys over this is **per-tab stacks**: each tab remembering
 * its own history. That is real, and it is not what R13 is about — the finding
 * is that the advisor and the account are unreachable, and a bar that navigates
 * on one stack fixes that completely. When a tab genuinely needs its own
 * history, that is the moment to spend the install and verify it with
 * `rm -rf node_modules && npm ci`.
 *
 * ── It is in the layout, not over it ────────────────────────────────────────
 *
 * A bar floating above the content would cover the last row of every list — the
 * same argument `native-wishlist.spec.html` makes against a floating action
 * button. It takes its 49pt out of the frame instead, which the review costed
 * explicitly against the pinned hero and judged worth it.
 */
export default function TabBar({
  current,
  onSelect,
}: {
  /** The route the stack is currently showing, so the bar can mark itself. */
  current: TabName;
  onSelect: (tab: TabName) => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.sm) }]}
      accessibilityRole="tablist"
      accessibilityLabel="Main"
    >
      {TABS.map((tab) => {
        const selected = tab.name === current;

        return (
          <Pressable
            key={tab.name}
            onPress={() => onSelect(tab.name)}
            accessibilityRole="tab"
            /*
              ⚠ `selected` is announced; the tint alone is not. A bar whose
              current position is carried entirely by a colour is unusable to
              anyone who cannot separate the two, and this bar is how the app is
              navigated.
            */
            accessibilityState={{ selected }}
            accessibilityLabel={tab.label}
            style={styles.tab}
          >
            <Icon
              name={tab.icon}
              size={22}
              color={selected ? brand.accent : text.muted}
            />
            <Text style={[styles.label, selected && styles.labelOn]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: surface.nav,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: border.panel,
    paddingTop: space.sm,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minHeight: TARGET_MIN,
  },
  label: { ...type.label, letterSpacing: 0, color: text.muted },
  labelOn: { color: brand.accent },
});
