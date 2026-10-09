# The Living Model saved to the account: notes (lane LIVINGSYNC)

Status: built dark. `LIVING_MODEL_ENABLED = false`, owner preview only. The
migration `supabase/migrations/20261011090000_living_models.sql` is NOT applied
by this lane. Until it is applied the app behaves as before: the model is saved
on one device and the screen says so.

## 1. What is sent, and when

One thing is sent: the job model, to `public.living_models`, one row per
project, through `public.living_model_save`. The app builds what it sends field
by field (`utils/livingModel/syncCore.ts`, `modelForAccount`). A field that
function does not name is not sent.

Sent, for every room:

- the room's id, the name a person typed, its kind, its floor, where it sits
  and its quarter turn;
- whether it was typed or came from a scan, and for a scanned room the id of
  the saved scan it came from (an id, not the scan);
- its sizes: each wall (two end points, length, the scanner's own length, where
  the length came from, height, how sure the scanner was, curved or not, on the
  outline or not, and the wall's own corner outline when the scan gave one);
  each door, window and opening (wall, offset, width, height, sill, how sure
  the scanner was, where each number came from); each fixture (Apple's
  category such as toilet or sink, centre, width, depth, height, turn, how sure
  the scanner was); the floor outline; the ceiling height.

Also sent: which schedule tasks a person ticked for a room, the stage a person
picked for a task, and the time of the last change on the device.

Never sent, by this lane or any code in it:

- a photo or a video (the scanner records neither);
- Apple's raw scan data (`mageid_room_scan_raw::<scanId>`), or its hash;
- the list of saved scans (`mageid_room_scans::<projectId>`), a scan's capture
  time, the phone's model and iOS version, the scan's warnings, the taped-wall
  checks, the list of hand corrections, the closure record;
- anything the Order List or the clearance checks worked out from a scan.

When it is sent: a moment after a change (1.5 seconds), when the screen opens,
when the offline queue moves, and when the app comes back to the front. Every
send goes through the offline queue.

## 2. The scan question

A room dropped into the model with Add from Scan is marked in the model
(`source: 'scan'`, and `scanId`). That was already so before this lane.

Before the FIRST time a model holding such a room would be sent, the person is
asked, once per project:

> **This model includes a room you scanned.**
> Saving it to your account sends that room's sizes (walls, doors, windows and
> fixtures) to MAGE ID's servers so your other devices and your team on this
> project can see it. No photo or video is sent.
>
> [ Save to My Account ]   [ Keep on This Phone ]

- Until he answers, nothing is sent. The status line says "Not sent to your
  account yet. It is saved on this device."
- **Keep on This Phone** keeps the WHOLE model on the device, not only the
  scanned room, until he changes it. The screen then says "Kept on this phone
  only, as you chose. It will not appear on your other devices." with the same
  explanation and a Save to My Account button. If an earlier copy had already
  been saved to the account, the screen says it stays there (this lane does not
  delete an account copy).
- **Save to My Account** sends the model. A Keep on This Phone button stays on
  the screen while the model holds a scanned room.
- The answer is kept per person and per project on the device
  (`mageid_living_model_sync::<user>::<project>`). It is erased at sign-out with
  the model, so a person who signs back in is asked again before a scanned room
  that is not in the account is sent.
- A scanned room that is ALREADY in the account copy (a teammate said yes on
  his phone and it came down with the model) is not asked about again on
  another device: sending it back discloses nothing new. The ask is about a
  scanned room that is not in the account yet.

The answer is NOT recorded on the server. `legal_acceptances` accepts four
kinds today and none fits. See section 5.

## 3. Needs the next native build and the founder's yes

`app.json` was not changed by this lane. The iPhone camera permission text
still says, of a room scan, that the app "keeps the room's measurements (its
walls, doors, windows and fixtures, and their sizes) on your phone". With this
lane that sentence is true by default and stops being the whole truth the
moment a person taps Save to My Account. Until a build carries the new
sentence, the in-app question in section 2 is what makes the upload a choice.

### Proposed camera permission sentence (replaces the last sentence only)

> When you scan a room on an iPhone with a LiDAR sensor, the camera and the
> depth sensor measure the room, and the app keeps the room's measurements (its
> walls, doors, windows and fixtures, and their sizes) on your phone unless you
> choose to save a room to your account; video of a scan is not recorded, kept
> or uploaded.

### Proposed first-use scan notice (adds one sentence; bump `SCAN_ACK_VERSION`)

Today (`utils/legalAcceptanceCore.ts`, `SCAN_ACK_COPY`, version 1):

> **Before you rely on a scan**
> A scan is a first measure. It can be off by an inch or more. Check before you
> order, cut, price or build from it.

Proposed (version 2):

> **Before you rely on a scan**
> A scan is a first measure. It can be off by an inch or more. Check before you
> order, cut, price or build from it. MAGE ID keeps the room's measurements on
> your phone unless you choose to save a room to your account.

Changing it means a new `SCAN_ACK_VERSION`, a new `SCAN_ACK_TEXT_SHA256`, the
Spanish pair in `i18n/catalog/es/office/notices.ts`, and everyone who tapped I
Understand on version 1 is shown version 2 once.

### Every place that says, or rests on, "scans stay on the phone"

These change together, in the same commit as the camera sentence:

