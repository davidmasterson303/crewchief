import { NavigationContainer, type LinkingOptions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AdvisorScreen } from '../screens/AdvisorScreen';
import { GarageScreen } from '../screens/GarageScreen';
import { VehicleDetailScreen } from '../screens/VehicleDetailScreen';

/**
 * The signed-in stack. Phase 3 task 3.5, pulled forward.
 *
 * ── Why this exists before the screens that need it ─────────────────────────
 *
 * The plan sizes navigation at 0.5 ed and puts it last, which reads as polish.
 * It is not: the garage rows were not tappable and there was nowhere to tap
 * *to*, so 3.2 has been half-built — a list with no detail — and 3.3 and 3.4
 * are a camera flow and a conversation thread, both of which need push and
 * back. Ad-hoc booleans were fine for one modal and are not a stack.
 *
 * The timing is the other half. `react-native-screens` and
 * `react-native-safe-area-context` are **native** modules, so they have to be
 * present when the app is compiled. Adding navigation after the first EAS
 * build would cost a second build out of a monthly allowance of fifteen.
 *
 * ── Why the screens do not import this file ─────────────────────────────────
 *
 * `GarageScreen` takes an `onOpenVehicle` callback rather than a `navigation`
 * prop, and `VehicleDetailScreen` takes `vehicleId` and `onBack`. So neither
 * knows react-navigation exists: they stay ordinary components that can be
 * rendered and reasoned about on their own, and swapping the navigator later
 * touches this file only.
 *
 * ── What is deliberately not a route ────────────────────────────────────────
 *
 * The account surface. It is a modal inside `GarageScreen`, one tap from the
 * only screen a signed-in user sees, and App Store 5.1.1(v) is the reason it
 * is one tap rather than buried. Promoting it to a route would add a screen to
 * the stack to reach it and churn code that already works and was verified
 * against the deletion cascade on 1 Aug.
 *
 * ── The token is not a route param, and that is not an oversight ────────────
 *
 * `apiRequest` fetches the live session per call, so no screen needs a token
 * passed to it. Navigation params are serialisable state — they show up in
 * devtools and in any persisted navigation state — which makes them the wrong
 * place for a credential even when it would be convenient. Only `vehicleId`
 * and a title travel, and neither is a secret.
 */

