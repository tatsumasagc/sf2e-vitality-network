# Changelog

All notable changes to **SF2E Vitality Network and Harmony** are recorded here. The version number
matches `sf2e-vitality-network/module.json`.

## 1.7.0

- **The GM relay is gone.** The socket channel, the request machinery, the candidate search, the
  diagnostics and the tests that covered them have been removed — roughly 620 lines of module and 200
  lines of tests. When the acting player cannot write to the target, the vitality is still spent and the
  card carries the healing link and the harmony link or button; nothing is written to a character the
  player does not own.

- The transfer path is now a single branch, and the card no longer carries relay prose.

- The test suite is 137 checks, down from 152.

## 1.6.1

- **The GM relay setting is gone.** `relayToGM` is no longer registered, so it cannot be switched on
  from the settings form. A transfer the caster cannot apply simply outputs the card, as it has since
  1.5.1. The relay code is still present and dormant — say the word and it can be deleted outright.

- **Refocus applies to both the class feature and the archetype feat.** This was already the module's
  behaviour (`refocusClassFeatureOnly` defaults to off); the workflow document said otherwise and has
  been corrected.

- The workflow document's transfer flow and card template were rewritten to match what the module
  actually does.

## 1.6.0

- **The module now ships a compendium**, `Vitality Network Harmonies`, holding one effect item per
  harmony: Akashic, Elemental, Shadow, and reminder items for Healing and Rhythm (which have no effect
  of their own — they change the world directly).

- **The card links the compendium item** where it can, so the link resolves on any client that has the
  module installed rather than only in the world where the item happens to exist. A world item is used
  if the pack is missing, and the button if neither is available.

- **Elemental Harmony chooses its trait with a `ChoiceSet`** rule element, and each elemental trait
  carries its damage-type override behind a predicate (`harmony:elemental:fire` and so on), so the
  effect does nothing until a trait is picked and then applies only that trait's damage.

- Item ids are fixed, so the link is stable across releases.

## 1.5.1

- **The card is the output.** A transfer to an actor the caster cannot modify no longer attempts a
  relay: the card shows what happened and hands the rest to the table.

- **The harmony is a draggable link.** The module keeps one world item per harmony — named the way PF2e
  names effects, `Effect: Shadow Harmony` — and links it from the card, so it can be dragged onto the
  target. An existing item of that name is reused, so a world does not accumulate copies. If the item
  cannot be created (a player without permission to make world items), the card falls back to a button
  that carries the effect data.

- **The healing is a chip**: `@Damage[N[healing]]`, which opens PF2e's own card with its Apply Healing
  button.

- **The relay is now off by default** (`relay.config.relayToGM`). Turn it on to have a GM's client apply
  transfers automatically; with it off nothing is attempted and no failure is reported.

## 1.5.0

- **The chat card can hand the work to the table.** When the healing is not applied automatically,
  the card now carries a clickable `@Damage[N[healing]]` link — click it and the card that opens has an
  **Apply Healing** button for whoever has permission over the target. PF2e expresses healing as the
  `healing` flavour, so no negative amount is used (PF2e clamps those to 1).

- **The card also offers the harmony as a button.** The effect data rides on the message, so pressing
  "Apply Shadow Harmony to <name>" attaches it — the client that presses it is the one with permission,
  so no relay is involved.

- Switching `relay.config.relayToGM` off now gives you exactly this: no relay attempt at all, just the
  card with its healing link and effect button.

## 1.4.7

- **An out-of-date GM client can still apply a transfer.** When nobody answers the relay check, every
  other client is running an older build (or none is connected). Older builds ignore the client name and
  only act on an unnamed request, so one last plain request is sent before giving up. It costs a single
  timeout and cannot cause a second application: whichever client acts is still just one.

- **The failure message now names the cause**: "no client answered a relay check — the other clients are
  running an older version of this module, or none is connected".

## 1.4.6

- **The target's own player is asked first.** A player client needs no privileges to heal a character it
  owns, so a transfer to another player's character no longer waits on a GM at all. The GMs are asked only
  when nobody who owns the target is online. The two routes are alternatives, so a transfer is never
  applied twice.

- **Every attempt is logged.** When a transfer cannot be applied, the console reports each client that was
  asked and what it answered, plus how many clients replied to a relay check — so a client that is listed
  as connected but runs no module is obvious at a glance.

- Each named GM client now gets 8 seconds rather than 4 before the next is asked
  (`relay.config.relayPerCandidateMs`).

## 1.4.5

- **A listed GM that runs no module no longer blocks the transfer.** Foundry can report a GM as
  connected while that client has the module switched off, so it can never answer. When every named GM
  stays silent, the module now pings the table, and if no client answers as a GM it asks the target's
  owner instead. Only that evidence unlocks the fallback, so a transfer can never be healed twice.

- **The failure message says whether anyone is listening**: "…(no client answered a relay check)" means
  no GM client is running the module at all.

## 1.4.4

- **The workbench Refocus macro now refills the network.** It puts the word "Refocus" in the card's
  *flavour* and leaves the content as the localised "regains N focus points" line, so the card was not
  recognised. Both the content and the flavour are now read.

- **The GM relay asks a named client.** A transfer used to be offered to whoever Foundry called the
  primary GM, which could leave it unanswered (and, in a world with two GM sessions, unanswerable).
  Each connected GM is now asked in turn, the designated one first, and a client that answers with a
  real error is not retried. Per-candidate timeout: `relay.config.relayPerCandidateMs` (4 seconds).