| Where | What it says today | What changes |
| --- | --- | --- |
| `app.json` `expo.ios.infoPlist.NSCameraUsageDescription` | "keeps the room's measurements ... on your phone" | The proposed sentence above. Native build. |
| `scripts/validate-scan-room.ts` rule N8 | Pins the three clauses of that sentence | Pin the new clause "unless you choose to save a room to your account". |
| `scripts/validate-ios-permission-strings.ts` and `scripts/validate-ios-store-copy.ts` | Hold the permission strings and the store copy to the code | Re-run; update whatever they pin of the camera sentence. |
| `docs/scan-the-room-native-checklist.md` section 2 (and section 1, item 3, "Where the scan lives") | Quotes the sentence; says the lane keeps a scan on the phone | Quote the new sentence; say a placed room can be saved to the account after a yes. |
| `utils/legalAcceptanceCore.ts` `SCAN_ACK_COPY` and `i18n/catalog/es/office/notices.ts` | The first-use notice (no storage sentence today) | The proposed notice above, version 2. |
| `docs/legal/consent-texts-for-counsel.md` section 8 | Quotes the first-use notice | Quote version 2, and add the scan question of section 2 of this file as a consent text for counsel. |
| `docs/legal/privacy-policy-versus-code.md` row 12 | "Room scans stay on the phone ... Nothing is uploaded" and a proposed policy line "A room scan is stored on your phone only. It is not uploaded." | Amended by this lane to point here. The proposed policy line must become: "A room scan is stored on your phone. If you place a scanned room in a job model and choose to save it to your account, that room's measurements are stored on our servers and shown to the people on that project. No photo or video of a scan is recorded." |
| `marketing/privacy.html` (the Privacy Policy itself) and `PRIVACY_VERSION` / `PRIVACY_TEXT_SHA256` | Says nothing about room scans | Add the policy line above BEFORE `LIVING_MODEL_ENABLED` or `SCAN_ROOM_ENABLED` is turned on for anyone but the owner. A new policy version means re-acceptance. |
| App Store Connect, App Privacy answers | Room measurements are not listed as collected | If counsel treats room measurements tied to an account as collected data, add them (linked to the user, used for app functionality) before the flag is on. |
| `hooks/useRoomScanCopy.ts` `office.roomScan.plan.savedNote` ("Saved with this project on this phone.") and `saved.emptyBody`, `saved.deleteBody` | The SCAN is on this phone | Still true: the scan and the scan list are not synced. No change. Deleting a scan does not remove a room already placed in a model or already saved to the account; say so in `deleteBody` when the Living Model opens to others. |
| `hooks/useScanOrderCopy.ts` (the Order List: "walls you taped on this phone") | The taped-wall numbers are on this phone | Still true. No change. |
| `hooks/useLivingModelCopy.ts` `office.livingModel.scan.noneBody` | "Scans are made in the phone app and stay on the phone that made them." | Still true. On the web the sheet now says how a scanned room gets there (`scan.noneWebBody`). |
| `utils/roomScan/storeCore.ts` and `utils/roomScan/rawKeep.ts` headers | "nothing is sent to the server in this lane", "Nothing here is uploaded" | Still true of those files. No change. |
| `supabase/functions/delete-account` and `docs/legal/account-deletion-and-signed-records.md` | Lists what account deletion removes | `living_models` rows go with the project (cascade). Add the table to the document's list of what is removed. |

## 4. Collaborators

- While `LIVING_MODEL_ENABLED` is false a collaborator who is not the app owner
  sees nothing: no row on the project page, and the route sends him Home before
  anything mounts (`app/living-model.tsx`, `utils/livingModel/allowed.ts`). No
  read of `living_models` is made for him.
- The table is ready for him: everyone on the job can read the model, and an
  owner or editor can save it. A viewer or a field seat cannot save, and the
  screen already refuses those two seats.
- The status line names who saved the account's copy when it was not this
  device: "Last changed by you at 3:42 PM." or "Last changed by <email> at
  3:42 PM." The name comes from the project's collaborator list, which only the
  project owner can read in full; an editor sees "by a teammate" for anyone but
  himself.

Needed before it opens to others:

1. Presence. Two editors in the model at once will each be asked the
   both-changed question more often than they should. Show who has it open
   (the Who's On This Project kit, itself dark) and take the account's copy
   live when this device has no changes.
2. A name for "last changed by" that an editor can see (the owner's name, a
   teammate's name). That is the Who's On roster, with its own privacy rules.
3. A merge by room. Today the whole model is one document: two people who
   changed DIFFERENT rooms still get the question.
4. The scan question for a collaborator: an editor who scans a room on a job
   that is not his is sending that room's sizes to the project owner's account
   and to everyone on the job. The wording already says "your team on this
   project"; counsel should read it with that case in mind.
5. The policy and store items in section 3.

## 5. Open questions for counsel and the founder

1. Is the in-app question enough while the camera sentence still says "on your
   phone"? The lane's view is in its report: yes for the owner preview, no for
   anyone else.
2. Should the yes be recorded on the server, like the Terms acceptance? It
   needs a new kind in `record_my_legal_acceptance` (one line, a new
   migration), for example `scan_room_upload`.
3. Retention. A model saved to the account stays until the project or the
   account is deleted. Keep on This Phone, chosen later, does not remove a copy
   already saved. Should there be a Remove from My Account button?
4. A homeowner's rooms. The measurements are of someone else's home. The
   contractor chooses to save them; the homeowner is not asked. The Terms
   already make the contractor responsible for what he puts in; confirm that
   covers interior measurements.
