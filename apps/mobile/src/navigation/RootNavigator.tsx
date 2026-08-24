import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import {
  NavigationContainer,
  useNavigationContainerRef,
  type LinkingOptions,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import {
  configureNotificationHandler,
  initialNotificationUrl,
  subscribeToNotificationTaps,
} from '../notifications/push';
import { currentPushPermission, registerForPush } from '../notifications/register';
import { shouldRegisterSilently } from '@crewchief/core/push-priming';

import { AdvisorScreen } from '../screens/AdvisorScreen';
import { HealthScreen } from '../screens/HealthScreen';
import { InvoiceScanScreen } from '../screens/InvoiceScanScreen';
import { WishlistAddScreen } from '../screens/WishlistAddScreen';
import { pickInvoiceImage, pickVehiclePhoto } from '../media/pick-image';
import { GarageScreen } from '../screens/GarageScreen';
import { AddVehicleScreen } from '../screens/AddVehicleScreen';
import { VehicleDetailScreen } from '../screens/VehicleDetailScreen';
import { AccountScreen } from '../screens/AccountScreen';
import TabBar, { type TabName } from './TabBar';
import { PlanScreen, type PlanSegment } from '../screens/PlanScreen';
import { ServiceScreen, type ServiceSegment } from '../screens/ServiceScreen';
import { VehicleProfileScreen } from '../screens/VehicleProfileScreen';
import Icon from '../components/Icon';
import { surface, text } from '../theme';

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
  /*
    ⚠ **R16: this route renders `HealthScreen`.** It is kept as a name because
    shipped notifications carry `crewchief://vehicle/<id>/recalls`, and a link
    an installed build already sends has to keep resolving.

    What it no longer is, is a destination. Recalls drive the score, the garage
    bay banners the count and the hub banners the worst one — a top-level screen
    for two items already surfaced twice was a third path to the same content,
    and it put the cause a navigation away from the effect. `HealthScreen` shows
    them under the dial they move.
  */
  RecallDetail: { vehicleId: string; title?: string };
  /*
    5.6, and the one route here that widens the mobile surface rather than
    completing a flow. `cc-product-0001` makes mobile three flows and defaults
    new features to `mobile: n/a`; David agreed to the widening on 7 Aug —
    "people may want to add items to wishlist on the go."
  */
  /**
   * ── R15 · Plan — needs and mods, one destination ──────────────────────────
   *
   * Replaces `Wishlist` and `Build`, which were two hub rows answering one
   * question. `PlanScreen` carries the argument; the short version is that a
   * charge pipe is both a known failure and the first mod anyone fits, and two
   * lists made the owner file it before they could find it.
   */
  Plan: { vehicleId: string; title?: string; segment?: PlanSegment };
  /*
    5.6. Where a service-due notification lands. It opened the vehicle screen
    until 7 Aug, on the reasoning that "your oil change is due" needs no
    explaining — true, and it left nowhere to *act*. This screen confirms the
    odometer first, then states the milestone, then offers each job to the
    wishlist.
  */
  /**
   * ── R14 · Service — what is due, and what has been done ───────────────────
   *
   * Replaces `ServiceMilestone` and `ServiceHistory`. The path stays
   * `vehicle/:vehicleId/service` because that is what shipped service-due
   * notifications carry.
   */
  Service: { vehicleId: string; title?: string; segment?: ServiceSegment };
  /*
    ── 23 Aug: two instruments became two destinations ──────────────────────

    Both were cards on `VehicleDetailScreen`, and between them they were most of
    why David's read of that screen was *"unclear, cluttered, uninspired and
    confusing"*. The design system's native vehicle spec is **"a hub, not
    tabs"**: the vehicle screen names a car and lists places to go, and every
    section is a real pushed route with the platform's own back gesture.

    `Build` is the sharper case. Its card rendered a dial reading Stock and the
    five-rung ladder with a marker on one rung — while `nextRungs` was handing
    it three named parts, each with a difficulty and a sentence explaining why
    it comes before the others. Nothing on the card could be pressed. The route
    exists so those three suggestions can be read, added to the wishlist, or
    declined, which is what a plan is.
  */
  Health: { vehicleId: string; title?: string };
  /**
   * The account, and it is a **route** as of 23 Aug (R13).
   *
   * ⚠ It was a modal owned by `GarageScreen`, which made "account deletion is
   * one tap from the garage" a thing somebody had to remember to render on
   * every return path — `mobile-account-reachable.test.ts` exists because that
   * was got wrong once already. As a destination on the bar it is one tap from
   * **every** screen, and App Store 5.1.1(v) is satisfied structurally rather
   * than by vigilance.
   */
  Account: undefined;
  /*
    The wishlist's catalogue — `native-wishlist.spec.html` puts Add in the nav
    bar, and a nav-bar `+` implies a destination rather than a sheet. The
    content earns one: a filter field, a scrolling list of everything the
    research found, and two controls per row do not belong stacked above the
    list they add to.

    ⚠ Not deep-linkable, for the same reason `AddVehicle` is not: a URL that
    opens a form which writes rows is a URL that can be put in front of someone
    who did not mean to open it.
  */
  WishlistAdd: { vehicleId: string; title?: string };
  /*
    The owner's four onboarding answers, editable. Not deep-linkable for the
    same reason `AddVehicle` is not: a URL that opens a form which writes rows
    is a URL that can be put in front of someone who did not mean to open it.
  */
  VehicleProfile: { vehicleId: string; title?: string };
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
    /*
      ── ⚠ MOB-07 · a cold-start notification tap trapped the user ────────────

      Without this, a link opened from a **cold start** produces a stack with
      **exactly one route**: no back button, the edge-swipe gesture does
      nothing, `goBack()` is a no-op, and there is no tab bar underneath. The
      only way out is force-quitting the app.

      That is the flagship path. A recall notification says *"Tap to see what it
      means"*, and this product delivered its first real ones on 16 Aug — so the
      journey most likely to be somebody's first is the one with no exit.

      `initialRouteName` tells React Navigation to seed the stack with the
      garage *underneath* the linked screen, so the back button and the gesture
      both work and land somewhere that makes sense. It costs one line and it
      changes nothing about a warm open, where the stack already exists.
    */
    initialRouteName: 'Garage',
    screens: {
      Garage: 'garage',
      VehicleDetail: 'vehicle/:vehicleId',
      Advisor: 'vehicle/:vehicleId/advisor',
      InvoiceScan: 'vehicle/:vehicleId/scan',
      /*
        ⚠ Kept, and it renders `HealthScreen` — see the route's own note.
        Installed builds send this path in recall notifications.
      */
      RecallDetail: 'vehicle/:vehicleId/recalls',
      /* Kept: service-due notifications send this path. */
      Service: 'vehicle/:vehicleId/service',
      Plan: 'vehicle/:vehicleId/plan',
      Health: 'vehicle/:vehicleId/health',
      Account: 'account',
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

const screenOptions = {
  headerStyle: { backgroundColor: surface.page },
  headerTintColor: text.primary,
  headerTitleStyle: { color: text.primary },
  contentStyle: { backgroundColor: surface.page },
} as const;

/**
 * The label a pushed screen's back button carries.
 *
 * ⚠ **A screen with `headerShown: false` and no `title` publishes its route
 * name.** native-stack takes the back label from the previous screen's `title`
 * and falls back to `route.name` when there is none — so hiding a header does
 * not remove that screen from the header of the next one, it only removes the
 * value it would have used. `VehicleDetail` hid its header on 23 Aug for the
 * hero pullback, and six screens pushed from it have read `‹ VehicleDetail`
 * ever since: a class name, in the product's voice, on the most-travelled back
 * button in the app.
 *
 * So `title` is still set below. It draws nothing — the header is off — and
 * does exactly one job, which is this label.
 *
 * ── Why the year comes off ──────────────────────────────────────────────────
 *
 * The title is `[year, make, model].join(' ')`, and "2015 BMW M235i" is past
 * what iOS will render in a back button: it silently collapses to "Back", which
 * is correct but says nothing. Dropping the leading year leaves "BMW M235i",
 * which fits and still names the car.
 *
 * Only a leading four-digit year is removed, and nothing else is guessed at.
 * Taking the last word instead would give "Cherokee" for a Grand Cherokee — the
 * kind of cleverness that is invisible until it is wrong on somebody's car.
 */
export function carBackTitle(title: string | undefined): string {
  const named = title?.trim();
  if (!named) return 'Vehicle';

  return named.replace(/^\d{4}\s+/, '') || named;
}

/**
 * The most recently opened car, for the Advisor tab — R13.
 *
 * ⚠ **Module state, deliberately, and it does not persist.** The advisor needs
 * a `vehicleId`; the tab bar has none, and threading one through the navigation
 * tree would make every screen carry a value only the bar reads.
 *
 * A cold start has no last car and falls back to the garage, which is correct
 * rather than a limitation: choosing a car is a real step and guessing at one —
 * the first in the list, the last one persisted, whatever — would open the
 * advisor about somebody else's vehicle in a two-car garage. §10.
 */
let lastOpenedVehicle: { vehicleId: string; title?: string } | null = null;

export function rememberVehicle(vehicleId: string, title?: string) {
  lastOpenedVehicle = { vehicleId, title };
}

function lastVehicle() {
  return lastOpenedVehicle;
}

/**
 * Which tab a route belongs to.
 *
 * ⚠ Everything pushed off the garage — a car, its plan, its service, the scan —
 * is still *the garage tab*, and the bar has to keep saying so. A bar that went
 * blank three screens in would read as having lost its place, which is the
 * failure mode of every hand-rolled tab bar.
 */
function tabFor(route: string | undefined): TabName {
  if (route === 'Advisor') return 'Advisor';
  if (route === 'Account') return 'Account';
  return 'Garage';
}

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
    The container ref, so the tab bar can navigate and can read where it is.
    `useNavigationContainerRef` rather than a plain ref: it is the typed one and
    it is safe to call before the container is ready.
  */
  const navigation = useNavigationContainerRef<RootStackParamList>();
  const [route, setRoute] = useState<string | undefined>(undefined);

  /**
   * Where the stack is, and which car it is about.
   *
   * ⚠ **Both, in one place.** `rememberVehicle` used to be called only from the
   * garage's row, which meant a **deep link** — a recall notification, a
   * service-due alert, a `crewchief://vehicle/<id>` URL — put somebody on a car
   * without the Advisor tab learning which one, so the tab bounced them back to
   * the garage they had never been to.
   *
   * Reading it off the container covers every way a car can be reached, present
   * and future, because there is only one of them: the route being on screen.
   */
  const noteRoute = useCallback((current: { name: string; params?: object } | undefined) => {
    setRoute(current?.name);

    const params = current?.params as { vehicleId?: string; title?: string } | undefined;
    if (params?.vehicleId) rememberVehicle(params.vehicleId, params.title);
  }, []);

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
    <NavigationContainer
      ref={navigation}
      linking={linking}
      /*
        ── R13 · which tab the bar should mark ──────────────────────────────

        Read off the container rather than held as state by the bar, because the
        bar is not the only thing that navigates: a deep link, a notification
        tap and the back gesture all move the stack, and a bar that only knew
        about its own presses would mark the wrong tab after any of them.
      */
      onStateChange={() => noteRoute(navigation.getCurrentRoute())}
      onReady={() => noteRoute(navigation.getCurrentRoute())}
    >
      <View style={styles.frame}>
      <Stack.Navigator screenOptions={screenOptions}>
        {/*
          `title` with the header off is the back label and nothing else — see
          `carBackTitle`. "Garage" is what the route is called anyway, so this
          changes no pixel; it is here so the label is a decision rather than a
          coincidence that survives the next rename.
        */}
        <Stack.Screen name="Garage" options={{ headerShown: false, title: 'Garage' }}>
          {({ navigation }) => (
            <GarageScreen
              accessToken={accessToken}
              email={email}
              onSignOut={onSignOut}
              onOpenVehicle={(vehicleId, title) =>
                navigation.navigate('VehicleDetail', { vehicleId, title })
              }
              /*
                R21. The bay's next-service row was the most actionable string
                on the home screen and led nowhere. It opens what is due.
              */
              onOpenService={(vehicleId, title) =>
                navigation.navigate('Service', { vehicleId, title, segment: 'due' })
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
          /*
            ⚠ `headerShown: false` as of 23 Aug. The hero pullback pins a
            photograph at 62% of the display and the screen draws its **own**
            nav — floating pills over the car at rest, resolving into a solid
            plate once the sheet reaches them at 300pt of scroll. A stack header
            above that would be a second bar over a hero designed to run under
            the status bar.

            `title` still travels: the screen uses it for the nav title during
            the fetch, so the car is named before the payload lands. It stops
            being a navigator concern and starts being a prop.
          */
          /*
            `title` is the back label of every screen pushed from here, and
            nothing else — see `carBackTitle`. Without it these read
            `‹ VehicleDetail`.
          */
          options={({ route }) => ({
            headerShown: false,
            title: carBackTitle(route.params.title),
          })}
        >
          {({ route, navigation }) => (
            <VehicleDetailScreen
              title={route.params.title}
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
              /*
                ⚠ **R16.** The banner opens `Health`, not a recalls screen. The
                recalls are a section of it, under the dial they drive — cause
                beside effect rather than one navigation apart.
              */
              onViewRecalls={() =>
                navigation.navigate('Health', {
                  vehicleId: route.params.vehicleId,
                  title: route.params.title,
                })
              }
              /* R15. One destination, opening on the segment the row named. */
              onOpenWishlist={() =>
                navigation.navigate('Plan', {
                  vehicleId: route.params.vehicleId,
                  title: route.params.title,
                  segment: 'needs',
                })
              }
              /* R14. One destination, opening on the segment the row named. */
              onOpenHistory={() =>
                navigation.navigate('Service', {
                  vehicleId: route.params.vehicleId,
                  title: route.params.title,
                  segment: 'history',
                })
              }
              onOpenHealth={() =>
                navigation.navigate('Health', {
                  vehicleId: route.params.vehicleId,
                  title: route.params.title,
                })
              }
              onOpenMilestone={() =>
                navigation.navigate('Service', {
                  vehicleId: route.params.vehicleId,
                  title: route.params.title,
                  segment: 'due',
                })
              }
              onOpenProfile={() =>
                navigation.navigate('VehicleProfile', {
                  vehicleId: route.params.vehicleId,
                  title: route.params.title,
                })
              }
              // The same seam as the garage's. See `pick-image.ts`.
              pickPhoto={() => pickVehiclePhoto('library')}
            />
          )}
        </Stack.Screen>

        <Stack.Screen
          name="Advisor"
          /*
            ⚠ **`Advisor`, and nothing else, as of 23 Aug (R52).** It was
            `Advisor · 2015 BMW M235i`: two pieces of information in a slot that
            fits one, and on a 16e the cost was not the title. iOS gives the
            title the space it needs and takes it from the **back button's
            label**, so a long car name turned this screen's back control into a
            bare chevron — the only unlabelled one in the app, and duly reported
            as a second back-button idiom.

            The car did not go away; it moved below the nav, where it can be as
            long as it is and where it says what the thread is *about*. See
            `AdvisorScreen`'s `vehicleTitle`.
          */
          options={{ title: 'Advisor' }}
        >
          {({ route }) => (
            <AdvisorScreen
              vehicleId={route.params.vehicleId}
              vehicleTitle={route.params.title}
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

        {/*
          ── ⚠ R16 · a deep-link alias, not a destination ────────────────────

          Nothing in the app navigates here. It exists because shipped builds
          send `crewchief://vehicle/<id>/recalls` in recall notifications, and a
          link an installed app already emits has to keep resolving — so the
          path is kept and pointed at the screen the content moved to.

          It renders `HealthScreen`, which shows the recalls under the dial they
          drive. The title is `Health` for the same reason: a back button
          reading "Recalls" would name a screen that no longer exists.
        */}
        <Stack.Screen name="RecallDetail" options={{ title: 'Health' }}>
          {({ route, navigation }) => (
            <HealthScreen
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
          name="Plan"
          /*
            ── R15 · Needs and Mods, one destination ────────────────────────

            ── The `+` lives here, in the nav bar ───────────────────────────

            `native-wishlist.spec.html` is specific about it, and about what it
            is not: *"Add is in the nav bar, not a floating action button. A FAB
            covers the last row and belongs to a different design language."*

            `headerRight` is set from the navigator rather than by the screen
            calling `setOptions`, so the control exists in the screen's loading
            and error states too. A person whose list failed to load can still
            add to it.
          */
          options={{ title: 'Plan' }}
        >
          {({ route, navigation }) => (
            <PlanScreen
              vehicleId={route.params.vehicleId}
              title={route.params.title}
              /*
                ⚠ Decided here rather than inside `PlanScreen`, because the hub
                is what knows the owner's answer — `showsModifications` reads
                `performance_mindedness`, and the plan screen has no vehicle
                payload of its own. A deep link arrives without it, and the
                honest default for "we do not know yet" is to show the segment:
                hiding it would silently narrow the app on the strength of a
                field that was not asked for.
              */
              showsMods
              initialSegment={route.params.segment}
              onSignOut={onSignOut}
              onAdd={() =>
                navigation.navigate('WishlistAdd', {
                  vehicleId: route.params.vehicleId,
                  title: route.params.title,
                })
              }
            />
          )}
        </Stack.Screen>

        {/*
          ── R14 · Due and History, one destination ──────────────────────────

          The path is still `vehicle/:vehicleId/service` because that is what
          shipped service-due notifications carry, and it lands on `Due` — which
          is what such a notification is about.
        */}
        <Stack.Screen name="Service" options={{ title: 'Service' }}>
          {({ route }) => (
            <ServiceScreen
              vehicleId={route.params.vehicleId}
              initialSegment={route.params.segment}
              onSignOut={onSignOut}
            />
          )}
        </Stack.Screen>

        <Stack.Screen name="WishlistAdd" options={{ title: 'What this car needs' }}>
          {({ route, navigation }) => (
            <WishlistAddScreen
              vehicleId={route.params.vehicleId}
              title={route.params.title}
              onSignOut={onSignOut}
              onAskAdvisor={(vehicleId, ask) =>
                navigation.navigate('Advisor', { vehicleId, title: route.params.title, ask })
              }
              /*
                The list behind this refetches on focus, so adding does not pop
                back: somebody working through a catalogue usually adds more
                than one thing, and bouncing them out after each is the version
                that makes them tap in five times.
              */
              onAdded={() => {}}
            />
          )}
        </Stack.Screen>

        <Stack.Screen name="VehicleProfile" options={{ title: 'What you told us' }}>
          {({ route, navigation }) => (
            <VehicleProfileScreen
              vehicleId={route.params.vehicleId}
              onSignOut={onSignOut}
              /*
                Back to the car, which refetches on focus — so a changed answer
                shows up where it matters. `goBack` rather than a navigate, so
                the stack does not grow a second copy of the screen behind.
              */
              onSaved={() => navigation.goBack()}
            />
          )}
        </Stack.Screen>

        {/*
          ── R13 · the account, as a destination ─────────────────────────────

          `visible` is deliberately not passed: `AccountScreen` renders as a
          screen when it is absent and as a modal when it is not, and this is
          the screen case. `onClose` goes with it — the stack header is the way
          back, and a "Done" beside it would be a second answer to one question.
        */}
        <Stack.Screen name="Account" options={{ title: 'Account' }}>
          {() => (
            <AccountScreen
              email={email}
              accessToken={accessToken}
              onSignOut={onSignOut}
              /*
                Deletion clears the session, which unmounts this whole navigator
                — so there is nothing here to navigate back to and nothing to
                show a confirmation on. `App.tsx`'s gate takes over.
              */
              onDeleted={() => onSignOut()}
            />
          )}
        </Stack.Screen>

        <Stack.Screen name="Health" options={{ title: 'Health' }}>
          {({ route, navigation }) => (
            <HealthScreen
              vehicleId={route.params.vehicleId}
              title={route.params.title}
              onSignOut={onSignOut}
              /* R16. The recalls section keeps its per-recall advisor thread. */
              onAskAdvisor={(vehicleId, ask) =>
                navigation.navigate('Advisor', { vehicleId, title: route.params.title, ask })
              }
            />
          )}
        </Stack.Screen>

        <Stack.Screen name="InvoiceScan" options={{ title: 'Scan an invoice' }}>
          {({ route }) => (
            <InvoiceScanScreen
              vehicleId={route.params.vehicleId}
              /*
                The seam. `pick-image.ts` is the only module that will
                import expo-image-picker, so this screen stays free of native
                imports and one file changes when the build lands.
              */
              pickImage={pickInvoiceImage}
              onSignOut={onSignOut}
            />
          )}
        </Stack.Screen>
      </Stack.Navigator>

      {/*
        ── R13 · the bar ─────────────────────────────────────────────────────

        Hidden on sign-in only, which this navigator never renders — so it is
        always on. That is the point: the advisor and the account are reachable
        from wherever somebody is, rather than from one screen each.

        `navigate` rather than `push`, so tapping Garage from three screens deep
        returns to the garage already on the stack instead of stacking a second
        copy of it behind the first.
      */}
      <TabBar
        current={tabFor(route)}
        onSelect={(tab) => {
          if (tab === 'Advisor') {
            /*
              ⚠ The advisor needs a car, and the bar has none.

              `/api/v1/consultant` requires a `vehicleId` and authorizes against
              it, so there is no advisor without one. `lastVehicle` is whichever
              car was opened most recently this session — the review's own
              suggestion, and the honest fallback when there is none is the
              garage, where a car gets chosen. Not an empty advisor: a composer
              that cannot send is worse than the screen that leads to one.
            */
            const car = lastVehicle();
            if (car) {
              navigation.navigate('Advisor', { vehicleId: car.vehicleId, title: car.title });
            } else {
              navigation.navigate('Garage');
            }
            return;
          }

          navigation.navigate(tab);
        }}
      />
      </View>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  /*
    The navigator and the bar in one column. `flex: 1` on the navigator means
    the bar takes its height out of the frame rather than floating over it — the
    same argument the wishlist spec makes against a floating action button, and
    the 49pt the review costed against the pinned hero.
  */
  frame: { flex: 1 },
});
