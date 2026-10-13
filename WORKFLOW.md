# SF2E Vitality Network — how the module works

**Version described: 1.6.1** · Foundry v13/v14 · PF2e 8.6.x with sf2e-anachronism, or the SF2e system

This is the full behaviour of the module as it stands, in the order things happen. Nothing here is
aspirational: every step below is implemented and covered by the test suite (152 checks).

---

## 1. What the module listens to

| Trigger | Why |
| --- | --- |
| `init` | Refuses to load in a world that is not PF2e or SF2e, and stands down if a second copy of the script is loaded. |
| `ready` | Applies the registered settings, registers the socket handler, wires the chat hooks, exposes the macro API, and corrects stored network maxima if asked to. |
| `combatStart`, `combatTurnChange` | Recharges the network of whoever's turn begins, once per turn. |
| `preUpdateActor`, `updateActor` | Keeps the network's value and maximum in order when they are edited by hand, and reacts to changes. |
| `createChatMessage` | Recognises the **Transfer Vitality** action card and the **Refocus** card. |
| `renderChatMessageHTML` / `renderChatMessage` | Wires the "Apply …" button on transfer cards. Both names are registered because Foundry has used each in recent versions. |
| `game.socket`, channel `module.sf2e-vitality-network` | The optional GM relay (off by default). |

Only one client acts on any given write: the primary GM, or the actor's owner.

---

## 2. At the start of a turn

1. **Find the network.** The actor's Vitality Network resource is located by rule-element key, by
   name, and by the source ids of the class feature and the archetype feat.
2. **Recharge it.** 4 HP normally; **6** if the actor is master in spell DC; **8** if legendary. The
   rank is read from the base spellcasting proficiency first, then from the spell DC statistic, so
   both a mystic and an archetype caster resolve.
3. **Clamp it.** The value never exceeds the maximum, and never falls below zero.
4. **Enforce the maximum** (`capacity.enforce`, on by default). The stored maximum is rewritten to
   match the printed text: 10 at 1st level, +10 at 10th, 15th and 20th — from the class feature or
   from the archetype feat, whichever grants the network.
5. **Correct on load** (`capacity.correctOnStartup`, on by default). The same correction runs across
   every actor in the world when the world loads, once per session, on the primary GM's client.

The turn recharge happens only in combat (`recharge.inCombatOnly`, on by default) — a turn outside
combat has no initiative to hang the recharge on.

---

## 3. Using Transfer Vitality

```
player clicks the action
        │
        ▼
system posts the action's chat card
        │
        ▼
module recognises it ──── by source UUID, by name/slug, or by the system's own item
        │
        ▼
asks for the amount  (one dialog at a time; a second trigger is ignored while one is open)
        │
        ▼
spends it from the network ── clamped to the transfer maximum and to what the network holds
        │
        ▼
posts the transfer card
```

**The amount dialog.** Its maximum is the source-aware transfer limit — the progression is
configurable (`transfer.progression`) and defaults to the printed text: 10 HP, +5 at 5th, 10th, 15th
and 20th level. It is further clamped to the network's current value, so a network holding 6 HP can
only give 6.

**Spending.** The network is reduced by the amount chosen before anything is applied, and the chat
card is posted even when the healing could not be applied, so the table always sees what was spent.

**Self-transfers** (the caster is their own target) need no target token and always apply locally.

---

## 4. The five harmonies

The caster's connection is read from their class features and feats by source id, with a
name-based fallback and a manual override setting (`transfer.sourceOverride`).

| Connection | Source id (…`class-features.Item.`) | Effect item | What the module does |
| --- | --- | --- | --- |
| **Akashic** | `fM1vlupLq9Zlyt7C` | yes | Attaches an effect whose rules tag `harmony:akashic`, and notes the Recall Knowledge reaction in the card. |
| **Elemental** | `AurhNoZmNNhHktx6` | yes | Asks which element, tags `harmony:elemental:<element>`, and (unless switched off) overrides the next Strike's damage type to that element's damage. |
| **Healing** | `XV8C2ASALC65G5MH` | **no** | Attempts to counteract one affliction, or one condition from the printed list, on the target — adding the wider list at 19th level. Reported in the card. |
| **Rhythm** | `jV9LIUswOPkVRC49` | **no** | Extends any active rhythm epiphany by 1 round, and reports which ones. |
| **Shadow** | `kvmpnKMVw4wwGk8c` | yes | Attaches an effect carrying a negative `TokenLight` (10-foot dim, magical darkness) and grants the Concealed condition; it expires at the end of the caster's next turn. |

Only Akashic, Elemental and Shadow produce an effect item. Healing and Rhythm change the world
directly and are described on the card instead. All five have an item in the compendium; the
Healing and Rhythm ones are reminders, with no rules beyond a roll option.

**Elemental Harmony in the compendium** uses a `ChoiceSet` rule element to ask which elemental
trait applies, writing the selection as the roll option `harmony:elemental:<trait>`. Six
`DamageDice` overrides sit behind predicates — `air` to electricity, `earth` to bludgeoning,
`fire` to fire, `metal` to acid, `water` to bludgeoning, `wood` to piercing. Until a trait is
picked, every rule on that item is ignored, so a freshly applied Elemental Harmony does nothing
at all.

---

## 5. The card

