# Why `eas.json` looks the way it does

This reasoning used to live inside `eas.json` as `"//"` comment keys. **It had to move here:**
EAS validates `eas.json` against a strict schema and rejects unknown keys outright —
`"//" is not allowed`, `"build.//device" must be of type object`. The config was committed in
`c01ce0b` without ever being run, so the defect survived review. It surfaced the first time
`eas init` was executed, on 4 Aug.

Lesson worth keeping: a config file that has never been executed has not been tested.

---

## Why EAS Build at all

A native iOS build needs CocoaPods; CocoaPods needs Ruby >= 3.0. This Mac ships Ruby 2.6.10 and
has no Homebrew. Fixing that locally needs an admin password and an hour — and the cause of this
blocker was misdiagnosed four times before being confirmed by actually running the commands.

What is *not* broken: Xcode 16.3 is installed and selected, the iOS simulator runtimes are present,
and an iPhone 16e is booted. The only missing piece is the step that compiles native code, which
EAS does on its own machines where CocoaPods is already installed.

## Why the `simulator` profile is the one that matters

An iOS simulator build is **unsigned**, so it needs no Apple Developer Program membership ($99/yr)
and no provisioning. It is the cheapest way to get a runnable app onto the machine already sitting
here with a booted simulator. The $99 stays deferred to submission, where it belongs.

## Why `developmentClient: true` is load-bearing, not a preference

The free plan allows **15 iOS builds a month**. A plain simulator build bakes the JavaScript in, so
every code change would cost one of those fifteen and the month would be gone in two days.

A development build loads JS from a local Metro server instead, so **one cloud build covers every
subsequent code change**. You only spend another when a *native* dependency changes, which is rare.
That is what makes the free plan sufficient rather than a trial.

## Why there is no `device` profile

Deliberate. A build that runs on a physical iPhone must be signed, which requires the $99/yr
membership. That is already a Phase 6 requirement, so it is cost pulled forward rather than new —
but nothing before submission needs it, and the `simulator` profile is what unblocks verification
today.
