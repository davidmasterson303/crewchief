import { useEffect } from 'react';
import { Linking } from 'react-native';
import { NavigationContainer, type LinkingOptions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import {
  configureNotificationHandler,
  initialNotificationUrl,
  subscribeToNotificationTaps,
} from '../notifications/push';
import { currentPushPermission, registerForPush } from '../notifications/register';
import { shouldRegisterSilently } from '@crewchief/core/push-priming';

import { AdvisorScreen } from '../screens/AdvisorScreen';
import { InvoiceScanScreen } from '../screens/InvoiceScanScreen';
import { RecallDetailScreen } from '../screens/RecallDetailScreen';
import { WishlistScreen } from '../screens/WishlistScreen';
import { ServiceHistoryScreen } from '../screens/ServiceHistoryScreen';
import { ServiceMilestoneScreen } from '../screens/ServiceMilestoneScreen';
import { pickInvoiceImage } from '../media/pick-invoice-image';
import { GarageScreen } from '../screens/GarageScreen';
import { AddVehicleScreen } from '../screens/AddVehicleScreen';
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
    8 Aug, mobile-first. There was no way to add a car on the phone — the garage
    empty state told people to go and use the web app. Deliberately not
    deep-linkable: a URL that opens a form which creates a row is a URL that can
    be put in front of someone who did not mean to.
  */
  AddVehicle: undefined;
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
  /*
    `ask` lets a link arrive with a question already in hand.

    Product, not scaffolding: the recall notification this app sends says "Tap
    to ask the advisor what it means", and until now tapping it opened an empty
    composer and left the person to retype the question the notification had
    just posed. A push that promises an answer should deliver the question.

    It also removes a real testing blocker — the advisor was the one flow that
    could not be exercised without a human typing, and synthetic keystrokes do
    not reach a React Native `TextInput`.
  */
  Advisor: { vehicleId: string; title?: string; ask?: string };
  /*
    3.3. Linked from the vehicle detail screen since 5 Aug, once build
    `29b4d76f` put `expo-image-picker` in the binary. Held back until then on
    purpose: a visible "Scan an invoice" button that cannot open a camera is
    worse than no button, and the screen was reachable by deep link in the
    meantime so it could still be rendered and reviewed.
  */
  InvoiceScan: { vehicleId: string; title?: string };
  /*
    5.6. Where a recall notification lands. It used to open the advisor with
    the question pre-typed, which explained a notice well and gave no way to
    act on it — David's call on 7 Aug was that driving an action is the point.
    The advisor is still reachable from here, per recall.
  */
  RecallDetail: { vehicleId: string; title?: string };
  /*
    5.6, and the one route here that widens the mobile surface rather than
    completing a flow. `cc-product-0001` makes mobile three flows and defaults
    new features to `mobile: n/a`; David agreed to the widening on 7 Aug —
    "people may want to add items to wishlist on the go."
  */
  Wishlist: { vehicleId: string; title?: string };
  ServiceHistory: { vehicleId: string; title?: string };
  /*
    5.6. Where a service-due notification lands. It opened the vehicle screen
    until 7 Aug, on the reasoning that "your oil change is due" needs no
    explaining — true, and it left nowhere to *act*. This screen confirms the
    odometer first, then states the milestone, then offers each job to the
    wishlist.
  */
  ServiceMilestone: { vehicleId: string; title?: string };
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
      InvoiceScan: 'vehicle/:vehicleId/scan',
      RecallDetail: 'vehicle/:vehicleId/recalls',
      Wishlist: 'vehicle/:vehicleId/wishlist',
      ServiceHistory: 'vehicle/:vehicleId/history',
      ServiceMilestone: 'vehicle/:vehicleId/service',
    },
  },

  /*
    ── Phase 5: a tapped notification is a deep link ──────────────────────────

    Both overrides exist so push routing reuses the table above rather than
    growing a second one. A route added to `screens` is reachable from a
    notification without anyone remembering a mapping — the same argument as
    the shared core modules, applied to navigation.

    `getInitialURL` covers the **cold start**, which is the journey that gets
    missed: an app opened *by* the tap has no `Linking` url, because it was not
    opened by a link. Omitting this is the classic push bug — alerts route
    perfectly while backgrounded and do nothing at all from cold.

    The link is checked first. If both are present the user arrived by link
    and that is the more recent intent.
  */
  async getInitialURL() {
    return (await Linking.getInitialURL()) ?? (await initialNotificationUrl());
  },

  subscribe(listener) {
    const link = Linking.addEventListener('url', ({ url }) => listener(url));
    const tap = subscribeToNotificationTaps(listener);

    return () => {
      link.remove();
      tap();
    };
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
  /*
    Configured here rather than in `App.tsx` because this component only mounts
    once someone is signed in — and an alert about a recall is meaningless to a
    device with no garage. The permission prompt's *placement* is a product
    decision with a note against it in `notifications/push.ts`: iOS allows it
    once, so it deserves an explaining screen before submission.
  */
  useEffect(() => {
    configureNotificationHandler();

    /*
      ── C5: the system prompt is no longer raised from here ──────────────────

      This used to call `registerForPush()`, which asks iOS for permission as
      its first act. iOS shows that dialog **exactly once** and a "no" can only
      be undone in Settings — so the one irreversible ask was being spent on
      entry to the signed-in stack, before the person had seen what the product
      does. The most likely answer to a dialog you did not expect is no.

      Now: a device that **already** has permission still registers silently,
      because its token must be filed against the account and there is nothing
      to explain. Everyone else is offered `PushPrimer` first — see
      `GarageScreen`, which is where the vehicle count that gates it lives.

      `shouldRegisterSilently` and `shouldShowPushPrimer` are complementary by
      construction and there is a test asserting they can never both be true.
    */
    void (async () => {
      if (shouldRegisterSilently(await currentPushPermission())) {
        void registerForPush();
      }
    })();
  }, []);

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
              onAddVehicle={() => navigation.navigate('AddVehicle')}
            />
          )}
        </Stack.Screen>

        <Stack.Screen name="AddVehicle" options={{ title: 'Add a car' }}>
          {({ navigation }) => (
            <AddVehicleScreen
              onSignOut={onSignOut}
              /*
                `replace`, not `navigate`. Going back to a form that has already
                created the car would let someone add it twice, and the natural
                place to go from a new car is the car.
              */
              onAdded={(vehicleId, title) =>
                navigation.replace('VehicleDetail', { vehicleId, title })
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
              onScanInvoice={() =>
                navigation.navigate('InvoiceScan', {
                  vehicleId: route.params.vehicleId,
                  title: route.params.title,
                })
              }
              onViewRecalls={() =>
                navigation.navigate('RecallDetail', {
                  vehicleId: route.params.vehicleId,
                  title: route.params.title,
                })
              }
              onOpenWishlist={() =>
                navigation.navigate('Wishlist', {
                  vehicleId: route.params.vehicleId,
                  title: route.params.title,
                })
              }
              onOpenHistory={() =>
                navigation.navigate('ServiceHistory', {
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
            <AdvisorScreen
              vehicleId={route.params.vehicleId}
              /*
                React Navigation maps a query string onto params, so
                `crewchief://vehicle/<id>/advisor?ask=...` arrives here already
                decoded.
              */
              initialQuestion={route.params.ask}
              onSignOut={onSignOut}
            />
          )}
        </Stack.Screen>

        <Stack.Screen
          name="RecallDetail"
          options={{ title: 'Recalls' }}
        >
          {({ route, navigation }) => (
            <RecallDetailScreen
              vehicleId={route.params.vehicleId}
              title={route.params.title}
              onSignOut={onSignOut}
              onAskAdvisor={(vehicleId, ask) =>
                navigation.navigate('Advisor', {
                  vehicleId,
                  title: route.params.title,
                  ask,
                })
              }
            />
          )}
        </Stack.Screen>

        <Stack.Screen
          name="Wishlist"
          options={{ title: 'Wishlist' }}
        >
          {({ route }) => (
            <WishlistScreen vehicleId={route.params.vehicleId} onSignOut={onSignOut} />
          )}
        </Stack.Screen>

        <Stack.Screen
          name="ServiceHistory"
          options={{ title: 'Service history' }}
        >
          {({ route }) => (
            <ServiceHistoryScreen vehicleId={route.params.vehicleId} onSignOut={onSignOut} />
          )}
        </Stack.Screen>

        <Stack.Screen
          name="ServiceMilestone"
          options={{ title: 'Service due' }}
        >
          {({ route }) => (
            <ServiceMilestoneScreen vehicleId={route.params.vehicleId} onSignOut={onSignOut} />
          )}
        </Stack.Screen>

        <Stack.Screen
          name="InvoiceScan"
          options={{ title: 'Scan an invoice' }}
        >
          {({ route }) => (
            <InvoiceScanScreen
              vehicleId={route.params.vehicleId}
              /*
                The seam. `pick-invoice-image.ts` is the only module that will
                import expo-image-picker, so this screen stays free of native
                imports and one file changes when the build lands.
              */
              pickImage={pickInvoiceImage}
              onSignOut={onSignOut}
            />
          )}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  );
}