```
**Transfer Vitality** — [SOURCE] transfers [##] HP to [RECIPIENT].
**[Harmony]:** [what that harmony does to the target]
@UUID[Compendium.sf2e-vitality-network.harmonies.Item.<id>]{Effect: [Harmony] Harmony}
@Damage[##[healing]]
```

The two enrichers are what the table interacts with: the effect link is dragged onto the
target, and the healing link renders as a chip whose card carries the Apply Healing button.

- The **healing chip** opens PF2e's own damage card, whose **Apply Healing** button does the work.
  Healing is written as the `healing` flavour — a negative amount would be clamped to 1 by PF2e.
- The **effect link** points at the module's own compendium, `Vitality Network Harmonies`, which
  holds one item per harmony named the way PF2e names effects (`Effect: Shadow Harmony`). Its UUID
  resolves on **any client with the module installed**, so whoever has permission can drag it onto
  the target from the card. Where the pack is missing, a world item of that name is used; where
  neither exists, the button is the fallback.
- If that item cannot be created — a player without permission to create world items — the card
  falls back to a **button** carrying the effect's data, which attaches it to the target for whoever
  presses it.
- When the relay is on and a GM applies the transfer, the card says so instead.
- A failure line appears **only** when a relay was actually attempted and failed.

---

## 6. Refocus

When a Refocus card appears in chat — the system's own action, or a macro such as the workbench's
`Refocus` — the network refills to its maximum. The card is recognised from either its flavour or its
content, since macros often put the word in the flavour. This applies to **both** the class feature and
the archetype feat, which is the default (`refocusClassFeatureOnly` is off). The whole behaviour can be
switched off (`refocusEnabled`).

---

## 7. Settings

| Key | Default | Purpose |
| --- | --- | --- |
| `capacityEnforce` | on | Rewrite the stored maximum to match the printed progression. |
| `capacityCorrectOnStartup` | on | Correct every actor's stored maximum when the world loads. |
| `refocusEnabled` | on | Refill the network when a Refocus card appears. |
| `refocusClassFeatureOnly` | off | Restrict that refill to the class feature. |
| `transferProgression` | printed | The transfer limit by level. |
| `sourceOverride` | off | Force the network's source (class feature or archetype feat). |
| `harmonyFallback` | off | A connection to assume when detection finds none. |
| `harmonyAkashic` … `harmonyShadow` | on | Enable or disable each harmony. |
| `elementalDamageTypeOverride` | on | Let Elemental Harmony change the Strike's damage type. |
| `rechargeInCombatOnly` | on | Only recharge on turns in combat. |
| `postChatSummary` | on | Post the transfer card at all. |
| `singleClientDialogs` | on | Only one transfer dialog at a time. |
| `verboseLogging` | off | Extra console detail. |
| `advancedOverrides` | off | Allow a JSON settings blob to replace the built-in configuration. |

The relay's timings (`relay.timeoutMs`, `relay.perCandidateMs`) and the harmony definitions live in
the configuration rather than the settings form; `game.sf2eVitalityNetwork.config` exposes them.

---

## 8. Macro API

Everything is reachable at `game.sf2eVitalityNetwork` (and `game.modules.get("sf2e-vitality-network").api`).

| Call | Does |
| --- | --- |
| `.debug(actor)` | Prints the actor's network, source, capacity and detected harmony. |
| `.recharge(actor, options)` | Recharges the network, with options for the amount and reason. |
| `.rechargeToMax(actor)` | Fills the network to its maximum. |
| `.refocus(actor)` | Runs the rules-driven Refocus refill. |
| `.source(actor)` | `"classFeature"` or `"archetypeFeat"`. |
| `.checkCapacity(actor, options)` | Compares the stored maximum with the rules, and corrects it if asked. |
| `.correctCapacities()` | Corrects every actor in the world (primary GM only). |
| `.testRelay()` | Pings the table and reports which clients answered as a GM. |
| `.applySettings()` | Re-reads the registered settings into the running configuration. |
| `.settings()` | Every setting this module registers, or the built-in defaults. |
| `.config`, `.harmonies`, `.version` | The live configuration, the harmony definitions, and the version. |

---

## 9. Files

| Path | Contents |
| --- | --- |
| `sf2e-vitality-network/module.json` | The manifest. |
| `sf2e-vitality-network/sf2e-vitality-network.js` | The whole implementation, in one file. |
| `sf2e-vitality-network/lang/en.json` | Localisation keys. |
| `sf2e-vitality-network/styles/vitality-network.css` | Card styling. |
| `sf2e-vitality-network/*-harmony-effect.json` | Reference effect items for hand-made copies. |
| `sf2e-vitality-network/packs/harmonies/` | The compendium, in Foundry's LevelDB format. |
| `pack-sources/*.json` | The pack's items as readable JSON; the pack is built from these. |
| `test/smoke-test.mjs` | The 148-check suite (`node test/smoke-test.mjs`). |
| `dist/` | Packaged releases. |

---

## 10. What is deliberately *not* automated

- **No automatic healing of a character the caster cannot write to.** The card hands that to the
  table, which is why it exists in its current form.
- **No automatic effect application on those characters either** — the card links the effect, and
  whoever has permission drags or presses it.
- **No attempt to detect or counteract light sources** for Shadow Harmony beyond PF2e's own
  `TokenLight` handling: the effect is a negative light source, which is what magical darkness is.
