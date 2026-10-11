# Vitality Network and Harmony — Foundry VTT module

Automation for the Starfinder 2e Mystic **Vitality Network** ability, the **Transfer Vitality** action
and the **Harmony** that each of the five mystic connections grants, packaged as a Foundry module for
v13 and v14 that runs on either game system:

- **PF2e** (verified on 8.6.0) with the `sf2e-anachronism` content module, or
- **SF2e** (verified on 1.6.0), where the same content ships inside the system itself.

It serves both ways of getting a vitality network:

| | Item | What it grants |
| --- | --- | --- |
| **Class feature** | `Compendium.sf2e-anachronism.class-features.Item.hNnIAyBxfQ2Howp2` | A network of 6 + 4 HP per level, the Transfer Vitality action, the turn-start recharge and a full refill on Refocus. |
| **Archetype feat** | `Compendium.sf2e-anachronism.feats.Item.kK5JtGm6PQh7DT7Q` | A network of 10 HP growing in steps, and Transfer Vitality with a slower transfer progression. |

> **Class feature.** "Your soul supports a network of energy that connects and heals those in your
> bond. Your vitality network has a maximum capacity equal to 6 + 4 Hit Points per level. You gain the
> Transfer Vitality action that you can use to take Hit Points out of your network and into yourself
> or your allies as healing. Life-and-death situations help strengthen your bonds with your allies. At
> the start of each turn in combat, when you regain actions, your vitality network regains 4 Hit
> Points; if you're master in spell DC, it regains 6 Hit Points instead; if you're legendary, it
> regains 8 Hit Points. When you Refocus, your vitality network regains all its Hit Points."
>
> **Archetype feat.** "You gain a Vitality Network with 10 Hit Points and can use Transfer Vitality to
> transfer up to 10 HP. Increase the maximum capacity of your vitality network by 10 at 10th, 15th,
> and 20th-level. Increase the amount you can transfer by 5 at 5th, 10th, 15th, and 20th-level."
>
> **Transfer Vitality action.** "You can transfer up to 10 Hit Points (minimum 1) from your vitality
> network into yourself or a bonded creature you can sense within 60 feet. This works on creatures
> with void healing as though this action had the void trait. The amount you can transfer increases by
> 10 at 5th, 10th, 15th and 20th level."

The script is a single self-contained file. It contains no imports or exports, so it works as a world
The module is a single self-contained script plus a manifest, registered settings and a stylesheet.
The script has no imports, so the same file also works as a world script or inside the World Scripter
module, in which case the registered settings are skipped and the built-in values apply.
SF2e keeps the same items in its own packs (`Compendium.sf2e.feats.Item.kK5JtGm6PQh7DT7Q`, and the
class feature created directly on the actor), so the module detects whichever route the world uses.

---

## 1. What it automates

### 1.1 Turn-start recharge

At the start of a combatant's turn, the network regains Hit Points according to the character's spell
DC proficiency, and never beyond its maximum:

| Spell DC proficiency | Regained |
| --- | --- |
| Untrained, trained or expert | 4 HP |
| Master | 6 HP |
| Legendary | 8 HP |

Only one connected client performs the recharge, so the network cannot gain four times the Hit Points
when four players are logged in.

### 1.2 Refocus

`When you Refocus, your vitality network regains all its Hit Points.` The script refills the network
completely when it sees either the **Refocus** action being used or the character's focus pool being
restored (which also covers Refocus performed as part of resting).

Strictly read, that clause belongs to the class feature, but the script applies it to both features
(`refocus.classFeatureOnly: false`). Set it to true to restrict the refill to characters with the
class feature, and `refocus.enabled: false` to switch the whole behaviour off.

### 1.3 Transfer Vitality

Using the action opens a dialog asking how many Hit Points to move. The field is pre-filled with the
maximum, and the amount is clamped to the legal range. On confirmation the network is reduced by the
chosen amount and the **targeted token** is healed by the same amount through PF2e's own damage
pipeline, so healing modifiers, the dying and wounded rules, the Hit Point cap and the void-healing
provision above all behave exactly as they do for any other healing.

