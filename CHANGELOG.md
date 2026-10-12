# Changelog

All notable changes to **SF2E Vitality Network and Harmony** are recorded here. The version number
matches `sf2e-vitality-network/module.json`.

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
## 1.4.1

- **The transfer summary no longer reopens the dialog.** Its "Transfer Vitality" heading was a link
  to the action item; clicking an item link in chat posts that action again, and the system's card
  for it reads as a fresh use, so the dialog appeared a second time. The heading is now plain text.
- **Module cards are marked and never treated as uses.** Everything the module posts carries
  `flags.sf2e-vitality-network.card`, and the chat handler ignores its own output outright.
- **A chat card is handled once.** Message ids are recorded as they are handled, so a repeated hook
  call cannot open two dialogs for the same card.

## 1.4.0
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
