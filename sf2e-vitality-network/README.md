# SF2E Vitality Network and Harmony

A small Foundry VTT module for the Pathfinder Second Edition system that automates the Starfinder 2e
Mystic's **Vitality Network**, the **Transfer Vitality** action, the **Refocus** refill, and the
**Harmony** that each of the five mystic connections applies to the target.

- **Foundry VTT** v13 or v14 (verified on v14)
- **Either game system**, which is where the Starfinder content comes from:
  - **PF2e** 7.0.0 or later (written against 8.6.0) with the **Starfinder Anachronism** module, or
  - **SF2e** 1.0.0 or later (written against 1.6.0)

---

## What it automates

| Feature | Behaviour |
| --- | --- |
| **Turn-start recharge** | At the start of the character's turn in combat the network regains 4 HP, or 6 if the character is master in spell DC, or 8 if legendary — never beyond its maximum. |
| **Refocus** | The network refills completely when the character Refocuses or when focus points are restored. |
| **Transfer Vitality** | Using the action opens a dialog for the amount, clamps it to the legal range, reduces the network and heals the targeted token through PF2e's own damage pipeline. |
| **Capacity** | The network's maximum is compared with the printed rules and corrected when the content module disagrees. |
| **Harmony** | The target receives the effect for the caster's connection: Akashic, Elemental, Healing, Rhythm or Shadow. |

The transfer maximum follows the printed text of whichever feature the character has:

| Level | Class feature (+10 at 5th, 10th, 15th, 20th) | Archetype feat (+5 at 5th, 10th, 15th, 20th) |
| --- | --- | --- |
| 1–4 | 10 | 10 |
| 5–9 | 20 | 15 |
| 10–14 | 30 | 20 |
| 15–19 | 40 | 25 |
| 20 | 50 | 30 |

It is additionally capped by the network's current value.

---

## Installation

**From a folder.** Copy the whole `sf2e-vitality-network` folder into your Foundry user data
directory under `Data/modules/`, so that `Data/modules/sf2e-vitality-network/module.json` exists.
Then enable **SF2E Vitality Network and Harmony** in your world's *Manage Modules* screen.

**From a zip.** Zip the contents of the folder (so that `module.json` sits at the top level of the
zip), then use *Install Module* → *Install from file* in Foundry's setup screen.

**Publishing an update.** If you want Foundry's installer and update checker to find it, add `url`,
`manifest` and `download` fields to `module.json` pointing at a hosted copy — typically a GitHub
repository with a release asset. Also replace the placeholder author in `module.json` and the
copyright holder in `LICENSE`.

The script contains no imports, so the same file can also be dropped into a world folder and listed
in `world.json`'s `esmodules` array. Loaded that way the module settings are skipped and the built-in
defaults apply.

---

## Settings

Everything is configured in **Configure Settings → Module Settings**. The important ones:

| Setting | Default | Effect |
| --- | --- | --- |
| Make the network maximum match the printed rules | on | Rewrites the Vitality Network item's formula when the content module disagrees with the printed text. |
| Correct the network maximum as the world loads | on | Applies that correction to every character at startup instead of waiting for their turn. |
| Refocus refills the network | on | Refill on Refocus or when focus points are restored. |
| Refocus refill for the class feature only | off | Strictly, the refill belongs to the class feature. |
| Transfer maximum progression | Follow the item | Or force the class feature, archetype feat or house-rule table. |
| Which feature grants the network | Read the granting item | Only needed when a copy has lost its source id and is read as the wrong feature. |
| Harmony when no connection is found | Shadow | Set to None to attach nothing. |
| Enable Akashic / Elemental / Healing / Rhythm / Shadow Harmony | on | Switch individual harmonies off. |
| Elemental Harmony changes the damage type | on | PF2e cannot limit a damage-type override to one Strike, so it lasts until the effect expires. |
| Recharge only in combat | on | Match the rules' "at the start of each turn in combat". |
| One client shows the dialog | on | Only the client that created the action's card prompts. |
| Ask the GM's client to apply target-side changes | on | Needed when a player cannot edit the target's character. |
| Post a chat summary for each transfer | on | |
| Verbose console logging | off | Per client; trace decisions in the console. |
| Advanced overrides (JSON) | `{}` | Merge plain data over the built-in values, e.g. `{"transfer":{"progression":"houseRule"},"recharge":{"master":9}}`. Unknown keys and code formulas are ignored. |

---

## Diagnostics

**Configure Settings → Module Settings → Diagnostics** lists every character with a vitality network
and shows their level, which feature grants the network, the current and expected maximum, the
harmony that would be applied and the detected spell DC proficiency rank. It also lists the settings
in effect.

For a single character, either select their token and open the diagnostics, or run in the console:

```js
game.sf2eVitalityNetwork.debug(game.user.character);
```

---

## Macro API

