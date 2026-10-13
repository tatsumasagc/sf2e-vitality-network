/* ============================================================================
 *  SF2E VITALITY NETWORK — World Script
 *  Foundry VTT v14  ·  Pathfinder Second Edition 8.6.0  ·  sf2e-anachronism
 *  ---------------------------------------------------------------------------
 *  Automates the Starfinder 2e Mystic "Vitality Network" ability and the
 *  Harmony that a mystic's connection applies when vitality is transferred.
 *
 *  It works for the mystic class itself and for the Mystic archetype feat
 *  (Compendium.sf2e-anachronism.feats.Item.kK5JtGm6PQh7DT7Q), and it supports
 *  all five connections: Akashic, Elemental, Healing, Rhythm and Shadow.
 *
 *  SYSTEMS
 *  Runs on PF2e with the Starfinder Anachronism module (Compendium.
 *  sf2e-anachronism.*) and on the SF2e system itself (Compendium.sf2e.*). The
 *  item ids are the same in both, so content is matched on the trailing id, and
 *  system flags are read from whichever namespace the running system uses. The
 *  guards below accept both systems and stay inert on anything else.
 *
 *   1. TURN-START RECHARGE
 *      At the start of the character's turn in combat, the Vitality Network
 *      special resource regains 4 HP — or 6 if the character is master in
 *      spell DC, or 8 if legendary.
 *
 *   2. REFOCUS
 *      "When you Refocus, your vitality network regains all its Hit Points."
 *      (The class feature's clause: the archetype feat does not grant it.)
 *
 *   3. TRANSFER VITALITY
 *      Using the "Transfer Vitality" action opens a dialog asking how many HP
 *      to transfer (default = maximum). The network is reduced by that amount
 *      and the targeted token is healed by the same amount.
 *      The maximum follows the printed text of whichever feature the actor has
 *      — 10 with +10 steps at 5th, 10th, 15th and 20th for the class feature,
 *      and 10 with +5 steps for the archetype feat — and never exceeds the
 *      network's current value.
 *
 *   4. CAPACITY
 *      The network's maximum is compared with the printed rules (6 + 4 HP per
 *      level for the class feature). Set capacity.enforce to true to rewrite
 *      the granting item's formula when the content module disagrees.
 *
 *   5. HARMONY
 *      The target receives an effect carrying the rule elements of the
 *      caster's connection harmony (darkness and concealment for Shadow, a
 *      reaction Recall Knowledge for Akashic, a damage-type substitution for
 *      Elemental), while Healing and Rhythm harmonies act on the transfer
 *      itself and report what they did in chat. See the HARMONIES table below.
 *
 *  The script is defensive: every PF2e API it uses is feature-detected, and
 *  nothing is executed outside of combat/turn or action-use events.
 *
 *  USAGE
 *  This file is the entry point of the module described by module.json. It has
 *  no imports, so it can equally be used as a world script: the settings layer
 *  is skipped when the module is not registered, and the built-in CONFIG values
 *  above then apply unchanged.
 * ========================================================================== */