The maximum transferable depends on which feature the character has:

| Level | Class feature (action text: +10 at 5th, 10th, 15th, 20th) | Archetype feat (+5 at 5th, 10th, 15th, 20th) |
| --- | --- | --- |
| 1–4 | 10 | 10 |
| 5–9 | 20 | 15 |
| 10–14 | 30 | 20 |
| 15–19 | 40 | 25 |
| 20 | 50 | 30 |

The maximum is additionally capped by the network's current value, so you can never transfer more
than you have. The simple table from the first version of this script (10, then 20 / 30 / 40 at 10th /
15th / 20th) remains available as `transfer.progression: "houseRule"`.

If no token is targeted, the script offers to apply the transfer to the acting character instead,
because the action may be used on yourself. If the target is further than 60 feet away it warns but
does not block, since the GM may overrule distance.

### 1.4 Capacity

| Feature | Maximum capacity |
| --- | --- |
| Class feature | 6 + 4 × level (10 at 1st, 26 at 5th, 46 at 10th, 86 at 20th) |
| Archetype feat | 10, then +10 at 10th, 15th and 20th (10 / 20 / 30 / 40) |

The system stores this maximum on the granting item as a `SpecialResource` rule, so the script does
not normally touch it — it reads the maximum the system has prepared and clamps to it.

One pack discrepancy is worth knowing about. The archetype feat's own rule in the content module is
`max(10 * floor(@actor.level / 5), 10)`, which steps at **5th** level and reaches 50 at 20th, while
the feat's printed text steps at **10th**, 15th and 20th and reaches 40 — so without a correction an
archetype mystic's pool would be too large at levels 5–9 and at 20th. With `capacity.enforce` on (the
default), the script rewrites that one formula on the actor's copy of the item whenever it disagrees
with the text:

```js
capacity: {
    enforce: true,    // false = report the difference instead of rewriting the formula
    ...
}
```

The rewrite is visible in the item's rule editor, so it is easy to undo, and the script tells the
table in a notification when it corrects a character. The class feature's own formula,
`6 + @actor.level*4`, already matches its text, so it is never touched.