```js
const api = game.sf2eVitalityNetwork;

api.debug(actor);                       // diagnostics for one character
api.source(actor);                      // "classFeature", "archetypeFeat" or null
api.connections(actor);                 // harmonies the actor's connections would grant
api.recharge(actor);                    // turn-start style recharge
api.refocus(actor);                     // rules-driven Refocus refill
api.rechargeToMax(actor);               // fill the network whatever the source
api.checkCapacity(actor);               // compare the maximum with the printed rules
api.correctCapacities();                // correct every actor (GM only)
api.transfer(actor, { amount: 10 });    // transfer to the targeted token
api.applyHarmony(targetActor, { harmony: "shadow", caster: actor });
api.settings();                         // the settings in effect
api.diagnostics();                      // open the diagnostics window
api.testRelay();                        // which clients answer the GM relay
api.applySettings();                    // re-apply settings after editing them in code
api.harmonies;                          // the harmony registry itself
```

The same object is available as `game.modules.get("sf2e-vitality-network").api`.

---

## Reference effects

`reference/` holds copies of the effects the module generates for three of the harmonies
(`shadow-harmony-effect.json`, `akashic-harmony-effect.json`, `elemental-harmony-effect.json`), so
you can inspect their rule elements or apply one by hand. The module stamps its own flags and the
caster/target context into the effects it creates, so these files are references rather than the
effects themselves.

---

## How it works

The class feature and the archetype feat are told apart by their compendium source ids, which decides
the transfer progression, the expected capacity and whether the Refocus refill applies. The action is
recognised from PF2e's chat card for `transfer-vitality`; the connection is found from the connection
class feature or from the Connection feature's `ChoiceSet` selection. Healing goes through
`actor.applyDamage({ damage: -amount })`, the same path the system uses for healing spells, which is
what makes the action's void-healing clause behave correctly. When a player cannot edit the target's
character, the acting client sends the intent over a socket channel and the GM's client applies the
healing, the effect and the harmony's extra work.

Shadow Harmony's darkness is a token light source at priority 0, so it dims ordinary light and is
beaten by any light of a higher priority. Healing Harmony reports the afflictions and eligible
conditions it finds instead of rolling a counteract check for the player. Rhythm Harmony extends
active rhythm epiphanies by a round and reports what it changed. See the notes at the end of
`sf2e-vitality-network.js` and the longer documentation in the development repository for the full
list of caveats.

---

## Development

The module ships with an offline test suite (Node 18+) that runs the script against stubbed Foundry
globals and covers the recharge, both transfer progressions, the capacity correction, the Refocus
paths, the resource read/write, the healing call, harmony detection and effect generation, the dialogs
and the guard clauses:

```
node test/smoke-test.mjs
```

The suite is not part of the module package; it lives in the development repository next to it.

---

## Supported systems and content

Starfinder 2e content reaches Foundry by two routes, and the module handles both:

| System | Content comes from | Vitality Network items |
| --- | --- | --- |
| **PF2e** | the *Starfinder Anachronism* module | `Compendium.sf2e-anachronism.class-features.Item.hNnIAyBxfQ2Howp2` (class feature) and `Compendium.sf2e-anachronism.feats.Item.kK5JtGm6PQh7DT7Q` (archetype feat) |
| **SF2e** | the system itself | `Compendium.sf2e.feats.Item.kK5JtGm6PQh7DT7Q` (archetype feat); the class feature is created on the actor, as in `Actor.<actor id>.Item.2OvKQHIMWuB4zFWm` |

The item ids are the same in both routes, so items are matched on the trailing id, and the class
feature is also recognised from its name and category alone. The five connections are matched the
same way: `fM1vlupLq9Zlyt7C` Akashic, `AurhNoZmNNhHktx6` Elemental, `XV8C2ASALC65G5MH` Healing,
`jV9LIUswOPkVRC49` Rhythm and `kvmpnKMVw4wwGk8c` Shadow.

System flags are read from whichever namespace the running system uses (`flags.sf2e.*` as well as
`flags.pf2e.*`), turn starts are handled from both `pf2e.startTurn` and `sf2e.startTurn`, and the
concealed condition is looked up in the running system's own compendium first. If a copy has lost its
source id, the **Which feature grants the network** setting says which feature it should be read as.

---

## Installing from the manifest URL

In Foundry, open **Add-on Modules** > **Install Module** and paste this into *Manifest URL*:

```
https://github.com/tatsumasagc/sf2e-vitality-network/releases/latest/download/module.json
```

Foundry then installs the release zip and can check for updates on its own. The same release page
carries `module.json` and `sf2e-vitality-network-<version>.zip`, so a manual download works too.

## Releasing a new version

1. Bump `version` in `module.json`, update the `download` URL and add the notes to `CHANGELOG.md`.
2. Commit and push, then publish the release:

   ```
   gh release create v1.4.5 --title "1.4.5" --notes-file CHANGELOG.md \
       sf2e-vitality-network/module.json dist/sf2e-vitality-network-1.4.5.zip
   ```

`.github/workflows/release.yml` does the same automatically when a `v*` tag is pushed, provided
GitHub Actions can run for the account; if it cannot (billing limits, for example), the command
above publishes an identical release by hand.