export type RootStackParamList = {
  Garage: undefined;
  /*
    `title` is optional because a deep link cannot supply one — see `linking`
    below. It stays a param rather than being dropped: a tap from the garage
    already knows the car's name, and passing it means the header is correct
    during the fetch instead of appearing a second later. A link falls back.
  */
  VehicleDetail: { vehicleId: string; title?: string };
  /*
    3.4. Pushed from the detail screen rather than the garage, because the
    advisor answers about *one* car — `/api/v1/consultant` requires a
    `vehicleId` and authorizes against it — so there is no sensible advisor
    route without a vehicle already chosen.

    `title` travels for the same reason it does above: the header should name
    the car during the first request rather than after it. Neither param is a
    secret; the token still is not one, and still is not here.
  */
  Advisor: { vehicleId: string; title?: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Deep links into a specific car, and into its advisor.
 *
 * ── Why this exists, stated honestly ────────────────────────────────────────
 *
 * The immediate reason is verification. This project's most expensive recurring
 * failure is a screen that typechecks, bundles, passes every test and **has
 * never been rendered** — the 4 Aug handoff records three of those in one day,
 * and both of these screens were written before anything could open them. A
 * stack you can only reach by tapping is a stack that only gets exercised when
 * someone is holding the phone.
 *
 * With this, `xcrun simctl openurl booted "crewchief://vehicle/<id>/advisor"`
 * opens the screen directly, so it can be looked at in the state that matters
 * without a session, a garage row and two taps standing in front of it.
 *
 * It is also ordinary product functionality rather than test scaffolding, which
 * is the reason it is wired here rather than hacked in behind `__DEV__`: the
 * scheme is already declared in `app.json`, push notifications and emailed
 * links both land on exactly these two routes, and the alternative — a
 * temporary `initialRouteName` edited in and out whenever something needs
 * looking at — is throwaway work that leaves nothing behind.
 *
 * ── What is deliberately not linkable ───────────────────────────────────────
 *
 * The account surface. It is a modal inside `GarageScreen`, and deletion is
 * behind it (5.1.1(v)) — a URL that opens the delete-my-account screen is a URL
 * that can be put in front of someone who did not mean to go there.
 *
 * ── The dev client owns one path and it is not one of these ─────────────────
 *
 * `expo-dev-client` answers `crewchief://expo-development-client/?url=…`, which
 * is how the simulator build is pointed at Metro. Nothing here claims that
 * path, and the two coexist because the prefix is shared but the host is not.
 *
 * ── A link cannot carry a title, and must not ───────────────────────────────
 *
 * `title` is a convenience the garage row supplies because it has already drawn
 * the car's name. A URL knows only the id, so both screens fall back rather
 * than rendering "undefined" in the header. Putting the name in the URL would
 * be worse than a fallback: it is the car's identity in a string anything can
 * log, and the server is going to send the real one back within the second.
 */
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['crewchief://'],
  config: {
    screens: {
      Garage: 'garage',
      VehicleDetail: 'vehicle/:vehicleId',
      Advisor: 'vehicle/:vehicleId/advisor',
    },
  },
};

/** What the header shows before the vehicle has loaded, or when a link brought us here. */
const UNTITLED = 'Vehicle';

const screenOptions = {
  headerStyle: { backgroundColor: '#080808' },
  headerTintColor: '#ffffff',
  headerTitleStyle: { color: '#ffffff' },
  contentStyle: { backgroundColor: '#080808' },
} as const;

export function RootNavigator({
  accessToken,
  email,
  onSignOut,
}: {
  accessToken: string;
  email: string | null;
  onSignOut: () => void;
}) {
  return (
    <NavigationContainer linking={linking}>
      <Stack.Navigator screenOptions={screenOptions}>
        <Stack.Screen name="Garage" options={{ headerShown: false }}>
          {({ navigation }) => (
            <GarageScreen
              accessToken={accessToken}
              email={email}
              onSignOut={onSignOut}
              onOpenVehicle={(vehicleId, title) =>
                navigation.navigate('VehicleDetail', { vehicleId, title })
              }
            />
          )}
        </Stack.Screen>

        <Stack.Screen
          name="VehicleDetail"
          /*
            The title is passed from the row rather than read from the loaded
            vehicle, so the header is correct during the fetch instead of
            appearing a second later. The row already knows the car's name —
            it just drew it.

            A deep link has no name to pass, so it falls back rather than
            rendering "undefined" in the header.
          */
          options={({ route }) => ({ title: route.params.title || UNTITLED })}
        >
          {({ route, navigation }) => (
            <VehicleDetailScreen
              vehicleId={route.params.vehicleId}
              onSignOut={onSignOut}
              onBack={() => navigation.goBack()}
              onAskAdvisor={() =>
                navigation.navigate('Advisor', {
                  vehicleId: route.params.vehicleId,
                  title: route.params.title,
                })
              }
            />
          )}
        </Stack.Screen>

        <Stack.Screen
          name="Advisor"
          /*
            "Advisor · M235i" rather than the car's name alone, which would
            read as a second copy of the screen behind it. Arriving by link
            there is no name yet, and "Advisor · Vehicle" reads like a bug — so
            the qualifier is dropped entirely rather than filled with a
            placeholder.
          */
          options={({ route }) => ({
            title: route.params.title ? `Advisor · ${route.params.title}` : 'Advisor',
          })}
        >
          {({ route }) => (
            <AdvisorScreen vehicleId={route.params.vehicleId} onSignOut={onSignOut} />
          )}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  );
}