(() => {
    "use strict";

    /* ---------------------------------------------------------------------- */
    /*  1. CONFIGURATION — edit these values to taste                          */
    /* ---------------------------------------------------------------------- */

    const MODULE_ID = "sf2e-vitality-network";
    const SCRIPT_ID = MODULE_ID; // flag namespace, kept stable for existing effects
    const SOCKET_CHANNEL = `module.${MODULE_ID}`;
    const VERSION = "1.4.5";
    const SOURCE_BOOK = "Starfinder Player Core";

    /** The feat that turns the transfer automation on (matched on item id). */
    const FEAT_SOURCE_ID = "Compendium.sf2e-anachronism.feats.Item.kK5JtGm6PQh7DT7Q";
    const FEAT_ID_SUFFIX = "kK5JtGm6PQh7DT7Q";

    /** The mystic class feature that grants the full-size network. */
    const CLASS_FEATURE_SOURCE_ID = "Compendium.sf2e-anachronism.class-features.Item.hNnIAyBxfQ2Howp2";
    const CLASS_FEATURE_ID_SUFFIX = "hNnIAyBxfQ2Howp2";
    const CLASS_FEATURE_CAPACITY_FORMULA = "6 + @actor.level*4";

    /**
     * The same content ships twice: as the Starfinder Anachronism module for the
     * PF2e system (Compendium.sf2e-anachronism.*) and inside the SF2e system
     * itself (Compendium.sf2e.*). The item ids are identical, so matching on the
     * trailing id covers both. SF2e also creates the class feature directly on
     * the actor, where only the item id inside an Actor uuid survives; that id is
     * listed as well, and the name/category check catches the rest.
     */
    const CONTENT_PACKAGES = ["sf2e-anachronism", "sf2e"];
    const SF2E_EMBEDDED_CLASS_FEATURE_ID_SUFFIX = "2OvKQHIMWuB4zFWm";

    /** The systems this module runs on: PF2e (either content route) and SF2e. */
    const SUPPORTED_SYSTEMS = new Set(["pf2e", "sf2e"]);

    /** The "Transfer Vitality" action (slug + trailing id, either will match). */
    const TRANSFER_ACTION_SLUG = "transfer-vitality";
    const TRANSFER_ACTION_ID_SUFFIX = "UeMHbnnaXDa3sGfG";

    /** The SpecialResource slug declared by Vitality Network. */
    const RESOURCE_SLUG = "vitalityNetwork";

    /** PF2e compendium UUID of the concealed condition. */
    /** Candidate compendium UUIDs of the concealed condition (same item id). */
    function concealedUuids() {
        const systemId = game.system?.id ?? "pf2e";
        return [
            `Compendium.${systemId}.conditionitems.Item.DmAIPqOBomZ7H95W`,
            "Compendium.pf2e.conditionitems.Item.DmAIPqOBomZ7H95W",
            "Compendium.sf2e.conditionitems.Item.DmAIPqOBomZ7H95W",
        ];
    }

    /**
     * The concealed-condition uuid to grant. The running system's own pack comes
     * first, and the first candidate that actually resolves wins, so a world that
     * keeps the condition elsewhere still gets the right reference.
     */
    function concealedUuid() {
        for (const uuid of concealedUuids()) {
            try {
                if (typeof fromUuidSync === "function" && fromUuidSync(uuid)) return uuid;
            } catch {
                // try the next candidate
            }
        }
        return concealedUuids()[0];
    }

    const CONFIG = {
        /* --- 1. Turn-start recharge ---------------------------------------- */
        recharge: { trained: 4, master: 6, legendary: 8 },

        /* --- 2. Transfer Vitality ------------------------------------------ */
        // How much can be transferred, as [minimum level, maximum HP] pairs.
        //
        // The printed rules differ between the two ways of getting a network:
        //   Vitality Network class feature (hNnIAyBxfQ2Howp2) grants the
        //     Transfer Vitality action, whose text gives 10 HP increasing by
        //     10 at 5th, 10th, 15th and 20th level.
        //   Vitality Network archetype feat (kK5JtGm6PQh7DT7Q) gives 10 HP
        //     increasing by 5 at 5th, 10th, 15th and 20th level.
        transfer: {
            // "source" follows the feature the actor actually has; the other
            // values force one table for the whole table.
            progression: "source",
            classFeature: [
                [20, 50],
                [15, 40],
                [10, 30],
                [5, 20],
                [1, 10],
            ],
            archetypeFeat: [
                [20, 30],
                [15, 25],
                [10, 20],
                [5, 15],
                [1, 10],
            ],
            // The simple table this script used first, before the printed
            // progressions were confirmed: 10, then 20 at 10th, 30 at 15th,
            // 40 at 20th.
            houseRule: [
                [20, 40],
                [15, 30],
                [10, 20],
                [1, 10],
            ],
        },

        /* --- 2c. Which feature grants the network -------------------------- */
        // "auto" reads the granting item. The other values force one reading,
        // for copies whose source id has been lost (see the module setting).
        source: { override: "auto" },

        /* --- 2b. Capacity and Refocus -------------------------------------- */
        // "Your vitality network has a maximum capacity equal to 6 + 4 Hit
        // Points per level." The system stores the maximum on the granting
        // item's SpecialResource rule, and the archetype feat's own formula
        // steps at 5th, 10th, 15th and 20th while its printed text steps at
        // 10th, 15th and 20th. With enforce on, the formula is rewritten to
        // match the text; set it to false to only report the difference.
        capacity: {
            classFeature: (level) => 6 + level * 4,
            archetypeFeat: (level) => 10 + [10, 15, 20].filter((min) => level >= min).length * 10,
            enforce: true,
            // The formula written into the item's SpecialResource rule when
            // enforcing the archetype feat's capacity.
            archetypeFeatFormula:
                "10 + 10*min(1, floor(@actor.level/10)) + 10*min(1, floor(@actor.level/15))" +
                " + 10*min(1, floor(@actor.level/20))",
            // Correct stored maxima once as the world loads (primary GM only),
            // so sheets match the printed text before anyone uses the action.
            correctOnStartup: true,
        },

        // "When you Refocus, your vitality network regains all its Hit Points."
        refocus: {
            enabled: true,
            // Strictly read, the clause belongs to the class feature only. The
            // script applies it to the archetype feat as well; set this to true
            // to restrict it to characters with the class feature.
            classFeatureOnly: false,
            // Item names or slugs that count as the Refocus action.
            actionSlugs: ["refocus"],
            // Refocus macros (xdy-pf2e-workbench, for example) post a card with no
            // item attached, so the card's own text is the only clue.
            detectCards: true,
            // Also refill whenever focus points are restored, which covers
            // resting and any Refocus the chat card does not identify.
            watchFocusIncrease: true,
        },

        minTransfer: 1,
        // Warn (never block) when the target is further away than the action's range.
        warnBeyondRange: true,
        rangeFeet: 60,
        // If no token is targeted, offer to heal the acting character instead
        // (the action may be used on yourself). Set false to simply cancel.
        offerSelfWhenUntargeted: true,

        /* --- 3. Harmony ---------------------------------------------------- */
        // Which harmony to use when no mystic connection can be found on the
        // actor. Set to null to attach no harmony at all in that case.
        harmonyFallback: "shadow",
        // Individual harmonies can be switched off here.
        harmonies: { akashic: true, elemental: true, healing: true, rhythm: true, shadow: true },

        // Duration of the harmony effect: rounds, expiring at turn end. The turn
        // it expires on follows the rules text (the caster's next turn for
        // Shadow and Akashic, the target's next turn for Elemental).
        effect: {
            rounds: 1,
            icon: "systems/pf2e/icons/default-icons/effect.svg",
            // Shadow harmony darkness: bright 0 / dim 10 = a 10-foot emanation
            // in which bright light becomes dim light.
            darkness: { bright: 0, dim: 10, color: "#000000", alpha: 0.5, priority: 0 },
            grantConcealed: true,
        },

        // Elemental harmony: ask which element, and (optionally) let the effect
        // change the target's Strike damage type as the rules describe.
        elemental: {
            promptForElement: true,
            // Applies `override.damageType` to strike damage while the effect
            // lasts. PF2e cannot limit an override to a single Strike, so with
            // this on, every Strike the target makes before the effect expires
            // deals the chosen damage type (delete the effect after the first
            // Strike if that matters at your table).
            damageTypeOverride: true,
        },

        // Rhythm harmony: effects created by the connection's epiphany spells
        // have their duration extended by this many rounds.
        rhythm: {
            extraRounds: 1,
            // Matched against an effect's name and slug (case-insensitive).
            epiphanyNames: ["anthem", "shuffle repeat", "shuffle-repeat", "remix"],
            // The GM's client also looks through every actor in the world.
            gmSearchesAllActors: true,
        },

        // Healing harmony: conditions the harmony may counteract.
        healing: {
            conditions: ["blinded", "clumsy", "dazzled", "deafened", "enfeebled", "sickened"],
            // Perfect Harmony (19th level) adds these to the list.
            perfectHarmonyLevel: 19,
            perfectHarmonyConditions: ["doomed", "drained", "paralyzed", "stunned"],
        },

        /* --- 4. Behaviour -------------------------------------------------- */
        // Only respond to the action's chat card on the client that created it
        // (prevents one dialog per connected player).
        singleClientDialogs: true,
        // If the acting player cannot modify the target actor, ask the GM's
        // client (over a socket) to apply the healing and the harmony.
        relayToGM: true,
        relayTimeoutMs: 8000,
        // Each named GM is given this long to answer before the next is asked.
        relayPerCandidateMs: 4000,
        postChatSummary: true,
        // Only run the recharge while a combat is active.
        rechargeInCombatOnly: true,
        // Set true to trace the script's decisions in the browser console.
        verboseLogging: false,
    };

    /* ---------------------------------------------------------------------- */
    /*  1b. MODULE SETTINGS                                                    */
    /* ---------------------------------------------------------------------- */
    // Registered when this file is loaded as a Foundry module. Used as a world
    // script, the built-in CONFIG values above apply unchanged.

    const _loc = (key, data) =>
        data && typeof game.i18n?.format === "function"
            ? game.i18n.format(key, data)
            : (game.i18n?.localize?.(key) ?? key);

    /** Deep copy of a CONFIG subtree that keeps function references intact. */
    function cloneConfig(value) {
        if (Array.isArray(value)) return value.map(cloneConfig);
        if (value && typeof value === "object") {
            const copy = {};
            for (const [key, item] of Object.entries(value)) copy[key] = cloneConfig(item);
            return copy;
        }
        return value; // primitives and functions
    }

    /**
     * Put CONFIG's data back to the built-in defaults, leaving functions (the
     * capacity formulas) alone. Settings and JSON overrides are layered on top
     * of this, so removing an override restores the value it replaced.
     */
    function restoreDefaults(target, defaults) {
        for (const [key, value] of Object.entries(defaults)) {
            if (typeof value === "function") continue;
            if (Array.isArray(value)) {
                target[key] = cloneConfig(value);
            } else if (value && typeof value === "object") {
                if (!target[key] || typeof target[key] !== "object") target[key] = {};
                restoreDefaults(target[key], value);
            } else {
                target[key] = value;
            }
        }
    }

    // Captured before anything mutates CONFIG.
    const CONFIG_DEFAULTS = cloneConfig(CONFIG);

    const SETTING_DEFINITIONS = [
        {
            key: "capacityEnforce",
            type: Boolean,
            default: CONFIG.capacity.enforce,
            name: "SF2E-VN.Settings.CapacityEnforce.Name",
            hint: "SF2E-VN.Settings.CapacityEnforce.Hint",
            apply: (value) => {
                CONFIG.capacity.enforce = value;
            },
        },
        {
            key: "capacityCorrectOnStartup",
            type: Boolean,
            default: CONFIG.capacity.correctOnStartup,
            name: "SF2E-VN.Settings.CapacityCorrectOnStartup.Name",
            hint: "SF2E-VN.Settings.CapacityCorrectOnStartup.Hint",
            apply: (value) => {
                CONFIG.capacity.correctOnStartup = value;
            },
        },
        {
            key: "refocusEnabled",
            type: Boolean,
            default: CONFIG.refocus.enabled,
            name: "SF2E-VN.Settings.RefocusEnabled.Name",
            hint: "SF2E-VN.Settings.RefocusEnabled.Hint",
            apply: (value) => {
                CONFIG.refocus.enabled = value;
            },
        },
        {
            key: "refocusClassFeatureOnly",
            type: Boolean,
            default: CONFIG.refocus.classFeatureOnly,
            name: "SF2E-VN.Settings.RefocusClassFeatureOnly.Name",
            hint: "SF2E-VN.Settings.RefocusClassFeatureOnly.Hint",
            apply: (value) => {
                CONFIG.refocus.classFeatureOnly = value;
            },
        },
        {
            key: "transferProgression",
            type: String,
            default: CONFIG.transfer.progression,
            choices: {
                source: "SF2E-VN.Settings.TransferProgression.Source",
                classFeature: "SF2E-VN.Settings.TransferProgression.ClassFeature",
                archetypeFeat: "SF2E-VN.Settings.TransferProgression.ArchetypeFeat",
                houseRule: "SF2E-VN.Settings.TransferProgression.HouseRule",
            },
            name: "SF2E-VN.Settings.TransferProgression.Name",
            hint: "SF2E-VN.Settings.TransferProgression.Hint",
            apply: (value) => {
                CONFIG.transfer.progression = value;
            },
        },
        {
            key: "sourceOverride",
            type: String,
            default: CONFIG.source.override,
            choices: {
                auto: "SF2E-VN.Settings.SourceOverride.Auto",
                classFeature: "SF2E-VN.Settings.SourceOverride.ClassFeature",
                archetypeFeat: "SF2E-VN.Settings.SourceOverride.ArchetypeFeat",
            },
            name: "SF2E-VN.Settings.SourceOverride.Name",
            hint: "SF2E-VN.Settings.SourceOverride.Hint",
            apply: (value) => {
                CONFIG.source.override = value;
            },
        },
        {
            key: "harmonyFallback",
            type: String,
            default: CONFIG.harmonyFallback ?? "none",
            choices: {
                shadow: "SF2E-VN.Harmony.Shadow",
                akashic: "SF2E-VN.Harmony.Akashic",
                elemental: "SF2E-VN.Harmony.Elemental",
                healing: "SF2E-VN.Harmony.Healing",
                rhythm: "SF2E-VN.Harmony.Rhythm",
                none: "SF2E-VN.Settings.HarmonyFallback.None",
            },
            name: "SF2E-VN.Settings.HarmonyFallback.Name",
            hint: "SF2E-VN.Settings.HarmonyFallback.Hint",
            apply: (value) => {
                CONFIG.harmonyFallback = value === "none" ? null : value;
            },
        },
        {
            key: "harmonyAkashic",
            type: Boolean,
            default: CONFIG.harmonies.akashic,
            name: "SF2E-VN.Settings.HarmonyAkashic.Name",
            apply: (value) => {
                CONFIG.harmonies.akashic = value;
            },
        },
        {
            key: "harmonyElemental",
            type: Boolean,
            default: CONFIG.harmonies.elemental,
            name: "SF2E-VN.Settings.HarmonyElemental.Name",
            apply: (value) => {
                CONFIG.harmonies.elemental = value;
            },
        },
        {
            key: "harmonyHealing",
            type: Boolean,
            default: CONFIG.harmonies.healing,
            name: "SF2E-VN.Settings.HarmonyHealing.Name",
            apply: (value) => {
                CONFIG.harmonies.healing = value;
            },
        },
        {
            key: "harmonyRhythm",
            type: Boolean,
            default: CONFIG.harmonies.rhythm,
            name: "SF2E-VN.Settings.HarmonyRhythm.Name",
            apply: (value) => {
                CONFIG.harmonies.rhythm = value;
            },
        },
        {
            key: "harmonyShadow",
            type: Boolean,
            default: CONFIG.harmonies.shadow,
            name: "SF2E-VN.Settings.HarmonyShadow.Name",
            apply: (value) => {
                CONFIG.harmonies.shadow = value;
            },
        },
        {
            key: "elementalDamageTypeOverride",
            type: Boolean,
            default: CONFIG.elemental.damageTypeOverride,
            name: "SF2E-VN.Settings.ElementalDamageTypeOverride.Name",
            hint: "SF2E-VN.Settings.ElementalDamageTypeOverride.Hint",
            apply: (value) => {
                CONFIG.elemental.damageTypeOverride = value;
            },
        },
        {
            key: "rechargeInCombatOnly",
            type: Boolean,
            default: CONFIG.rechargeInCombatOnly,
            name: "SF2E-VN.Settings.RechargeInCombatOnly.Name",
            hint: "SF2E-VN.Settings.RechargeInCombatOnly.Hint",
            apply: (value) => {
                CONFIG.rechargeInCombatOnly = value;
            },
        },
        {
            key: "postChatSummary",
            type: Boolean,
            default: CONFIG.postChatSummary,
            name: "SF2E-VN.Settings.PostChatSummary.Name",
            apply: (value) => {
                CONFIG.postChatSummary = value;
            },
        },
        {
            key: "relayToGM",
            type: Boolean,
            default: CONFIG.relayToGM,
            name: "SF2E-VN.Settings.RelayToGM.Name",
            hint: "SF2E-VN.Settings.RelayToGM.Hint",
            apply: (value) => {
                CONFIG.relayToGM = value;
            },
        },
        {
            key: "singleClientDialogs",
            type: Boolean,
            default: CONFIG.singleClientDialogs,
            name: "SF2E-VN.Settings.SingleClientDialogs.Name",
            hint: "SF2E-VN.Settings.SingleClientDialogs.Hint",
            apply: (value) => {
                CONFIG.singleClientDialogs = value;
            },
        },
        {
            key: "verboseLogging",
            type: Boolean,
            scope: "client",
            default: CONFIG.verboseLogging,
            name: "SF2E-VN.Settings.VerboseLogging.Name",
            hint: "SF2E-VN.Settings.VerboseLogging.Hint",
            apply: (value) => {
                CONFIG.verboseLogging = value;
            },
        },
        {
            key: "advancedOverrides",
            type: String,
            default: "{}",
            name: "SF2E-VN.Settings.AdvancedOverrides.Name",
            hint: "SF2E-VN.Settings.AdvancedOverrides.Hint",
            apply: null, // handled by applyAdvancedOverrides()
            onChange: () => applySettings(),
        },
    ];

    let settingsRegistered = false;

    /** Register every setting. Returns false when not loaded as a module. */
    function registerSettings() {
        if (!game.modules?.get?.(MODULE_ID) || typeof game.settings?.register !== "function") {
            log("Not loaded as a registered module; the built-in defaults apply.");
            return false;
        }

        for (const definition of SETTING_DEFINITIONS) {
            try {
                game.settings.register(MODULE_ID, definition.key, {
                    name: _loc(definition.name),
                    hint: definition.hint ? _loc(definition.hint) : undefined,
                    scope: definition.scope ?? "world",
                    config: definition.config !== false,
                    type: definition.type,
                    choices: definition.choices,
                    default: definition.default,
                    onChange: () => (definition.onChange ? definition.onChange() : applySetting(definition)),
                });
            } catch (err) {
                error(`Could not register the "${definition.key}" setting.`, err);
            }
        }

        settingsRegistered = true;
        return true;
    }

    /** Push one stored setting into CONFIG. */
    function applySetting(definition) {
        if (!definition.apply) return;
        try {
            definition.apply(game.settings.get(MODULE_ID, definition.key));
        } catch (err) {
            log(`Could not read the "${definition.key}" setting.`, err);
        }
    }

    /** Push every stored setting into CONFIG, then layer the JSON overrides. */
    function applySettings() {
        // Start from the built-in defaults, so a setting or override that has
        // been removed cannot leave a stale value behind.
        restoreDefaults(CONFIG, CONFIG_DEFAULTS);

        if (settingsRegistered) {
            for (const definition of SETTING_DEFINITIONS) applySetting(definition);
        }
        applyAdvancedOverrides();
    }

    /** Merge plain data from the "advanced overrides" setting into CONFIG. */
    function applyAdvancedOverrides() {
        if (!settingsRegistered) return false;

        let parsed;
        try {
            const raw = game.settings.get(MODULE_ID, "advancedOverrides");
            parsed = raw ? JSON.parse(raw) : {};
        } catch (err) {
            warn("The advanced overrides setting is not valid JSON; it has been ignored.");
            return false;
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;

        mergeOverrides(CONFIG, parsed);
        return true;
    }

    /**
     * Deep-merge plain data into CONFIG. Unknown keys and functions are left
     * alone, so the capacity formulas cannot be replaced by accident.
     */
    function mergeOverrides(target, source) {
        for (const [key, value] of Object.entries(source ?? {})) {
            if (!(key in target)) continue;
            const current = target[key];
            if (typeof current === "function") continue;

            const bothPlainObjects =
                value && current && typeof value === "object" && typeof current === "object" &&
                !Array.isArray(value) && !Array.isArray(current);
            if (bothPlainObjects) {
                mergeOverrides(current, value);
            } else if (typeof value !== "undefined") {
                target[key] = value;
            }
        }
    }

    /* ---------------------------------------------------------------------- */
    /*  2. SMALL HELPERS                                                       */
    /* ---------------------------------------------------------------------- */

    const LOG_PREFIX = "SF2E Vitality Network |";

    const log = (...args) => (CONFIG.verboseLogging ? console.log(LOG_PREFIX, ...args) : undefined);
    const warn = (msg) => ui.notifications.warn(`${LOG_PREFIX} ${msg}`);
    const info = (msg) => ui.notifications.info(`${LOG_PREFIX} ${msg}`);
    const error = (msg, err) => console.error(LOG_PREFIX, msg, err ?? "");

    /** Only one client should ever apply world-state changes for a given turn. */
    /** Every GM who is currently connected. */
    const activeGms = () =>
        Array.from(game.users?.contents ?? []).filter((user) => user?.isGM && user.active !== false);

    const anyGmOnline = () => activeGms().length > 0;
    /**
     * The GM clients a player should ask, in order. The client Foundry designates
     * as `activeGM` goes first; the rest of the connected GMs follow, so a world
     * with two GM sessions never depends on them agreeing about who is primary.
     */
    const gmCandidates = () => {
        const gms = activeGms()
            .slice()
            .sort((a, b) => String(a.id).localeCompare(String(b.id)));
        const designated = game.users?.activeGM;
        if (designated && gms.includes(designated)) {
            return [designated, ...gms.filter((user) => user !== designated)];
        }
        return gms;
    };

    /** Replies collected by {@link testRelay}. */
    const relayPingReplies = [];

    /**
     * The one GM client that performs GM-only work. Normally that is the user
     * Foundry designates as `activeGM`; when Foundry has not designated one, the
     * lowest-id connected GM takes the job rather than nothing happening at all.
     */
    const isPrimaryGM = () => {
        if (!game.user?.isGM) return false;
        if (game.users?.activeGM) return game.user === game.users.activeGM;
        const gms = activeGms()
            .slice()
            .sort((a, b) => String(a.id).localeCompare(String(b.id)));
        return gms.length > 0 && gms[0] === game.user;
    };

    const levelOf = (actor) => {
        const level = actor?.level ?? actor?.system?.details?.level?.value ?? 0;
        return Number.isFinite(level) ? Number(level) : 0;
    };

    /** The Item documents an actor owns, whatever the collection looks like. */
    const itemsOf = (actor) => actor?.items?.contents ?? [];

    /** The TokenDocument that speaks for an actor: controlled first, then active. */
    function findTokenDocument(actor) {
        if (!actor) return null;
        try {
            const controlled = Array.from(canvas?.tokens?.controlled ?? []).find(
                (token) => token.actor?.uuid === actor.uuid,
            );
            if (controlled?.document) return controlled.document;
            if (actor.token) return actor.token;
            return actor.getActiveTokens?.(false, true)?.[0] ?? null;
        } catch (err) {
            return null;
        }
    }

    /** The source id of an item, whichever of the two ways PF2e recorded it. */
    const sourceIdOf = (item) => item?.sourceId ?? item?._stats?.compendiumSource ?? null;

    const matchesIdSuffix = (sourceId, suffix) =>
        typeof sourceId === "string" && (sourceId === `Item.${suffix}` || sourceId.endsWith(`.${suffix}`));

    /**
     * The system's flags on a document. PF2e records its own data under
     * `flags.pf2e`; a forked system may use its own id instead, so try the
     * running system first and both known namespaces after it.
     */
    function systemFlags(document) {
        const flags = document?.flags;
        if (!flags) return {};
        const systemId = game.system?.id;
        return (systemId ? flags[systemId] : null) ?? flags.pf2e ?? flags.sf2e ?? {};
    }

    /** Does this actor have the Vitality Network feat or class feature? */
    function hasVitalityFeat(actor) {
        return vitalitySource(actor).kind !== null;
    }

    /** Is this item the Transfer Vitality action? */
    function isTransferVitalityAction(item) {
        if (!item) return false;
        if ((item.slug ?? "") === TRANSFER_ACTION_SLUG) return true;
        if (matchesIdSuffix(sourceIdOf(item), TRANSFER_ACTION_ID_SUFFIX)) return true;
        return item.name === "Transfer Vitality";
    }

    /* ---------------------------------------------------------------------- */
    /*  2b. WHICH FEATURE GRANTS THE NETWORK, AND HOW FAR IT GOES              */
    /* ---------------------------------------------------------------------- */

    /**
     * Where an actor's vitality network comes from, which decides both the
     * transfer progression and the capacity.
     * @returns {{kind: "classFeature"|"archetypeFeat"|null, item: object|null}}
     */
    function vitalitySource(actor) {
        const items = itemsOf(actor);
        const isVitalityNetwork = (item) =>
            (item?.slug ?? "") === "vitality-network" || item?.name === "Vitality Network";
        // "classfeature", "class-feature" and "classFeature" mean the same thing.
        const isClassFeatureCategory = (item) =>
            String(item?.system?.category ?? "")
                .replace(/[^a-z]/gi, "")
                .toLowerCase() === "classfeature";

        // (a) the mystic class feature: 6 + 4 HP per level
        const classFeature =
            items.find((item) => {
                const sourceId = sourceIdOf(item);
                if (sourceId === CLASS_FEATURE_SOURCE_ID) return true;
                if (matchesIdSuffix(sourceId, CLASS_FEATURE_ID_SUFFIX)) return true;
                if (matchesIdSuffix(sourceId, SF2E_EMBEDDED_CLASS_FEATURE_ID_SUFFIX)) return true;
                return isVitalityNetwork(item) && isClassFeatureCategory(item);
            }) ?? null;

        // (b) the archetype feat: 10 HP, increasing by steps
        const feat =
            items.find((item) => {
                const sourceId = sourceIdOf(item);
                if (sourceId === FEAT_SOURCE_ID) return true;
                if (matchesIdSuffix(sourceId, FEAT_ID_SUFFIX)) return true;
                return item.type === "feat" && isVitalityNetwork(item) && !isClassFeatureCategory(item);
            }) ?? null;

        // An explicit override settles ambiguous copies, but only when the actor
        // really has one of the two, so it can never invent a network.
        const override = CONFIG.source?.override ?? "auto";
        if (override === "classFeature" && (classFeature || feat)) {
            return { kind: "classFeature", item: classFeature ?? feat, overridden: true };
        }
        if (override === "archetypeFeat" && (classFeature || feat)) {
            return { kind: "archetypeFeat", item: feat ?? classFeature, overridden: true };
        }

        if (classFeature) return { kind: "classFeature", item: classFeature };
        if (feat) return { kind: "archetypeFeat", item: feat };

        return { kind: null, item: null };
    }

    /** The network's maximum capacity according to the printed rules. */
    function expectedCapacity(kind, level) {
        if (kind === "classFeature") return CONFIG.capacity.classFeature(level);
        if (kind === "archetypeFeat") return CONFIG.capacity.archetypeFeat(level);
        return null;
    }

    const capacityReported = new Set();

    /**
     * Compare the network's stored maximum against the printed rules. With
     * `capacity.enforce` on, the granting item's SpecialResource formula is
     * rewritten; otherwise a disagreement is reported once per actor.
     */
    async function checkCapacity(actor, { warnOnce = false } = {}) {
        const resource = getResourceInfo(actor);
        const source = vitalitySource(actor);
        if (!resource || !source.kind) return null;

        const level = levelOf(actor);
        const expected = expectedCapacity(source.kind, level);
        if (expected === null || resource.max === expected) {
            return { expected, actual: resource.max, matches: true };
        }

        if (CONFIG.capacity.enforce) {
            const formula =
                source.kind === "classFeature" ? CLASS_FEATURE_CAPACITY_FORMULA : CONFIG.capacity.archetypeFeatFormula;
            const rules = source.item?.system?.rules ?? [];
            const index = rules.findIndex((rule) => rule?.key === "SpecialResource");
            if (index >= 0 && rules[index].max !== formula) {
                try {
                    await source.item.update({ [`system.rules.${index}.max`]: formula });
                    // The actor re-prepares as part of that update, so read the
                    // maximum back rather than assuming it landed.
                    const refreshed = getResourceInfo(actor);
                    const actual = refreshed?.max ?? expected;
                    info(
                        `${actor.name}'s vitality network maximum is now ${actual} HP ` +
                            `(${source.item.name}, level ${level}).`,
                    );
                    return { expected, actual, matches: actual === expected, enforced: true };
                } catch (err) {
                    error("Could not correct the vitality network maximum.", err);
                }
            }
        } else if (warnOnce && !capacityReported.has(actor.uuid)) {
            capacityReported.add(actor.uuid);
            warn(
                `${actor.name}'s vitality network maximum is ${resource.max} HP, but ${SOURCE_BOOK} gives ` +
                    `${expected} HP at level ${level}. Set capacity.enforce to true to correct it automatically.`,
            );
        }

        return { expected, actual: resource.max, matches: false };
    }

    /**
     * Bring every actor's stored network maximum in line with the printed
     * rules. Only the primary GM's client runs this.
     * @returns {Promise<number>} how many actors were corrected
     */
    async function correctCapacities() {
        if (!isPrimaryGM()) return 0;

        let corrected = 0;
        for (const actor of game.actors ?? []) {
            if (!hasVitalityFeat(actor)) continue;
            try {
                const report = await checkCapacity(actor);
                if (report?.enforced) corrected += 1;
            } catch (err) {
                log(`Capacity check failed for ${actor?.name}.`, err);
            }
        }

        if (corrected > 0) log(`Corrected ${corrected} vitality network maximum(s).`);
        return corrected;
    }

    /** Fill the network to its maximum. Returns the Hit Points restored. */
    async function fillVitalityNetwork(actor) {
        const resource = getResourceInfo(actor);
        if (!resource || resource.value >= resource.max) return 0;
        const after = await setResourceValue(actor, resource.key, resource.max);
        if (after === null) return 0;
        return after - resource.value;
    }

    /** "When you Refocus, your vitality network regains all its Hit Points." */
    async function refocusRecharge(actor, { reason = "Refocus", ignoreSourceRule = false } = {}) {
        if (!CONFIG.refocus.enabled || !actor) return 0;

        const source = vitalitySource(actor);
        if (!source.kind) return 0;
        if (!ignoreSourceRule && CONFIG.refocus.classFeatureOnly && source.kind !== "classFeature") return 0;
        if (!canWriteFor(actor)) return 0;

        const gained = await fillVitalityNetwork(actor);
        if (gained > 0) {
            log(`${actor.name}: vitality network refilled on ${reason} (+${gained})`);
            info(`${actor.name}'s vitality network regains all its Hit Points (${gained} HP) — ${reason}.`);
        }
        return gained;
    }

    /** Is this item the Refocus action? */
    function isRefocusAction(item) {
        if (!item) return false;
        const haystack = `${item.slug ?? ""} ${item.name ?? ""}`.toLowerCase();
        return (CONFIG.refocus.actionSlugs ?? []).some((slug) => haystack.includes(String(slug).toLowerCase()));
    }

    /**
     * Did this card come from a Refocus that carries no item? The workbench macro
     * posts plain text, so the wording is the only evidence available.
     */
    function isRefocusCard(message) {
        if (!CONFIG.refocus.detectCards) return false;
        // The workbench macro puts "Refocus" in the card's *flavour* and leaves the
        // content as the localised "regains N focus points" line, so both matter.
        const text = [message?.content, message?.flavor, message?.flavour]
            .filter((part) => typeof part === "string" && part.length > 0)
            .join(" ")
            .replace(/<[^>]*>/g, " ");
        if (!text.trim()) return false;
        return /\brefocus(?:ing|ed)?\b/i.test(text);
    }

    /** The maximum transferable HP at a level, per the configured progression. */
    function maxTransferForLevel(level, sourceKind = null) {
        const tables = CONFIG.transfer;
        const chosen = (() => {
            switch (tables.progression) {
                case "classFeature":
                    return tables.classFeature;
                case "archetypeFeat":
                    return tables.archetypeFeat;
                case "houseRule":
                    return tables.houseRule;
                default:
                    // "source": follow whichever feature the actor has. An
                    // unidentified source uses the more conservative table.
                    return sourceKind === "classFeature" ? tables.classFeature : tables.archetypeFeat;
            }
        })();
        const table = chosen ?? tables.houseRule ?? [];
        const entry = table.find(([minLevel]) => level >= minLevel);
        return entry ? entry[1] : table.at(-1)?.[1] ?? 10;
    }

    /** Exactly one client should write to a given actor's network. */
    function canWriteFor(actor) {
        return isPrimaryGM() || (!game.users?.activeGM && Boolean(actor?.isOwner));
    }

    /* ---------------------------------------------------------------------- */
    /*  3. THE VITALITY NETWORK SPECIAL RESOURCE                               */
    /* ---------------------------------------------------------------------- */

    /**
     * Read the vitality network resource from an actor.
     * @returns {{key: string, value: number, max: number}|null}
     */
    function getResourceInfo(actor) {
        const resources = actor?.system?.resources;
        if (!resources) return null;

        let key = RESOURCE_SLUG;
        if (!(key in resources)) {
            // Defensive: find it by key or by its (localised) label.
            const found = Object.keys(resources).find(
                (k) => /vitalit/i.test(k) || /vitalit/i.test(resources[k]?.label ?? ""),
            );
            if (!found) return null;
            key = found;
        }

        const data = resources[key] ?? {};
        return {
            key,
            value: Number(data.value ?? 0) || 0,
            max: Number.isFinite(Number(data.max)) ? Number(data.max) : 0,
        };
    }

    /**
     * Write a new value into the resource. Returns the value that was stored.
     * Three paths, most-supported first, so that this keeps working if the
     * actor API changes.
     */
    async function setResourceValue(actor, key, value) {
        const current = getResourceInfo(actor);
        const ceiling = current?.max ?? Number.MAX_SAFE_INTEGER;
        const clamped = Math.max(0, Math.min(Math.round(value), ceiling));

        // (a) PF2e's own helper — handles items whose resource value is stored
        //     on the granting item's rule element.
        if (typeof actor.updateResource === "function") {
            try {
                await actor.updateResource(key, clamped);
                return clamped;
            } catch (err) {
                error(`updateResource("${key}") failed, falling back to rule-element update.`, err);
            }
        }

        // (b) Update the SpecialResource rule element(s) directly.
        const rule =
            actor.synthetics?.resources?.[key] ??
            (actor.rules ?? []).find(
                (r) => r?.key === "SpecialResource" && (r.slug === key || r.slug === "vitality-network"),
            );
        if (rule && typeof rule.update === "function") {
            try {
                await rule.update(clamped);
                return clamped;
            } catch (err) {
                error("SpecialResource#update failed.", err);
            }
        }

        error(`Could not write the "${key}" resource on ${actor?.name}.`);
        return null;
    }

    /** How much the network regains at the start of the character's turn. */
    function rechargeAmount(actor) {
        const rank = spellDcRank(actor);
        if (rank >= 4) return CONFIG.recharge.legendary;
        if (rank >= 3) return CONFIG.recharge.master;
        return CONFIG.recharge.trained;
    }

    /**
     * Proficiency rank of the character's spell DC (0 = untrained … 4 = legendary).
     * Checked in several ways because the statistic lives in different places
     * depending on how the character got their spellcasting.
     */
    function spellDcRank(actor) {
        const ranks = [];
        const push = (rank) => {
            if (Number.isFinite(rank)) ranks.push(Number(rank));
        };

        // (a) the base casting proficiency ("master in spell DC")
        try {
            push(actor.spellcasting?.base?.rank);
        } catch (err) {
            log("base spellcasting statistic unreadable", err);
        }

        // (b) spellcasting entries (works for class, archetype and innate casting)
        try {
            for (const entry of actor.spellcasting ?? []) {
                push(entry?.statistic?.rank);
                push(entry?.statistic?.proficiency?.rank);
            }
        } catch (err) {
            log("spellcasting entries unreadable", err);
        }

        // (c) the spell DC statistic itself
        if (typeof actor.getStatistic === "function") {
            for (const slug of ["spell-dc", "spell-attack", "spellcasting"]) {
                try {
                    const stat = actor.getStatistic(slug);
                    push(stat?.rank);
                    push(stat?.proficiency?.rank);
                } catch (err) {
                    /* not a statistic on this actor */
                }
            }
        }

        // (d) the prepared proficiency record
        push(actor.system?.proficiencies?.spellcasting?.rank);
        push(actor.system?.proficiencies?.spellcasting);

        return ranks.length ? Math.max(...ranks) : 0;
    }

    /** Restore the network, up to its maximum. Returns the amount regained. */
    async function rechargeVitality(actor, { force = false } = {}) {
        const resource = getResourceInfo(actor);
        if (!resource) return 0;
        if (CONFIG.rechargeInCombatOnly && !game.combat?.started && !force) return 0;

        const gain = rechargeAmount(actor);
        const before = resource.value;
        if (before >= resource.max || gain <= 0) return 0;

        const after = await setResourceValue(actor, resource.key, before + gain);
        if (after === null) return 0;

        log(`${actor.name}: vitality network ${before} → ${after} (+${after - before})`);
        return after - before;
    }

    /* ---------------------------------------------------------------------- */
    /*  4. HARMONIES (one per mystic connection)                               */
    /* ---------------------------------------------------------------------- */

    const ELEMENTAL_TRAITS = [
        { element: "air", types: ["electricity", "sonic"] },
        { element: "earth", types: ["bludgeoning", "piercing"] },
        { element: "fire", types: ["fire"] },
        { element: "metal", types: ["acid", "slashing"] },
        { element: "water", types: ["bludgeoning", "cold"] },
        { element: "wood", types: ["piercing", "poison"] },
    ];

    const elementalTypesFor = (element) => ELEMENTAL_TRAITS.find((e) => e.element === element)?.types ?? [];

    const capitalise = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

    const sourceLine = () => `<p><strong>Source</strong> ${SOURCE_BOOK}</p>`;

    /**
     * The five connection harmonies. Each entry describes:
     *   connection   the class-feature item that identifies the connection
     *   expiresOn    whose turn the effect expires on ("caster" or "target")
     *   effect       whether a harmony effect is attached to the target
     *   rules        rule elements for that effect
     *   prepare      optional prompt before the transfer completes
     *   apply        optional extra automation besides the effect
     */
    const HARMONIES = {
        akashic: {
            slug: "akashic",
            name: "Akashic Harmony",
            connection: { id: "fM1vlupLq9Zlyt7C", name: "Akashic" },
            expiresOn: "caster",
            effect: true,
            summary: "the target can immediately Recall Knowledge as a reaction",
            text:
                "<p>When you Transfer Vitality, the target receives a psychic download from the Akashic " +
                "Record and can immediately attempt to Recall Knowledge as a reaction. This doesn't trigger " +
                "any special abilities, reactions, or free actions that trigger when a creature uses " +
                "Recall Knowledge.</p>",
            durationText: "The target may use this reaction any time before the end of your next turn.",
            rules: () => [{ key: "RollOption", domain: "all", option: "harmony:akashic", toggleable: true }],
            notes: (context) => [
                `<strong>@UUID[${context.caster?.uuid ?? ""}]{${context.casterName ?? "The mystic"}}</strong>'s ` +
                    "Akashic Harmony lets the target attempt to Recall Knowledge as a reaction " +
                    "(it does not trigger abilities that react to Recall Knowledge).",
            ],
        },

        elemental: {
            slug: "elemental",
            name: "Elemental Harmony",
            connection: { id: "AurhNoZmNNhHktx6", name: "Elemental" },
            expiresOn: "target",
            effect: true,
            summary: "the target's next Strike deals an elemental damage type",
            text:
                "<p>When you Transfer Vitality, choose an elemental trait: air, earth, fire, metal, water or " +
                "wood. The target's next Strike deals damage based on the chosen trait (your choice) rather " +
                "than its typical damage type.</p>",
            prepare: async () => promptForElement(),
            rules: (context) => {
                const element = context.element ?? "fire";
                const damageType = context.damageType ?? elementalTypesFor(element)[0] ?? "fire";
                const rules = [
                    { key: "RollOption", domain: "all", option: "harmony:elemental", toggleable: true },
                    { key: "RollOption", domain: "all", option: `harmony:elemental:${element}`, toggleable: true },
                ];
                if (CONFIG.elemental.damageTypeOverride) {
                    rules.push({
                        key: "DamageDice",
                        selector: "strike-damage",
                        diceNumber: 0,
                        override: { damageType },
                    });
                }
                return rules;
            },
            describe: (context) =>
                context.element
                    ? `<p>Elemental trait: <strong>${capitalise(context.element)}</strong>. Strike damage ` +
                      `becomes <strong>${context.damageType}</strong> (or whichever of ` +
                      `${elementalTypesFor(context.element).join(" / ")} the target chooses).</p>`
                    : "",
            notes: (context) =>
                context.element
                    ? ["Elemental Harmony: the target's next Strike deals " +
                      `${elementalTypesFor(context.element).join(" or ")} damage instead of its usual type.`]
                    : [],
        },

        healing: {
            slug: "healing",
            name: "Healing Harmony",
            connection: { id: "XV8C2ASALC65G5MH", name: "Healing" },
            effect: false,
            summary: "one affliction or hindering condition on the target can be counteracted",
            text:
                "<p>When you Transfer Vitality, attempt to counteract one affliction affecting the target, or " +
                "attempt to counteract one effect of your choice imposing one of the following conditions on " +
                "the target: blinded, clumsy, dazzled, deafened, enfeebled, sickened.</p>",
            apply: async (context) => applyHealingHarmony(context),
        },

        rhythm: {
            slug: "rhythm",
            name: "Rhythm Harmony",
            connection: { id: "jV9LIUswOPkVRC49", name: "Rhythm" },
            effect: false,
            summary: "active rhythm epiphanies last 1 round longer",
            text:
                "<p>When you Transfer Vitality, you can extend the duration of any active epiphany from the " +
                "rhythm connection by 1 round.</p>",
            apply: async (context) => applyRhythmHarmony(context),
        },

        shadow: {
            slug: "shadow",
            name: "Shadow Harmony",
            connection: { id: "kvmpnKMVw4wwGk8c", name: "Shadow" },
            expiresOn: "caster",
            effect: true,
            summary: "the target's shadow darkens and grants concealment",
            text:
                "<p>When you Transfer Vitality, the target's shadow darkens and swells, reducing bright " +
                "light within a 10-foot emanation of the target to dim light. This is a form of magical " +
                "darkness and can overcome non-magical light sources or attempt to counteract magical light. " +
                "The target becomes concealed while in this dim light and can use the concealed condition to " +
                "Hide.</p>",
            rules: () => {
                const { bright, dim, color, alpha, priority } = CONFIG.effect.darkness;
                const rules = [
                    {
                        key: "TokenLight",
                        value: {
                            bright,
                            dim,
                            color,
                            alpha,
                            animation: { type: "none" },
                            // "negative" marks a darkness source: it dims rather
                            // than brightens the area.
                            negative: true,
                            priority,
                        },
                    },
                    { key: "RollOption", domain: "all", option: "harmony:shadow", toggleable: true },
                ];
                if (CONFIG.effect.grantConcealed) {
                    rules.push({
                        key: "GrantItem",
                uuid: concealedUuid(),
                        // Deleting the effect removes the concealed condition
                        // ("cascade"); deleting the condition leaves the effect.
                        onDeleteActions: { grantee: "detach", granter: "cascade" },
                    });
                }
                return rules;
            },
            notes: () => [],
        },
    };

    /** The harmony a caster's connection grants, or the configured fallback. */
    function detectHarmony(actor) {
        for (const harmony of Object.values(HARMONIES)) {
            if (!CONFIG.harmonies[harmony.slug]) continue;
            if (hasConnection(actor, harmony.connection)) return harmony;
        }

        const fallback = CONFIG.harmonyFallback ? HARMONIES[CONFIG.harmonyFallback] : null;
        if (fallback && !CONFIG.harmonies[fallback.slug]) return null;
        if (fallback) {
            log(`No connection found on ${actor?.name}; falling back to the ${fallback.slug} harmony.`);
        }
        return fallback ?? null;
    }

    /** Does the actor have this mystic connection? */
    function hasConnection(actor, connection) {
        const wanted = `${connection.id}`;
        const name = (connection.name ?? "").toLowerCase();

        return itemsOf(actor).some((item) => {
            // (a) the connection's class feature itself
            const sourceId = sourceIdOf(item);
            if (typeof sourceId === "string" && sourceId.endsWith(`.${wanted}`)) return true;
            if (
                (item.slug ?? "").toLowerCase() === name ||
                (item.name ?? "").toLowerCase() === name
            ) {
                const otherTags = item.system?.traits?.otherTags ?? [];
                const isConnection =
                    item.system?.category === "classfeature" ||
                    otherTags.includes("mystic-connection") ||
                    otherTags.includes("connection");
                if (isConnection) return true;
            }

            // (b) the Connection feature's ChoiceSet selection
            const selection = systemFlags(item).rulesSelections?.connection;
            if (typeof selection === "string" && selection.endsWith(`.${wanted}`)) return true;

            return false;
        });
    }

    /** Names of the visible connection harmonies, for diagnostics. */
    function connectedHarmonies(actor) {
        return Object.values(HARMONIES)
            .filter((harmony) => hasConnection(actor, harmony.connection))
            .map((harmony) => harmony.slug);
    }

    /* ---------------------------------------------------------------------- */
    /*  5. TURN HANDLING                                                       */
    /* ---------------------------------------------------------------------- */

    /** `${combatId}:${combatantId}:${round}:${turn}` of the last turn we handled. */
    const handledTurns = new Map();

    function turnKey(combat, combatant) {
        return `${combat?.id}:${combatant?.id}:${combat?.round}:${combat?.turn}`;
    }

    /** Called whenever a combatant's turn begins (from any of several hooks). */
    async function onTurnStart(combat, combatant) {
        if (!combatant || !combat) return;

        const key = turnKey(combat, combatant);
        if (handledTurns.get(combat.id) === key) return; // already handled by another hook
        handledTurns.set(combat.id, key);

        const actor = combatant.actor;
        if (!actor) return;
        if (!hasVitalityFeat(actor)) return;

        // Bring the stored maximum in line with the printed text before the
        // recharge is calculated from it.
        await checkCapacity(actor);

        // Exactly one client may do this, or the network would recharge once
        // per connected player.
        const permitted = canWriteFor(actor);
        if (!permitted) return;

        await rechargeVitality(actor);
    }

    Hooks.on("combatStart", (combat) => {
        void onTurnStart(combat, combat.combatant);
    });

    Hooks.on("combatTurnChange", (combat) => {
        void onTurnStart(combat, combat.combatant);
    });

    // PF2e and the SF2e system both announce turn starts, namespaced after the
    // system id; registering both is harmless, since a hook that never fires
    // costs nothing.
    for (const hookName of ["pf2e.startTurn", "sf2e.startTurn"]) {
        Hooks.on(hookName, (combatant, encounter) => {
            const combat = encounter?.combat ?? encounter ?? game.combat;
            void onTurnStart(combat, combatant ?? combat?.combatant);
        });
    }

    Hooks.on("deleteCombat", (combat) => handledTurns.delete(combat.id));

    /* --- Refocus: "your vitality network regains all its Hit Points" -------- */

    const previousFocus = new Map();

    Hooks.on("preUpdateActor", (actor, changes) => {
        if (!CONFIG.refocus.enabled || !CONFIG.refocus.watchFocusIncrease) return;
        if (foundry.utils.getProperty(changes, "system.resources.focus.value") === undefined) return;
        previousFocus.set(actor.uuid, Number(actor.system?.resources?.focus?.value ?? 0));
    });

    Hooks.on("updateActor", (actor, changes) => {
        if (!CONFIG.refocus.enabled || !CONFIG.refocus.watchFocusIncrease) return;
        if (foundry.utils.getProperty(changes, "system.resources.focus.value") === undefined) return;

        const before = previousFocus.get(actor.uuid);
        previousFocus.delete(actor.uuid);
        const after = Number(actor.system?.resources?.focus?.value ?? 0);
        if (!Number.isFinite(before) || after <= before) return; // only when focus is restored

        void refocusRecharge(actor, { reason: "Refocus" });
    });

    /* ---------------------------------------------------------------------- */
    /*  6. TRANSFER VITALITY                                                   */
    /* ---------------------------------------------------------------------- */

    /**
     * Show an ApplicationV2 prompt, falling back to the legacy Dialog.
     * `read` receives the dialog's form element and returns the value to resolve
     * with, or null to treat the prompt as cancelled.
     */
    let promptOpen = false;

    /**
     * Only one dialog may ever be open. A second request while one is open is
     * dropped, which is what stops a duplicate trigger from stacking dialogs.
     */
    async function showPrompt(options) {
        if (promptOpen) {
            log("ignored a request to open a dialog: one is already open");
            return null;
        }
        promptOpen = true;
        try {
            return await showPromptInner(options);
        } finally {
            promptOpen = false;
        }
    }

    async function showPromptInner({ title, content, okLabel, icon, read, legacyContent = content }) {
        const DialogV2 = foundry.applications?.api?.DialogV2;
        if (DialogV2?.prompt) {
            try {
                return await DialogV2.prompt({
                    window: { title, icon },
                    content,
                    ok: {
                        label: okLabel ?? _loc("SF2E-VN.Dialog.Confirm"),
                        icon: "fa-solid fa-check",
                        callback: (_event, button) => read(button?.form),
                    },
                    modal: true,
                });
            } catch (err) {
                return null; // dismissed
            }
        }

        return new Promise((resolve) => {
            new Dialog({
                title,
                content: legacyContent,
                buttons: {
                    confirm: {
                        label: okLabel ?? _loc("SF2E-VN.Dialog.Confirm"),
                        callback: (html) => resolve(read(html?.[0]?.querySelector?.("form") ?? html?.[0] ?? null)),
                    },
                    cancel: { label: _loc("SF2E-VN.Dialog.Cancel"), callback: () => resolve(null) },
                },
                default: "confirm",
                close: () => resolve(null),
            }).render(true);
        });
    }

    /** Ask the user how much to transfer. Returns a number, or null if cancelled. */
    async function promptForAmount({ actor, resource, max }) {
        const level = levelOf(actor);
        const content = `
            <div class="sf2e-vitality-network-dialog">
                <p>${_loc("SF2E-VN.Dialog.TransfersVitality", { name: foundry.utils.escapeHTML(actor.name) })}</p>
                <p class="notes">
                    ${_loc("SF2E-VN.Dialog.Network", { value: resource.value, max: resource.max })}<br>
                    ${_loc("SF2E-VN.Dialog.MaximumAtLevel", { level, max })}
                </p>
                <div class="form-group">
                    <label for="sf2e-vn-amount">${_loc("SF2E-VN.Dialog.AmountLabel")}</label>
                    <div class="form-fields">
                        <input id="sf2e-vn-amount" type="number" name="amount"
                               min="${CONFIG.minTransfer}" max="${max}" step="1" value="${max}" autofocus>
                    </div>
                </div>
            </div>`;

        // Clamp rather than reject: the field is pre-filled with the maximum, so
        // an empty or out-of-range entry simply resolves to a legal value.
        const read = (form) => {
            const raw = Number(form?.elements?.amount?.value);
            const wanted = Number.isFinite(raw) ? Math.round(raw) : max;
            const value = Math.max(CONFIG.minTransfer, Math.min(wanted, max));
            if (value !== wanted) {
                info(_loc("SF2E-VN.Dialog.Adjusted", { value }));
            }
            return value;
        };

        return showPrompt({
            title: _loc("SF2E-VN.Dialog.TransferTitle"),
            icon: "fa-solid fa-heart-pulse",
            okLabel: _loc("SF2E-VN.Dialog.TransferOk"),
            content,
            read,
        });
    }

    /** Ask which elemental trait the harmony should use. */
    async function promptForElement() {
        const options = ELEMENTAL_TRAITS.flatMap(({ element, types }) =>
            types.map(
                (type) =>
                    `<option value="${element}|${type}"${element === "fire" ? " selected" : ""}>` +
                    `${capitalise(element)} — ${type} damage</option>`,
            ),
        ).join("");

        const content = `
            <div class="sf2e-vitality-network-dialog">
                <p>${_loc("SF2E-VN.Dialog.ElementPrompt")}</p>
                <p class="notes">${_loc("SF2E-VN.Dialog.ElementNote")}</p>
                <div class="form-group">
                    <label for="sf2e-vn-element">${_loc("SF2E-VN.Dialog.ElementLabel")}</label>
                    <div class="form-fields">
                        <select id="sf2e-vn-element" name="element">${options}</select>
                    </div>
                </div>
            </div>`;

        const read = (form) => {
            const [element, damageType] = String(form?.elements?.element?.value ?? "fire|fire").split("|");
            return { element, damageType };
        };

        return showPrompt({
            title: _loc("SF2E-VN.Dialog.ElementTitle"),
            icon: "fa-solid fa-fire",
            okLabel: _loc("SF2E-VN.Dialog.ElementOk"),
            content,
            read,
        });
    }

    /** Ask whether to heal the acting character when nothing is targeted. */
    async function confirmSelfTarget(actor) {
        const DialogV2 = foundry.applications?.api?.DialogV2;
        if (DialogV2?.confirm) {
            try {
                return await DialogV2.confirm({
                    window: { title: _loc("SF2E-VN.Dialog.TransferTitle") },
                    content: `<p>${_loc("SF2E-VN.Dialog.SelfTarget", {
                        name: foundry.utils.escapeHTML(actor.name),
                    })}</p>`,
                    modal: true,
                    rejectClose: false,
                });
            } catch (err) {
                return false;
            }
        }
        return true; // no dialog available: assume self-transfer
    }

    /** Distance in feet between two tokens, or null if it cannot be measured. */
    function distanceInFeet(a, b) {
        try {
            if (!a || !b || a.parent?.id !== b.parent?.id) return null;
            const grid = canvas?.grid;
            if (!grid) return null;
            const path = grid.measurePath?.([a.object?.center, b.object?.center]);
            const spaces = path?.distance ?? path?.spaces ?? null;
            if (!Number.isFinite(spaces)) return null;
            return spaces * (grid.distance ?? 5);
        } catch (err) {
            return null;
        }
    }

    /** Heal the target through PF2e's damage pipeline (negative damage = healing). */
    async function applyHealing(actor, amount, { token = null, item = null } = {}) {
        const value = Math.abs(Math.round(amount));
        if (!value || !actor) return 0;

        if (typeof actor.applyDamage === "function") {
            try {
                await actor.applyDamage({ damage: -value, token, item });
                return value;
            } catch (err) {
                error(`applyDamage failed for ${actor.name}, falling back to a direct HP update.`, err);
            }
        }

        const hp = actor.system?.attributes?.hp;
        if (!hp) return 0;
        const newValue = Math.min(Number(hp.max ?? hp.value + value), Number(hp.value) + value);
        await actor.update({ "system.attributes.hp.value": newValue });
        return value;
    }

    /* ---------------------------------------------------------------------- */
    /*  7. THE HARMONY EFFECT                                                  */
    /* ---------------------------------------------------------------------- */

    function harmonyDescription(harmony, context) {
        const text = `${harmony.text}${harmony.describe?.(context) ?? ""}`;
        const duration =
            harmony.durationText ??
            (harmony.expiresOn === "target"
                ? "This lasts until the end of the target's next turn."
                : "This lasts until the end of your next turn.");
        return `${text}<p>${duration}</p>${sourceLine()}`;
    }

    function isHarmonyEffect(item) {
        if (item?.type !== "effect") return false;
        if (item.flags?.[SCRIPT_ID]?.harmony) return true;
        return /-harmony$/.test(item.slug ?? "");
    }

    /**
     * Attach the harmony effect to the target. Its origin is the caster, or the
     * target when the rules measure the duration from the target's turn.
     */
    async function createHarmonyEffect({ harmony, context }) {
        const { targetActor, targetToken, caster, casterToken, actionItem } = context ?? {};
        if (!targetActor || !harmony?.effect) return null;

        // Refresh rather than stack: drop any previous harmony effect we made.
        const existing = itemsOf(targetActor).filter(isHarmonyEffect);
        if (existing.length) {
            await targetActor.deleteEmbeddedDocuments(
                "Item",
                existing.map((item) => item.id),
            );
        }

        const casterUuid = casterToken?.actor?.uuid ?? caster?.uuid ?? null;
        const targetUuid = targetToken?.actor?.uuid ?? targetActor.uuid;
        const measuredFromTarget = harmony.expiresOn === "target";
        const initiativeSource = measuredFromTarget ? targetActor : caster;

        const source = {
            name: harmony.name,
            type: "effect",
            img: CONFIG.effect.icon,
            system: {
                description: { value: harmonyDescription(harmony, context) },
                level: { value: 1 },
                traits: { value: ["magical"], otherTags: context.element ? [context.element] : [] },
                duration: { value: CONFIG.effect.rounds, unit: "rounds", expiry: "turn-end", sustained: false },
                // PF2e overwrites `start` on creation using the origin actor's
                // initiative; setting it here keeps the data correct either way.
                start: { value: game.time.worldTime, initiative: initiativeSource?.combatant?.initiative ?? null },
                tokenIcon: { show: true },
                unidentified: false,
                fromSpell: false,
                badge: null,
                context: {
                    origin: {
                        actor: measuredFromTarget ? targetUuid : casterUuid,
                        token: (measuredFromTarget ? targetToken : casterToken)?.uuid ?? null,
                        item: actionItem?.uuid ?? null,
                        spellcasting: null,
                        rollOptions: [],
                    },
                    target: { actor: targetUuid, token: targetToken?.uuid ?? null },
                    roll: null,
                },
                rules: harmony.rules(context),
            },
            flags: {
                [SCRIPT_ID]: {
                    harmony: harmony.slug,
                    source: SOURCE_BOOK,
                    transfer: {
                        caster: casterUuid,
                        casterName: caster?.name ?? null,
                        amount: context.amount ?? null,
                        element: context.element ?? null,
                        damageType: context.damageType ?? null,
                        appliedAt: game.time.worldTime,
                        version: VERSION,
                    },
                },
            },
        };

        const [created] = await targetActor.createEmbeddedDocuments("Item", [source]);
        return created ?? null;
    }

    /* ---------------------------------------------------------------------- */
    /*  8. HEALING AND RHYTHM HARMONIES                                        */
    /* ---------------------------------------------------------------------- */

    /** Conditions the healing harmony may counteract, respecting 19th level. */
    function healingConditions(level) {
        const conditions = [...CONFIG.healing.conditions];
        if (level >= CONFIG.healing.perfectHarmonyLevel) {
            conditions.push(...CONFIG.healing.perfectHarmonyConditions);
        }
        return conditions;
    }

    /** List the target's afflictions and eligible conditions. */
    function findHealingTargets(targetActor, level) {
        const conditions = healingConditions(level);
        const items = itemsOf(targetActor);

        const afflictions = items
            .filter((item) => item.type === "affliction")
            .map((item) => `${item.name} (affliction)`);

        const hinderances = items
            .filter((item) => item.type === "condition" && conditions.includes(item.slug ?? ""))
            .map((item) => {
                const value = Number(item.system?.value?.value ?? 0);
                return value > 1 ? `${item.name} ${value}` : item.name;
            })
            .concat(
                // Some conditions are integer-valued flags rather than items.
                (conditions ?? [])
                    .filter((slug) => {
                        const raw = targetActor.system?.attributes?.[slug]?.value;
                        return Number(raw) > 0;
                    })
                    .map((slug) => slug),
            );

        return { afflictions, hinderances };
    }

    /** Healing harmony: report what the caster may counteract. */
    async function applyHealingHarmony(context) {
        const level = levelOf(context.caster);
        const { afflictions, hinderances } = findHealingTargets(context.targetActor, level);
        const found = [...new Set([...afflictions, ...hinderances])];

        const conditions = healingConditions(level).join(", ");
        const notes = found.length
            ? [
                  `Healing Harmony: attempt to <strong>counteract</strong> one of the following on ` +
                      `${found.map((f) => foundry.utils.escapeHTML(f)).join(", ")}.`,
              ]
            : [
                  "Healing Harmony: no affliction or eligible condition was found on the target, so nothing " +
                      `can be counteracted (eligible conditions: ${conditions}).`,
              ];

        if (level >= CONFIG.healing.perfectHarmonyLevel) {
            notes.push(
                "Perfect Harmony: if the counteract check fails by 2 or less ranks, the effect is instead " +
                    "suppressed until the beginning of your next turn.",
            );
        }

        return { notes };
    }

    /** Rhythm harmony: extend active rhythm epiphanies by a round. */
    async function applyRhythmHarmony(context) {
        const names = CONFIG.rhythm.epiphanyNames ?? [];
        const extra = Number(CONFIG.rhythm.extraRounds) || 1;

        const actors = [];
        const add = (actor) => {
            if (actor && !actors.some((a) => a.uuid === actor.uuid)) actors.push(actor);
        };
        add(context.caster);
        add(context.targetActor);
        if (game.user?.isGM && CONFIG.rhythm.gmSearchesAllActors) {
            for (const actor of game.actors ?? []) add(actor);
        }

        const extended = [];
        for (const actor of actors) {
            for (const item of itemsOf(actor)) {
                if (item.type !== "effect") continue;
                const haystack = `${item.name ?? ""} ${item.slug ?? ""}`.toLowerCase();
                if (!names.some((name) => haystack.includes(name.toLowerCase()))) continue;

                const duration = item.system?.duration;
                if (!duration || ["unlimited", "encounter"].includes(duration.unit ?? "")) continue;
                const value = Number(duration.value ?? 0);
                if (!(value > 0)) continue;
                if (item.system?.expired) continue;

                try {
                    await item.update({ "system.duration.value": value + extra });
                    extended.push(`${item.name} on ${actor.name} (${value} → ${value + extra} ${duration.unit})`);
                } catch (err) {
                    log(`Could not extend ${item.name} on ${actor.name}`, err);
                }
            }
        }

        const notes = extended.length
            ? [`Rhythm Harmony extended: ${extended.map((e) => foundry.utils.escapeHTML(e)).join("; ")}.`]
            : [
                  `Rhythm Harmony: no active epiphany (${names.join(", ")}) was found to extend — extend one ` +
                      "manually by 1 round if it is on a token this client cannot edit.",
              ];

        return { notes };
    }

    /* ---------------------------------------------------------------------- */
    /*  9. APPLYING THE TRANSFER                                               */
    /* ---------------------------------------------------------------------- */

    /** Everything that must happen on the target's side of the transfer. */
    async function applyTargetSide({ harmony, context }) {
        const healed = await applyHealing(context.targetActor, context.amount, {
            token: context.targetToken,
            // Deliberately no action item here. PF2e's own healing card would
            // otherwise carry Transfer Vitality as its origin, and that card is
            // indistinguishable from a fresh use of the action — which is what
            // reopened the transfer dialog after a successful transfer.
            item: null,
        });

        let effect = null;
        const notes = [];

        if (harmony && CONFIG.harmonies[harmony.slug]) {
            try {
                effect = await createHarmonyEffect({ harmony, context });
            } catch (err) {
                error(`Could not attach the ${harmony.name} effect.`, err);
            }

            if (harmony.apply) {
                try {
                    const extra = await harmony.apply(context);
                    notes.push(...(extra?.notes ?? []));
                } catch (err) {
                    error(`Could not apply the ${harmony.name} automation.`, err);
                }
            }

            try {
                notes.push(...(harmony.notes?.(context) ?? []));
            } catch (err) {
                log("harmony notes failed", err);
            }
        }

        return { healed, effect: effect?.name ?? null, notes };
    }

    /* ------------------------- GM relay over a socket ---------------------- */

    const pendingRequests = new Map();

    /**
     * Ask another client to apply the target's side of the transfer, because the
     * acting player cannot write to an actor they do not own.
     *
     * `audience` is "gm" for a GM client, or "owner" for whoever owns the target
     * (used when no GM is connected at all). Resolves with
     * `{ ok, result, reason }` so the caller can explain a failure.
     */
    function requestRemoteApply(
        payload,
        { audience = "gm", targetUserId = null, timeoutMs = CONFIG.relayTimeoutMs } = {},
    ) {
        if (!CONFIG.relayToGM) {
            return Promise.resolve({ ok: false, reason: "the GM relay is switched off in the module settings" });
        }
        if (audience === "gm" && !anyGmOnline()) {
            return Promise.resolve({ ok: false, reason: "no GM is connected" });
        }
        if (!game.socket?.emit) {
            return Promise.resolve({ ok: false, reason: "this client has no socket connection" });
        }

        const requestId = foundry.utils.randomID();
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                pendingRequests.delete(requestId);
                resolve({
                    ok: false,
                    reason:
                        audience === "gm"
                            ? "the GM's client did not answer in time"
                            : "the target's owner did not answer in time",
                });
            }, timeoutMs);

            pendingRequests.set(requestId, (outcome) => {
                clearTimeout(timeout);
                resolve(outcome);
            });

            game.socket.emit(SOCKET_CHANNEL, {
                type: "apply-transfer",
                audience,
                targetUserId,
                requestId,
                requesterId: game.user.id,
                payload,
            });
        });
    }

    /**
     * Check which clients answer the relay, and which of them are GMs. Useful when
     * a player's transfer cannot be applied:
     *   await game.sf2eVitalityNetwork.testRelay()
     */
    async function testRelay({ timeoutMs = 4000 } = {}) {
        const candidates = gmCandidates();
        const listed = candidates.map((user) => ({ id: user.id, name: user.name }));
        relayPingReplies.length = 0;

        if (!game.socket?.emit) {
            return {
                thisClient: { id: game.user.id, isGM: Boolean(game.user?.isGM) },
                candidates: listed,
                replies: [],
                error: "this client has no socket connection",
            };
        }

        game.socket.emit(SOCKET_CHANNEL, { type: "relay-ping", requesterId: game.user.id });
        await new Promise((resolve) => setTimeout(resolve, timeoutMs));

        return {
            thisClient: { id: game.user.id, name: game.user.name, isGM: Boolean(game.user?.isGM) },
            candidates: listed,
            replies: relayPingReplies.slice(),
        };
    }
    function registerSocketHandler() {
        if (!game.socket?.on) return;

        game.socket.on(SOCKET_CHANNEL, async (message) => {
            if (!message || typeof message !== "object") return;

            // A GM's client performs work it has permission for on behalf of a player.
            if (message.type === "apply-transfer") {
                const audience = message.audience === "owner" ? "owner" : "gm";
                const payload = message.payload ?? {};

                if (audience === "owner") {
                    // Whoever owns the target may apply it — but only when there is
                    // no GM route, so one transfer is never healed twice.
                    const owned = await fromUuid(payload.targetActorUuid ?? "");
                    if (game.user?.isGM || !owned?.isOwner) return;
                } else if (message.targetUserId) {
                    // The requester named this client, so it acts even when Foundry
                    // does not agree that it is the primary GM.
                    if (!game.user?.isGM || game.user.id !== message.targetUserId) return;
                } else if (!isPrimaryGM()) {
                    return;
                }

                let outcome = { ok: false, reason: "the applying client could not finish" };
                try {
                    const targetActor = await fromUuid(payload.targetActorUuid ?? "");
                    const targetToken = payload.targetTokenUuid ? await fromUuid(payload.targetTokenUuid) : null;
                    const caster = await fromUuid(payload.casterActorUuid ?? "");
                    const casterToken = payload.casterTokenUuid ? await fromUuid(payload.casterTokenUuid) : null;
                    const actionItem = payload.actionItemUuid ? await fromUuid(payload.actionItemUuid) : null;

                    if (targetActor) {
                        const applied = await applyTargetSide({
                            harmony: HARMONIES[payload.harmony] ?? null,
                            context: {
                                caster,
                                casterToken,
                                actionItem,
                                targetActor,
                                targetToken,
                                amount: Number(payload.amount) || 0,
                                element: payload.element ?? null,
                                damageType: payload.damageType ?? null,
                                casterName: caster?.name ?? null,
                                relayed: true,
                            },
                        });
                        outcome = {
                            ok: true,
                            result: {
                                healed: applied.healed,
                                effect: applied.effect,
                                notes: applied.notes,
                            },
                        };
                    } else {
                        outcome = { ok: false, reason: "the target actor could not be found" };
                    }
                } catch (err) {
                    outcome = { ok: false, reason: err?.message ? String(err.message) : String(err) };
                    error("Failed to apply a relayed transfer.", err);
                }

                game.socket.emit(SOCKET_CHANNEL, {
                    type: "apply-transfer-result",
                    requestId: message.requestId,
                    requesterId: message.requesterId,
                    ok: outcome.ok,
                    result: outcome.result ?? null,
                    reason: outcome.reason ?? null,
                });
                return;
            }

            if (message.type === "apply-transfer-result") {
                if (message.requesterId !== game.user.id) return;
                const resolve = pendingRequests.get(message.requestId);
                if (resolve) {
                    pendingRequests.delete(message.requestId);
                    resolve({
                        ok: Boolean(message.ok),
                        result: message.result ?? null,
                        reason: message.reason ?? null,
                    });
                }
                return;
            }

            // Relay diagnostics: answer a ping so a player can see which clients
            // are listening and which of them are GMs.
            if (message.type === "relay-ping") {
                game.socket.emit(SOCKET_CHANNEL, {
                    type: "relay-ping-reply",
                    requesterId: message.requesterId,
                    userId: game.user.id,
                    userName: game.user.name,
                    isGM: Boolean(game.user?.isGM),
                });
                return;
            }

            if (message.type === "relay-ping-reply") {
                if (message.requesterId !== game.user.id) return;
                relayPingReplies.push({
                    id: message.userId ?? null,
                    name: message.userName ?? null,
                    isGM: Boolean(message.isGM),
                });
            }
        });
    }

    /* --------------------------- Chat summary ----------------------------- */

    async function enrichHtml(html) {
        const textEditor = CONFIG.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
        try {
            if (typeof textEditor?.enrichHTML === "function") {
                return await textEditor.enrichHTML(html, { async: true, documents: true });
            }
        } catch (err) {
            log("enrichHTML failed", err);
        }
        return html;
    }

    async function postChatCard({ html, actor, token, flags }) {
        try {
            const body = await enrichHtml(html);
            const getSpeaker =
                CONFIG.ChatMessage?.documentClass?.getSpeaker ?? globalThis.ChatMessage?.getSpeaker ?? null;

            return await ChatMessage.create({
                content: body,
                speaker: getSpeaker ? getSpeaker.call(null, { actor, token: token?.object }) : undefined,
                // Every card this module posts carries its own flag, so the chat
                // handler can recognise its own output and never react to it.
                flags: { [SCRIPT_ID]: { card: true, ...(flags ?? {}) } },
            });
        } catch (err) {
            error("Could not post a chat card.", err);
            return null;
        }
    }

    async function postTransferCard({
        caster,
        casterToken,
        actionItem,
        targetActor,
        harmony,
        amount,
        result,
        relayed,
        failure = null,
    }) {
        if (!CONFIG.postChatSummary) return;

        // Deliberately plain text rather than a link to the action: clicking an
        // item link in chat posts the action again, and the system's own card for
        // that reads as a fresh use of Transfer Vitality.
        const actionLabel = "<strong>Transfer Vitality</strong>";
        const actual = result?.healed ?? null;
        const notes = result?.notes ?? [];
        const harmonyLine = harmony
            ? `<p><strong>${harmony.name}:</strong> ${foundry.utils.escapeHTML(harmony.summary)}${
                  result?.effect ? ` — “${foundry.utils.escapeHTML(result.effect)}” applied to the target` : ""
              }.</p>`
            : "";

        const html = `
            <p>${actionLabel} — ${foundry.utils.escapeHTML(caster.name)} transfers
            <strong>${amount}</strong> HP to ${foundry.utils.escapeHTML(targetActor.name)}${
                actual && actual !== amount ? ` (${actual} HP actually regained)` : ""
            }.</p>
            ${harmonyLine}
            ${notes.length ? `<ul>${notes.map((note) => `<li>${note}</li>`).join("")}</ul>` : ""}
            ${relayed ? `<p class="notes">Applied by the GM's client.</p>` : ""}
            ${failure ? `<p class="notes">Not applied automatically: ${foundry.utils.escapeHTML(failure)}.</p>` : ""}`;

        await postChatCard({
            html,
            actor: caster,
            token: casterToken,
            flags: { transfer: { amount, target: targetActor.uuid, harmony: harmony?.slug ?? null } },
        });
    }

    /* --------------------------- The whole flow --------------------------- */

    /**
     * Perform a transfer. Safe to call from a macro:
     *   game.sf2eVitalityNetwork.transfer(actor, { amount: 10, targetToken })
     */
    async function performTransfer({ caster, casterToken = null, actionItem = null, amount, targetToken = null }) {
        if (!caster) return false;

        // Keep the network's maximum honest against the printed rules.
        await checkCapacity(caster, { warnOnce: true });

        const resource = getResourceInfo(caster);
        if (!resource) {
            warn(`${caster.name} has no vitality network resource.`);
            return false;
        }
        if (resource.value < CONFIG.minTransfer) {
            warn(`${caster.name}'s vitality network is empty (${resource.value} HP).`);
            return false;
        }

        const level = levelOf(caster);
        const source = vitalitySource(caster);
        const max = Math.min(resource.value, maxTransferForLevel(level, source.kind));
        const harmony = detectHarmony(caster);

        // Ask how much to move if the caller did not say.
        let requested = amount;
        if (requested === null || requested === undefined) {
            requested = await promptForAmount({ actor: caster, resource, max });
            if (requested === null) return false; // dialog dismissed
        }
        const spend = Math.max(CONFIG.minTransfer, Math.min(Math.round(Number(requested) || 0), max));

        // Target: the user's targeted token, else the caster themselves. The
        // action may be used on yourself, and a token is not always available.
        let target = targetToken;
        let targetActor = null;
        let selfTarget = false;
        if (target) {
            targetActor = target.actor ?? null;
            if (!targetActor) {
                warn("The targeted token has no actor.");
                return false;
            }
        } else if (CONFIG.offerSelfWhenUntargeted && (await confirmSelfTarget(caster))) {
            selfTarget = true;
            target = casterToken ?? findTokenDocument(caster);
            targetActor = target?.actor ?? caster;
        }
        if (!targetActor) return false;

        if (CONFIG.warnBeyondRange && !selfTarget) {
            const feet = distanceInFeet(casterToken, target);
            if (feet !== null && feet > CONFIG.rangeFeet) {
                warn(
                    `${targetActor.name} is about ${feet} ft away — Transfer Vitality normally reaches ` +
                        `${CONFIG.rangeFeet} ft (transferring anyway).`,
                );
            }
        }

        // Harmony-specific preparation (the element for an elemental harmony).
        const context = {
            caster,
            casterToken,
            actionItem,
            targetActor,
            targetToken: target,
            amount: spend,
            casterName: caster.name,
            selfTarget,
        };
        if (harmony?.prepare) {
            const prepared = await harmony.prepare(context);
            if (prepared === null) return false; // prompt dismissed
            Object.assign(context, typeof prepared === "object" ? prepared : {});
        }

        // 1. Spend from the network (the acting user owns the caster).
        const remaining = await setResourceValue(caster, resource.key, resource.value - spend);
        if (remaining === null) {
            warn("Could not update the vitality network; nothing was transferred.");
            return false;
        }

        // 2. Apply the target side, locally or through the GM's client.
        let result = null;
        let relayed = false;
        let failure = null;
        const canModify = game.user.isGM || targetActor.isOwner;
        try {
            if (canModify) {
                result = await applyTargetSide({ harmony, context });
            } else {
                const payload = {
                    harmony: harmony?.slug ?? null,
                    targetActorUuid: targetActor.uuid,
                    targetTokenUuid: target?.uuid ?? null,
                    casterActorUuid: casterToken?.actor?.uuid ?? caster.uuid,
                    casterTokenUuid: casterToken?.uuid ?? null,
                    actionItemUuid: actionItem?.uuid ?? null,
                    element: context.element ?? null,
                    damageType: context.damageType ?? null,
                    amount: spend,
                };

                const candidates = gmCandidates();
                let outcome = { ok: false, reason: null };

                for (const candidate of candidates) {
                    log(`asking ${candidate.name} to apply the transfer`);
                    outcome = await requestRemoteApply(payload, {
                        audience: "gm",
                        targetUserId: candidate.id,
                        timeoutMs: CONFIG.relayPerCandidateMs ?? 4000,
                    });
                    if (outcome.ok) break;
                    // A client that answered with a real error will not do better on a
                    // retry; a silent one is worth moving past to the next GM.
                    if (outcome.reason && outcome.reason !== "the GM's client did not answer in time") break;
                }

                let reason = outcome.ok ? null : (outcome.reason ?? null);
                let listeningGms = null;
                let askOwner = !outcome.ok && !anyGmOnline();

                if (!outcome.ok && !candidates.length) reason = "no GM is connected";

                // A GM can be listed as connected while running no module at all, and
                // such a client can never answer. A ping tells the two apart, and only
                // when nobody answers is it safe to ask the target's owner without
                // risking the same transfer being healed twice.
                if (!outcome.ok && !askOwner && candidates.length > 0) {
                    const ping = await testRelay({ timeoutMs: 1500 });
                    listeningGms = ping.replies.filter((reply) => reply.isGM).length;
                    askOwner = listeningGms === 0;
                }

                if (askOwner) {
                    // Ask whoever owns the target rather than leaving it unapplied.
                    const ownerOutcome = await requestRemoteApply(payload, {
                        audience: "owner",
                        timeoutMs: Math.max(2000, Math.round(CONFIG.relayTimeoutMs / 2)),
                    });
                    outcome = ownerOutcome;
                    if (ownerOutcome.ok) reason = null;
                    else if (reason && ownerOutcome.reason) reason = `${reason}; ${ownerOutcome.reason}`;
                    else reason = ownerOutcome.reason ?? reason;
                }

                if (!outcome.ok && listeningGms === 0) {
                    reason = `${reason ?? "no GM client answered"} (no client answered a relay check)`;
                }

                if (outcome.ok) {
                    result = outcome.result;
                    relayed = true;
                } else {
                    failure = reason ?? "no GM client answered";
                }
            }
        } catch (err) {
            error("Applying the transfer to the target failed.", err);
            result = null;
            failure = err?.message ? String(err.message) : String(err);
        }

        if (!result) {
            warn(
                `Transferred ${spend} HP from the vitality network, but ${targetActor.name} could not be ` +
                    `healed automatically${failure ? ` (${failure})` : ""}. Apply ${spend} HP of healing and ` +
                    `the ${harmony?.name ?? "harmony effect"} manually.`,
            );
        }

        // 3. Tell the table what happened.
        await postTransferCard({
            caster,
            casterToken,
            actionItem,
            targetActor,
            harmony,
            amount: spend,
            result,
            relayed,
            failure,
        });

        return true;
    }

    /** React to the Transfer Vitality action being used (its chat card). */
    /** Message ids already handled, so one card can never open two dialogs. */
    const handledMessages = new Set();

    /** True while a chat trigger is being handled, so they cannot overlap. */
    let chatHandling = false;

    async function onChatMessage(message) {
        if (chatHandling) {
            log("ignored a chat trigger: one is already being handled");
            return;
        }
        chatHandling = true;
        try {
            return await onChatMessageInner(message);
        } finally {
            chatHandling = false;
        }
    }

    async function onChatMessageInner(message) {
        try {
            if (CONFIG.singleClientDialogs && message.author?.id !== game.user.id) return;

            // Never react to a card this module posted itself, and never handle
            // the same message twice.
            if (message.flags?.[SCRIPT_ID]) return;
            if (message.id) {
                if (handledMessages.has(message.id)) return;
                handledMessages.add(message.id);
                if (handledMessages.size > 100) handledMessages.clear();
            }

            const item = message.item ?? (await resolveOriginItem(message));

            // Refocus refills the network completely (class feature only).
            if (CONFIG.refocus.enabled && (isRefocusAction(item) || isRefocusCard(message))) {
                const refocuser = item?.actor ?? message.actor ?? null;
                if (refocuser) await refocusRecharge(refocuser, { reason: "Refocus" });
                return;
            }

            if (!isTransferVitalityAction(item)) return;

            const actor = item.actor ?? message.actor ?? null;
            if (!actor) return;
            if (!hasVitalityFeat(actor) && !getResourceInfo(actor)) return;

            const tokens = Array.from(game.user.targets ?? []);
            const targetToken = tokens[0]?.document ?? null;

            await performTransfer({
                caster: actor,
                casterToken: findTokenDocument(actor),
                actionItem: item,
                targetToken,
                amount: null, // ask the user
            });
        } catch (err) {
            error("Failed to handle the Transfer Vitality action.", err);
        }
    }

    /** Fallback: work out the item a chat message came from. */
    async function resolveOriginItem(message) {
        const origin = systemFlags(message).origin ?? {};
        const uuid = origin.uuid ?? origin.item ?? null;
        if (!uuid) return null;
        try {
            return await fromUuid(uuid);
        } catch (err) {
            return null;
        }
    }

    /* ---------------------------------------------------------------------- */
    /*  10. PUBLIC API + INITIALISATION                                        */
    /* ---------------------------------------------------------------------- */

    function exposeApi() {
        game.sf2eVitalityNetwork = {
            version: VERSION,
            config: CONFIG,
            harmonies: HARMONIES,

            /** Recharge an actor's network manually (e.g. the Refocus rule). */
            recharge: (actor, options = {}) => rechargeVitality(actor, options),

            /** Fill the network to its maximum (the Refocus recharge). */
            rechargeToMax: (actor) => fillVitalityNetwork(actor),

            /** The rules-driven Refocus refill (class feature only by default). */
            refocus: (actor) => refocusRecharge(actor, { reason: "Manual" }),

            /** Which feature grants this actor's network: classFeature or archetypeFeat. */
            source: (actor) => vitalitySource(actor).kind,

            /** Compare (and optionally correct) the network's maximum. */
            checkCapacity: (actor, options = {}) => checkCapacity(actor, options),

            /** Correct every actor's stored network maximum (primary GM only). */
            correctCapacities: () => correctCapacities(),

            /** Re-apply the registered settings to the running configuration. */
            applySettings: () => applySettings(),

            /** Every setting this module registers, or the built-in defaults. */
            settings: () => {
                const values = {};
                for (const definition of SETTING_DEFINITIONS) {
                    try {
                        values[definition.key] = settingsRegistered
                            ? game.settings.get(MODULE_ID, definition.key)
                            : definition.default;
                    } catch (err) {
                        values[definition.key] = definition.default;
                    }
                }
                return values;
            },

            /** Open the diagnostics window. */
            diagnostics: () => showDiagnosticsDialog(),

            /** Which clients answer the relay, and which of them are GMs. */
            testRelay: (options) => testRelay(options),

            /** Transfer vitality without using the action's chat card. */
            transfer: (actor, { amount = null, targetToken = null } = {}) =>
                performTransfer({
                    caster: actor,
                    casterToken: findTokenDocument(actor),
                    actionItem: null,
                    amount,
                    targetToken: targetToken ?? Array.from(game.user.targets ?? [])[0]?.document ?? null,
                }),

            /** Attach one harmony effect to a token's actor. */
            applyHarmony: (targetActor, { harmony = "shadow", caster, casterToken = null, actionItem = null } = {}) => {
                const entry = typeof harmony === "string" ? HARMONIES[harmony] : harmony;
                if (!entry) {
                    warn(`Unknown harmony "${harmony}".`);
                    return null;
                }
                return createHarmonyEffect({
                    harmony: entry,
                    context: { caster, targetActor, targetToken: null, actionItem, amount: 0 },
                });
            },

            /** Which harmonies this actor's connections would grant. */
            connections: (actor) => connectedHarmonies(actor),

            /** Diagnostic dump — run this on a character to see what the script sees. */
            debug: (actor) => {
                if (!actor) {
                    console.warn(LOG_PREFIX, "debug(actor): no actor supplied");
                    return null;
                }
                const resource = getResourceInfo(actor);
                const harmony = detectHarmony(actor);
                const source = vitalitySource(actor);
                const level = levelOf(actor);
                const data = {
                    actor: actor.name,
                    uuid: actor.uuid,
                    level,
                    hasVitalityNetworkFeat: source.kind !== null,
                    source: source.kind,
                    sourceItem: source.item?.name ?? null,
                    vitalitySourceIds: itemsOf(actor)
                        .filter((i) => (i.slug ?? "") === "vitality-network" || i.name === "Vitality Network")
                        .map((i) => sourceIdOf(i)),
                    resource,
                    capacity: {
                        current: resource?.max ?? null,
                        expected: expectedCapacity(source.kind, level),
                        enforced: CONFIG.capacity.enforce,
                    },
                    spellDcRank: spellDcRank(actor),
                    recharge: rechargeAmount(actor),
                    maxTransfer: Math.min(resource?.value ?? 0, maxTransferForLevel(level, source.kind)),
                    transferProgression: CONFIG.transfer.progression,
                    connections: connectedHarmonies(actor),
                    harmony: harmony?.slug ?? null,
                    refocusRefill:
                        CONFIG.refocus.enabled &&
                        (!CONFIG.refocus.classFeatureOnly || source.kind === "classFeature"),
                    isOwner: actor.isOwner,
                    activeGM: game.users?.activeGM?.name ?? null,
                    inCombat: Boolean(game.combat?.started),
                };
                console.log(LOG_PREFIX, "debug", data);
                return data;
            },
        };
    }

    /* ------------------------- Diagnostics window ------------------------- */

    function diagnosticsRows() {
        const rows = [];
        for (const actor of game.actors ?? []) {
            if (!hasVitalityFeat(actor)) continue;

            const resource = getResourceInfo(actor);
            const source = vitalitySource(actor);
            const level = levelOf(actor);
            const expected = expectedCapacity(source.kind, level);
            const mismatch = Boolean(resource) && expected !== null && resource.max !== expected;

            rows.push(
                "<tr>" +
                    `<td>${foundry.utils.escapeHTML(actor.name)}</td>` +
                    `<td>${level}</td>` +
                    `<td>${source.kind ?? "-"}</td>` +
                    `<td>${resource ? `${resource.value} / ${resource.max}` : "-"}</td>` +
                    `<td${mismatch ? ' class="sf2e-vn-mismatch"' : ""}>${expected ?? "-"}</td>` +
                    `<td>${detectHarmony(actor)?.slug ?? "-"}</td>` +
                    `<td>${spellDcRank(actor)}</td>` +
                    "</tr>",
            );
        }
        return rows.join("");
    }

    /** The body of the diagnostics window. */
    function diagnosticsHtml() {
        const settings = SETTING_DEFINITIONS.map((definition) => {
            let value = definition.default;
            try {
                if (settingsRegistered) value = game.settings.get(MODULE_ID, definition.key);
            } catch (err) {
                /* keep the default */
            }
            return (
                `<li><strong>${_loc(definition.name)}</strong>: ` +
                `<code>${foundry.utils.escapeHTML(String(value))}</code></li>`
            );
        }).join("");

        const actors = diagnosticsRows();
        const coreVersion = game.version ?? game.release?.version ?? "?";
        const systemVersion = `${game.system?.id ?? "?"} ${game.system?.version ?? ""}`.trim();

        return `
            <div class="sf2e-vn-diagnostics">
                <p>SF2E Vitality Network <strong>v${VERSION}</strong> on Foundry
                ${foundry.utils.escapeHTML(String(coreVersion))} /
                ${foundry.utils.escapeHTML(systemVersion)}${
                    settingsRegistered ? "" : " - settings are not registered (running as a world script)"
                }.</p>
                <h3>Actors with a vitality network</h3>
                ${
                    actors
                        ? "<table><thead><tr><th>Actor</th><th>Level</th><th>Source</th><th>Network</th>" +
                          "<th>Expected max</th><th>Harmony</th><th>Spell DC rank</th></tr></thead>" +
                          `<tbody>${actors}</tbody></table>`
                        : '<p class="notes">No actor in this world has a vitality network yet.</p>'
                }
                <h3>Settings in effect</h3>
                <ul>${settings}</ul>
                <p class="notes">Tip: <code>game.sf2eVitalityNetwork.debug(game.user.character)</code>
                prints the same detail for one character to the console.</p>
            </div>`;
    }

    /** Show the diagnostics in a dialog (used when ApplicationV2 is missing). */
    function showDiagnosticsDialog() {
        const title = _loc("SF2E-VN.Settings.Diagnostics.Label");
        const content = diagnosticsHtml();
        const DialogV2 = foundry.applications?.api?.DialogV2;
        try {
            if (DialogV2) {
                return new DialogV2({
                    window: { title, icon: "fa-solid fa-stethoscope", resizable: true },
                    content,
                    buttons: [{ action: "close", label: _loc("SF2E-VN.Dialog.Close"), icon: "fa-solid fa-check" }],
                    modal: false,
                }).render(true);
            }
            return new Dialog({
                title,
                content,
                buttons: { close: { label: _loc("SF2E-VN.Dialog.Close") } },
            }).render(true);
        } catch (err) {
            error("Could not open the diagnostics window.", err);
            return null;
        }
    }

    /** The class Foundry instantiates for the settings-menu entry. */
    function createDiagnosticsMenuClass() {
        const Base = foundry.applications?.api?.ApplicationV2;
        if (!Base) {
            return class DiagnosticsFallback {
                render() {
                    showDiagnosticsDialog();
                    return this;
                }
                close() {}
            };
        }

        return class DiagnosticsMenu extends Base {
            static DEFAULT_OPTIONS = {
                id: "sf2e-vitality-network-diagnostics",
                window: {
                    title: _loc("SF2E-VN.Settings.Diagnostics.Label"),
                    icon: "fa-solid fa-stethoscope",
                    resizable: true,
                },
            };

            async _renderHTML() {
                return diagnosticsHtml();
            }

            _replaceHTML(result, content) {
                content.innerHTML = result;
            }
        };
    }

    function registerMenus() {
        if (!settingsRegistered || typeof game.settings.registerMenu !== "function") return;
        try {
            game.settings.registerMenu(MODULE_ID, "diagnostics", {
                name: _loc("SF2E-VN.Settings.Diagnostics.Name"),
                label: _loc("SF2E-VN.Settings.Diagnostics.Label"),
                hint: _loc("SF2E-VN.Settings.Diagnostics.Hint"),
                icon: "fa-solid fa-stethoscope",
                type: createDiagnosticsMenuClass(),
                restricted: true,
            });
        } catch (err) {
            error("Could not register the diagnostics menu.", err);
        }
    }

    let systemSupported = false;
    // True when a second copy of this script was loaded and stood down.
    let inertCopy = false;

    Hooks.once("init", () => {
        // Loading the script twice — a leftover world script beside the module, or
        // the World Scripter module — would double every trigger and stack two
        // dialogs. Whichever copy arrives second stands down.
        if (game.sf2eVitalityNetwork) {
            inertCopy = true;
            console.warn(
                `${LOG_PREFIX} another copy of this script is already loaded (game.sf2eVitalityNetwork exists). ` +
                    "This copy stays inert — check for a leftover world script or the World Scripter module.",
            );
            return;
        }

        systemSupported = SUPPORTED_SYSTEMS.has(game.system?.id ?? "");
        if (!systemSupported) {
            console.warn(
                `${LOG_PREFIX} this world runs the "${game.system?.id ?? "unknown"}" system, which is neither ` +
                    "PF2e nor SF2e — the module will stay inert.",
            );
            return;
        }

        registerSettings();
        registerMenus();
        exposeApi();
    });

    Hooks.once("ready", () => {
        if (inertCopy) return;

        if (!SUPPORTED_SYSTEMS.has(game.system?.id ?? "")) {
            console.warn(`${LOG_PREFIX} this world is not running PF2e or SF2e — the script will not run.`);
            return;
        }

        // Registered settings take precedence over the built-in defaults.
        applySettings();

        // Expose the API on the module as well, the usual module convention.
        const module = game.modules?.get?.(MODULE_ID);
        if (module) module.api = game.sf2eVitalityNetwork;

        registerSocketHandler();
        // (Foundry ignores hook return values; returning the promise keeps this
        // handler awaitable from tests and macros.)
        Hooks.on("createChatMessage", (message) => onChatMessage(message));

        // Correct stored network maxima up front, when enforcement is on.
        if (CONFIG.capacity.enforce && CONFIG.capacity.correctOnStartup) {
            void correctCapacities();
        }

        console.log(
            `${LOG_PREFIX} v${VERSION} loaded. Try game.sf2eVitalityNetwork.debug(game.user.character) to check setup.`,
        );
    });
})();