- **`game.sf2eVitalityNetwork.testRelay()`** reports which clients answer the relay and which of them
  are GMs — run it on the player's client when a transfer cannot be applied.

## 1.4.3

- **Transferring to a character the player does not own now works.** A player cannot write to an
  actor they do not own, so the module asks a GM's client to apply the healing and the harmony
  effect. The relay no longer depends on Foundry having designated an `activeGM` — any connected GM
  can take the job — and when no GM is connected at all, whoever owns the target is asked instead.

- **A failed application now says why.** The chat summary and the notification name the reason (no GM
  connected, nobody answered, the applying client reported an error) instead of a generic "no
  permission".

- **Refocus works from a macro card.** The xdy-pf2e-workbench Refocus macro posts a card with no item
  attached, so the network was never refilled. Cards that mention Refocus are now recognised, and an
  ordinary card still leaves the network alone.

## 1.4.2

- **The transfer dialog no longer reopens after a successful transfer.** The healing call passed
  Transfer Vitality as the item that caused it, so PF2e's own healing card carried the action as its
  origin — and that card is indistinguishable from a fresh use of the action. Healing is no longer
  attributed to the action, so the system's card no longer looks like a use. This is why the second
  dialog only appeared when the network still had Hit Points to spend.

- **Only one dialog can be open at a time.** If a second trigger arrives while a transfer dialog is
  open, it is dropped instead of stacking another dialog on top of the first.

- **Only one chat trigger is handled at a time.** Overlapping triggers (two cards for one use, or two
  copies of the script reacting to the same card) can no longer run two transfers at once.

- **A second copy of the script now stands down.** If the module and a leftover world script — or the
  World Scripter module — are both loading this code, the second copy detects
  `game.sf2eVitalityNetwork` and goes inert with a console warning, instead of doubling every
  trigger.

## 1.4.1

- **The transfer summary no longer reopens the dialog.** Its "Transfer Vitality" heading was a link
  to the action item; clicking an item link in chat posts that action again, and the system's card
  for it reads as a fresh use, so the dialog appeared a second time. The heading is now plain text.

- **Module cards are marked and never treated as uses.** Everything the module posts carries
  `flags.sf2e-vitality-network.card`, and the chat handler ignores its own output outright.

- **A chat card is handled once.** Message ids are recorded as they are handled, so a repeated hook
  call cannot open two dialogs for the same card.

## 1.4.0

Works on both systems, and can be distributed as a Foundry module.

- **PF2e and SF2e support.** The module runs on the PF2e system with the Starfinder Anachronism
  module (`Compendium.sf2e-anachronism.*`) and on the SF2e system itself (`Compendium.sf2e.*`). The
  item ids are identical in both, so content is matched on the trailing id, and the class feature is
  also recognised when SF2e creates it directly on the actor.

- **System flags are read from the running system's namespace** (`flags.sf2e.*` as well as
  `flags.pf2e.*`), which covers the Connection feature's choice and the action's origin.

- **Turn starts are handled from both `pf2e.startTurn` and `sf2e.startTurn`**, in addition to the
  core combat hooks.

- **The concealed condition is resolved against the running system's own compendium**, falling back
  to the other system's pack if the first candidate does not exist.

- **New setting: "Which feature grants the network"** (`auto`, `class feature`, `archetype feat`) for
  copies that have lost their source id. It can only reclassify a network the character already has.

- Category spellings such as `class-feature` and `classFeature` are now understood.

## 1.3.0

Foundry module, with settings instead of code editing.

- The script is now the entry point of a module (`module.json`, `lang/en.json`, a stylesheet, a
  licence and a packaged zip), and still works unchanged as a world script.

- Eighteen registered settings cover the capacity correction, the Refocus refill, the transfer
  progression, the harmony fallback and per-harmony toggles, the elemental damage-type override, the
  combat-only recharge, the dialog and relay behaviour, and verbose logging.

- "Advanced overrides (JSON)" merges plain data over the built-in values; unknown keys and code
  formulas are refused, invalid JSON is reported, and removing an override restores the default.

- A **Diagnostics** settings menu lists every character with a vitality network, their detected
  feature, their maximum against the printed rules, the harmony that would be applied and the
  detected spell DC rank.

- Settings and the menu register on `init`, the rest on `ready`, and the API is exposed on both
  `game.sf2eVitalityNetwork` and `game.modules.get("sf2e-vitality-network").api`.

## 1.2.0

Printed progressions, capacity and Refocus.

- The transfer maximum now follows whichever feature the character has: the class feature's action
  text (+10 at 5th, 10th, 15th, 20th) or the archetype feat's text (+5 at the same levels). A
  house-rule table remains available.

- The network maximum is compared with the printed rules and, with enforcement on, the granting
  item's `SpecialResource` formula is rewritten to match — including the archetype feat's formula,
  which steps at 5th level and reaches 50 where its text reaches 40 at 20th.

- Stored maxima are corrected as the world loads, at the start of a turn and before a transfer.

- "When you Refocus, your vitality network regains all its Hit Points" is automated, for both
  features by default, and also when focus points are restored some other way.

## 1.1.0

All five connections.

- Akashic, Elemental, Healing, Rhythm and Shadow harmonies, each applied as an effect on the target
  where the rules call for one, with the connection found from the connection class feature or from
  the Connection feature's choice.

## 1.0.0

Initial version.

- Turn-start recharge of 4 HP, or 6 when master in spell DC, or 8 when legendary.

- Transfer Vitality: a dialog for the amount, the network reduced and the targeted token healed
  through PF2e's own damage pipeline.

- Shadow Harmony: a 10-foot darkness emanation, concealment and the option to Hide.