The correction runs as the world loads (on the primary GM's client), again at the start of a
character's turn and whenever a transfer is made, so a sheet shows the printed maximum as soon as
the world is up. `capacity.correctOnStartup: false` limits it to the latter two; calling
`game.sf2eVitalityNetwork.correctCapacities()` does it on demand.

### 1.5 Harmony (all five connections)

The Harmony applied depends on the mystic connection the caster has, found either as the connection's
class feature or through the **Connection** feature's choice.

| Connection | Compendium item id | What the script does |
| --- | --- | --- |
| **Akashic** | `fM1vlupLq9Zlyt7C` | Attaches **Akashic Harmony** to the target: a `harmony:akashic` roll option plus a chat reminder that the target may attempt Recall Knowledge as a reaction. |
| **Elemental** | `AurhNoZmNNhHktx6` | Asks which elemental trait and damage type to use, then attaches **Elemental Harmony**: `harmony:elemental` and `harmony:elemental:<trait>` roll options and a `DamageDice` override that changes the target's Strike damage type to the one chosen. |
| **Healing** | `XV8C2ASALC65G5MH` | Scans the target and posts a chat card listing every affliction and every eligible condition found on it, with a reminder to attempt the counteract. |
| **Rhythm** | `jV9LIUswOPkVRC49` | Finds active effects created by the rhythm epiphanies (Anthem, Shuffle Repeat, Remix) and adds 1 round to each one's duration, reporting which effects it changed. |
| **Shadow** | `kvmpnKMVw4wwGk8c` | Attaches **Shadow Harmony** to the target: a 10-foot darkness source, a `harmony:shadow` roll option and the concealed condition. |

The three effect-based harmonies share a common shape. They are one-round effects that expire at turn
end, and their origin follows the rules text: Shadow and Akashic are measured from **your** next turn,
Elemental from the **target's** next turn, which is what PF2e's origin-based duration handling needs.

The two harmonics that are not lasting effects work differently on purpose. A Healing Harmony is a
counteract check — a roll and a decision, not a buff — and a Rhythm Harmony changes the duration of
spells that are already running, so in both cases the script performs the work it can and reports the
rest to the table. Neither attaches an effect, because that would misrepresent the rules.

If no connection can be found on the caster, the script falls back to the Shadow harmony. Set
`harmonyFallback` to `null` if you would rather nothing be attached in that situation.

All level-dependent values (recharge, capacity, transfer maximum) are computed from the actor's
current level each time they are needed, never cached against a level, so a character that levels up
mid-session immediately gets the new limits.

---

## 2. Files

| File | Purpose |
| --- | --- |
| `sf2e-vitality-network/module.json` | The module manifest: id, version, entry point, stylesheet and language file. |
| `sf2e-vitality-network/sf2e-vitality-network.js` | The module's script — the whole automation. |
| `sf2e-vitality-network/lang/en.json` | Localised setting and dialog strings. |
| `sf2e-vitality-network/styles/vitality-network.css` | Styling for the dialogs and the diagnostics window. |
| `sf2e-vitality-network/reference/*.json` | Reference copies of the Shadow, Akashic and Elemental harmony effects. |
| `sf2e-vitality-network/README.md` | The module's own README, for whoever installs it. |
| `sf2e-vitality-network/LICENSE` | MIT licence (replace the placeholder holder before publishing). |
| `dist/sf2e-vitality-network-1.4.0.zip` | The packaged module, for Foundry's *Install from File*. |
| `CHANGELOG.md` | Version history, matching the version in `module.json`. |
| `.github/workflows/release.yml` | Publishes a release carrying `module.json` and the module zip whenever a version tag is pushed. |
| `.gitignore` | Keeps the built zips and editor noise out of the repository. |
| `test/smoke-test.mjs` | An offline test harness (Node) that exercises the logic with stubbed Foundry globals. |

The reference effects are generated by the script, which also stamps its own tracking flags and the
caster/target context into them. The files exist so you can inspect the rule elements, or drop one
onto a target by hand if you ever need to.

---

## 3. Installing

### Option A: install the module (recommended)

1. Copy the `sf2e-vitality-network` folder into your Foundry user data directory under `Data/modules/`,
   so that `Data/modules/sf2e-vitality-network/module.json` exists. Alternatively use
   `dist/sf2e-vitality-network-1.4.0.zip` with Foundry's *Install Module* > *Install from File* screen,
   or point *Install Module* > *Manifest URL* at the release manifest (see the project's GitHub page).
2. Enable **SF2E Vitality Network and Harmony** in your world's *Manage Modules* screen and save.
3. Configure it under **Configure Settings > Module Settings**. The defaults follow the printed rules,
   including correcting the archetype feat's network maximum, so the module works untouched.
4. Open **Configure Settings > Module Settings > Diagnostics** for a table of every character with a
   vitality network: their level, which feature grants it, the current maximum beside the printed one,
   the harmony that would be applied and the detected spell DC proficiency rank.

Modules are loaded on **every** client, which is what this automation needs: the dialog has to appear
for the player who used the action, and the turn and focus hooks have to be seen by the GM's client.

### Option B: as a native world script

The module's script has no imports, so it also runs as a world script.

1. Close Foundry so the world is not running.
2. Copy `sf2e-vitality-network/sf2e-vitality-network.js` into your world's folder, for example
   `Data/worlds/<your-world>/sf2e-vitality-network.js`.
3. Open `world.json` in that same folder and add an `esmodules` entry pointing at the file (keep the
   rest of the file untouched):

   ```json
   {
     "title": "Your World",
     "id": "your-world",
     "esmodules": ["sf2e-vitality-network.js"],
     "system": "pf2e"
   }
   ```

   A relative path is resolved against the world folder. If you prefer to keep the script outside the
   world folder, put it anywhere in your Foundry user data directory and give a path relative to that
   directory instead.

Loaded that way the settings layer is skipped and the built-in values at the top of the script apply;
`game.sf2eVitalityNetwork.settings()` reports those defaults.

### Option C: World Scripter module

Install the free [World Scripter](https://foundryvtt.com/packages/world-scripter) module, then paste
the entire contents of `sf2e-vitality-network/sf2e-vitality-network.js` into a new world script. This
avoids editing `world.json` and is the quickest way to try the automation out.

### Confirming it loaded

Open the browser console (F12) after logging in. You should see:

```
SF2E Vitality Network | v1.4.0 loaded. Try game.sf2eVitalityNetwork.debug(game.user.character) to check setup.
```

If the console instead reports that the world is not running the PF2e system, the script has detected
a non-PF2e world and is deliberately inert.

---

## 4. Configuration

The everyday switches are Foundry settings, under **Configure Settings → Module Settings**: the
capacity correction, the Refocus refill, the transfer progression, the harmony fallback and the
per-harmony toggles, the elemental damage-type override, the combat-only recharge, the dialog and
relay behaviour, and verbose logging. A JSON setting ("Advanced overrides") merges any of the plain
data below over the built-in values, for example
`{"transfer":{"progression":"houseRule"},"recharge":{"master":9}}`; unknown keys and the capacity
formulas are ignored. Registered settings are applied over the defaults each time the world loads.

Everything is also editable in the `CONFIG` object at the top of the script, which is what applies
when the file is used as a world script instead of a module.

| Key | Default | Effect |
| --- | --- | --- |
| `recharge.trained` / `.master` / `.legendary` | 4 / 6 / 8 | Hit Points regained at turn start by proficiency. |
| `transfer.progression` | `"source"` | `"source"` follows the feature the actor has; `"classFeature"`, `"archetypeFeat"` and `"houseRule"` force one table. |
| `transfer.classFeature` | 10/20/30/40/50 | The class feature's table, as `[minimum level, maximum]` pairs. |
| `transfer.archetypeFeat` | 10/15/20/25/30 | The archetype feat's table. |
| `transfer.houseRule` | 10/20/30/40 | The simple table (10, then +10 at 10th, 15th, 20th). |
| `minTransfer` | 1 | Smallest legal transfer. |
| `capacity.classFeature` / `.archetypeFeat` | 6 + 4/level / step function | The expected maximum, used by the report and by `enforce`. |
| `capacity.enforce` | **true** | Rewrite the granting item's `SpecialResource` formula when it disagrees with the printed text. |
| `capacity.correctOnStartup` | true | Also correct every character as the world loads, rather than waiting for their turn. |
| `refocus.enabled` | true | Refill the network on Refocus. |
| `refocus.classFeatureOnly` | **false** | false = both features refill on Refocus; true = only the class feature. |
| `refocus.actionSlugs` | `["refocus"]` | Names/slugs treated as the Refocus action. |
| `refocus.watchFocusIncrease` | true | Also refill when focus points are restored. |
| `warnBeyondRange` / `rangeFeet` | true / 60 | Warn when the target is out of the action's range. |
| `offerSelfWhenUntargeted` | true | Offer a self-transfer when nothing is targeted. |
| `harmonyFallback` | `"shadow"` | Harmony used when no connection is found; `null` attaches none. |
| `harmonies` | all true | Switch individual harmonies on or off. |
| `effect.rounds` | 1 | Duration of a harmony effect, in rounds. |
| `effect.darkness` | `bright 0, dim 10, priority 0` | The Shadow harmony's darkness light source. |
| `effect.grantConcealed` | true | Include the concealed condition in Shadow Harmony. |
| `elemental.promptForElement` | true | Ask which elemental trait and damage type to use. |
| `elemental.damageTypeOverride` | true | Let Elemental Harmony change the target's Strike damage type. |
| `rhythm.extraRounds` | 1 | Rounds added to each active rhythm epiphany. |
| `rhythm.epiphanyNames` | anthem, shuffle repeat, remix | Names/slugs matched when looking for epiphanies. |
| `rhythm.gmSearchesAllActors` | true | The GM's client also scans every actor in the world. |
| `healing.conditions` | blinded, clumsy, dazzled, deafened, enfeebled, sickened | Conditions Healing Harmony may counteract. |
| `healing.perfectHarmonyLevel` / `.perfectHarmonyConditions` | 19 / doomed, drained, paralyzed, stunned | The 19th-level addition. |
| `singleClientDialogs` | true | Only the client that created the action's chat card shows the dialog. |
| `relayToGM` / `relayTimeoutMs` | true / 8000 | Ask the GM's client to apply target-side changes. |
| `postChatSummary` | true | Post a summary card for the transfer. |
| `rechargeInCombatOnly` | true | Only recharge during an active combat. |
| `verboseLogging` | false | Trace decisions in the console. |

Elemental Harmony changes the damage type of the target's next Strike. PF2e has no way to limit a
`DamageDice` override to a single Strike, so while the effect lasts, every Strike the target makes
carries the chosen damage type. The effect expires at the end of the target's next turn, so in
practice that is usually one Strike; delete the effect after the first Strike if it matters at your
table. Set `elemental.damageTypeOverride` to false to leave the type change to the players.

---

## 5. Testing it in your world

0. Open **Configure Settings → Module Settings → Diagnostics** for an overview of every character with
   a vitality network, and for the settings in effect. It flags any character whose stored maximum
   disagrees with the printed rules.
1. Give the feature to a throwaway character. A full mystic shows a network maximum of 10 at 1st
   level; the archetype feat shows 10 as well, and the two diverge from 5th level.
2. In the console run `game.sf2eVitalityNetwork.debug(game.user.character)`. The returned object
   reports the detected `source` (`classFeature` or `archetypeFeat`), the resource key, the current
   and expected capacity, the detected spell DC proficiency rank, the recharge amount, the transfer
   maximum for the current level and progression, and — for the harmony — `connections` and
   `harmony`. If `spellDcRank` reads 0 on a character you consider master or legendary, tell me and I
   will extend the detection.
3. Start a combat, spend some of the network, and end the turn. The network should regain 4, 6 or 8
   Hit Points at the start of that character's next turn.
4. Use **Refocus** on a full mystic (or restore a focus point) and the network should fill completely.
   An archetype mystic refills as well, because `refocus.classFeatureOnly` is false; set it to true
   if you would rather restrict the refill to the class feature.
5. Target an ally's token, use **Transfer Vitality**, and accept the dialog. Check that the network
   drops by the chosen amount and the ally's Hit Points rise by the same amount, and that the maximum
   in the dialog matches the table for the character's feature and level.
6. Check the harmony that matches your caster's connection:
   - **Shadow**: the area around the target darkens, a **Shadow Harmony** effect is listed, and the
     **concealed** condition is applied. Ending the caster's next turn removes the effect and the
     condition together.
   - **Akashic**: an **Akashic Harmony** effect appears and the chat card reminds the target about the
     reaction Recall Knowledge.
   - **Elemental**: the element dialog appears before the transfer completes; afterwards the target's
     next Strike in the damage dialog should show the chosen damage type instead of its usual one.
   - **Healing**: the chat card lists the afflictions and eligible conditions found on the target.
   - **Rhythm**: any active Anthem, Shuffle Repeat or Remix effect gains a round, and the chat card
     says which effects changed.
7. For a full multiplayer check, have a player transfer vitality to another player's character while
   you are logged in as GM. The GM's client applies the healing, the effect and the harmony's extra
   work, and the player sees an "Applied by the GM's client" note on the summary card.

The bundled offline test suite covers the recharge amounts, both transfer progressions, the capacity
report and its enforcement, the Refocus refill through the action card and through focus restoration,
the resource read/write, the healing call, harmony detection for all five connections, the generated
effect data for each harmony, the dialogs and the guard clauses:

```
node vitality-network/test/smoke-test.mjs
```

It currently reports `116/116 checks passed`.

---

## 6. Macro API

```js
const api = game.sf2eVitalityNetwork;

api.debug(actor);                       // diagnostics for one character
api.source(actor);                      // "classFeature", "archetypeFeat" or null
api.connections(actor);                 // harmonies the actor's connections would grant
api.recharge(actor);                    // turn-start style recharge
api.refocus(actor);                     // rules-driven Refocus refill (class feature only)
api.rechargeToMax(actor);               // fill the network whatever the source
api.checkCapacity(actor);               // compare the maximum with the printed rules
api.checkCapacity(actor, { warnOnce: true });
api.correctCapacities();                // correct every actor (GM only)
api.transfer(actor, { amount: 10 });    // transfer to the targeted token
api.transfer(actor, { amount: 10, targetToken: token.document });
api.applyHarmony(targetActor, { harmony: "shadow", caster: actor });
api.settings();                         // the settings in effect
api.applySettings();                    // re-apply settings after changing them in code
api.diagnostics();                      // open the diagnostics window
api.harmonies;                          // the harmony registry itself
```

The same object is available as `game.modules.get("sf2e-vitality-network").api`.

---

## 7. How it works, and what it depends on

**Telling the two features apart.** The class feature is recognised by its source id
(`...class-features.Item.hNnIAyBxfQ2Howp2`) or by a `Vitality Network` item whose category is
`classfeature`; anything else with that slug or name is treated as the archetype feat. That decides
the transfer progression, the expected capacity and whether the Refocus refill applies.

**Detecting the action.** PF2e posts a chat card when an action is used, so the script listens for
`createChatMessage` and matches the item's slug (`transfer-vitality`) or the trailing id of its
compendium source. Refocus is matched by name or slug in the same handler.

**Detecting the connection.** Each connection is looked up on the actor in two ways: a class feature
item whose compendium source ends in the connection's id (or whose name matches with the
`mystic-connection` tag), and the **Connection** feature's `ChoiceSet` selection stored at
`flags.pf2e.rulesSelections.connection`. The second path covers a mystic who picked their connection
in the Connection item rather than dragging the feature in themselves.

**Reading and writing the resource.** The resource is read from `actor.system.resources` (key
`vitalityNetwork`, with a fallback that finds any resource whose key or label contains "vitalit").
Writing prefers PF2e's own `actor.updateResource()`, then the `SpecialResource` rule element's
`update()`, then a direct actor update, so the script survives changes in how PF2e stores resource
values.

**Detecting spell DC proficiency.** Checked in order: `actor.spellcasting.base.rank`, each
spellcasting entry's statistic rank, `actor.getStatistic("spell-dc")`, and finally
`actor.system.proficiencies.spellcasting`.

**Turn handling.** The script uses `combatStart`, `combatTurnChange` and, if it exists,
`pf2e.startTurn`, deduplicating per combat/combatant/round/turn so several hooks firing for the same
turn only recharge once. Refocus is picked up from the action's chat card and, as a safety net, from
`preUpdateActor`/`updateActor` whenever the focus pool goes up.

**Healing.** `actor.applyDamage({ damage: -amount })` — PF2e treats negative damage as healing, which
is the same path the system uses for healing spells and abilities, and it is what makes the
void-healing clause on the action work without any special handling in this script.

**Multiplayer permissions.** A player cannot edit another player's character. When the acting client
cannot modify the target, it sends the intent over a socket channel (`module.sf2e-vitality-network`),
including which harmony to apply and any element choice, and the GM's client performs the healing,
the effect creation and the harmony's extra work, then acknowledges. If no GM is connected the script
still spends the vitality and tells the player exactly what to apply by hand. The channel trusts the
clients in your world, in the same way as socketlib-based modules do.

---

## 8. Notes and limitations

Shadow Harmony's darkness is a token light source with priority 0. Under Foundry's light rules a
darkness source beats light of the same priority, so it dims ordinary light, lanterns and the like.
If you want a particular magical light to override it, raise that light's priority above 0. The
"attempt to counteract magical light" clause is left to you at the table, as the rules intend, since
counteracting requires a roll and a decision about the source's rank. Because the concealed condition
is granted automatically, remove it manually if the darkness is counteracted but the effect is still
running.

Healing Harmony reports rather than rolls. PF2e's counteract flow needs the effect's rank, the
counteract level and the degree of success, and it is driven from the effect being countered or from
a spell's counteract button; automating that from a world script would mean silently rolling checks
for the player. The chat card instead names every affliction and eligible condition so the GM and
player can resolve the counteract on the Effects tab. It also notices the 19th-level Perfect Harmony
list and the suppression rule.

Rhythm Harmony extends effects it can identify by name or slug (Anthem, Shuffle Repeat, Remix by
default — edit `rhythm.epiphanyNames` if your table names them differently). It only touches effects
the acting client is allowed to edit, and it only reports what it actually changed. Durations marked
`unlimited` or `encounter`, and effects that have already expired, are skipped.

Only one harmony effect is kept per target: using the action on the same target again replaces the
previous one rather than stacking it, whichever connection it came from.

Out of combat, a harmony effect's one-round duration is measured against world time (6 seconds), so
it expires quickly if time advances. If an expired effect lingers on a sheet after a session, its
rule elements are inactive and a GM can simply delete it.

PF2e determines when a round-based effect expires from its origin, which is why the script records
the caster — or, for Elemental Harmony, the target — as the effect's origin. If a future system
release changes that behaviour, check the effect's Origin field on the target's sheet; clearing it or
pointing it at the caster shifts expiry to the caster's turn.

Perfect Harmony abilities (the 19th-level benefits such as Umbral Stride, the memory palace and the
Elemental resistances) are not automated beyond the Healing Harmony condition list and its
suppression note. The archetype feat's capacity formula in the content module is the one data
discrepancy the script knows about, and it corrects it automatically while `capacity.enforce` is on;
everything else follows the printed text.

---

## 9. Troubleshooting

| Symptom | Check |
| --- | --- |
| Nothing happens when the action is used | Confirm the character actually has one of the two features (not just a similarly named one), and that the console shows the script's banner. Enable `verboseLogging` for detail. |
| The module settings have no effect | Check the module is enabled in *Manage Modules*. If the script is installed as a world script instead, the settings are skipped and the `CONFIG` values at the top of the script apply; `game.sf2eVitalityNetwork.settings()` shows which values are actually in effect. |
| No dialog appears for the player | The player's client must be running the script — world scripts load on every client, so check that it is installed on the server's world folder and not only locally. |
| The dialog appears for everyone | Set `singleClientDialogs` to true (default); each client should only react to its own chat card. |
| The transfer maximum is not what you expect | Run `api.debug(actor)` and read `source`, `transferProgression` and `maxTransfer`. An archetype mystic uses the +5 progression (20 at 10th, 25 at 15th, 30 at 20th); set `transfer.progression` to `"houseRule"` for the 10/20/30/40 table. |
| A notification says the network maximum has changed | That is `capacity.enforce` correcting the archetype feat's formula to match its printed text. Set it to false to be told about the difference instead of having it fixed. |
| The network never recharges | Confirm a combat is active, that the actor's turn is actually starting, and run `api.debug(actor)` to see the detected feature and resource. |
| Refocus does not refill the network | Check `refocus.enabled`, and note that the focus-pool fallback needs the character to have a focus pool; `refocus.classFeatureOnly: true` would exclude an archetype mystic. |
| The network recharges or refills several times | Another copy of the script or a similar module is also running; only one client should write to the network. |
| The wrong harmony is applied | Run `api.debug(actor)` and look at `connections` and `harmony`. If the connection was not found, the configured fallback was used; drag the connection class feature onto the actor, or pick it in the Connection item's prompt. |
| The healing is applied but the effect is not | Check the target actor's permissions and whether a GM was connected; the relay needs an active GM. |
| The area does not darken | Confirm the target's token has vision/lighting enabled and that the scene uses darkness or bright light; a negative light source only shows an effect where there is light to reduce. |
| Elemental Harmony does not change the damage type | Check `elemental.damageTypeOverride` is true, and that the Strike's damage dice are the weapon's own; the override changes the base damage type, not added damage such as a rune's. |
| `source.override` | `"auto"` | `"auto"` reads the granting item; the other values force one reading for copies whose source id has been lost. |
