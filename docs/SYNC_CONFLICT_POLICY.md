# POMAK — conflict and sync policy (November 2026)

## Active workout on one device
An unfinished workout lives only in IndexedDB until it is finished. Multiple browser tabs
merge independent changes to exercise/set fields in one IndexedDB transaction. Edits to
the same field, or edits of an exercise/set removed by another tab, are rejected with
a visible recovery message; **no stale whole-workout overwrite is allowed**.
Finishing/discarding and intentional replacement validate the active workout revision.

## Offline food diary
Changes within one browser/Android installation are queued in insertion order.
Web Locks or an IndexedDB fallback lease serialize HTTP delivery across same-origin tabs.
A lost HTTP response is retried; entry PUT and DELETE are idempotent on the same UUID.

**Different devices are not coordinated by the local lock.** For concurrent changes to the
same food entry from two different installations, the current server policy is **last
accepted write wins**, even if that write was queued while offline. Editing different
food entry UUIDs is independent. This is a documented capability limit, **not a claim
that cross-device stale edits cannot overwrite newer values**.

Preventing all cross-device lost updates requires a backwards-compatible server
version/If-Match protocol, conflict UI, resolution semantics for pending offline edits,
and an old-APK rollout plan. Do not enable a stricter write contract without testing
existing Android versions and request retries.

## Profile, routines and recipes
The account profile PATCH now updates only submitted fields, and the frontend only
merges those fields into its cache. Concurrent edits to the **same** field from
different devices remain last accepted write wins. Routines and recipes are not
offline-edited; simultaneous whole-object edits currently follow last-write-wins.

## Release gate
Keep cross-device editing conflicts in the product limitations unless and until the
versioned API is implemented and verified. Automated CI is not a physical-device or
production cross-device end-to-end test.
