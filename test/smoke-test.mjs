/**
 * Offline smoke test for sf2e-vitality-network.js
 *
 * Runs the world script inside a Node VM with stubbed Foundry/PF2e globals and
 * exercises the recharge, the transfer and all five connection harmonies. It
 * does not replace testing in a real world, but it catches logic, data-shape and
 * API-usage mistakes.
 *
 *   node vitality-network/test/smoke-test.mjs
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SCRIPT_PATH = new URL("../sf2e-vitality-network/sf2e-vitality-network.js", import.meta.url);

// Documents the world knows about, so `fromUuid` behaves like Foundry's — the
// GM's client has to resolve the target and caster a player's relay names.
const documents = new Map();
const registerDoc = (doc) => {
    if (doc?.uuid) documents.set(doc.uuid, doc);
    return doc;
};


const CONNECTIONS = {
    akashic: { id: "fM1vlupLq9Zlyt7C", name: "Akashic" },
    elemental: { id: "AurhNoZmNNhHktx6", name: "Elemental" },
    healing: { id: "XV8C2ASALC65G5MH", name: "Healing" },
    rhythm: { id: "jV9LIUswOPkVRC49", name: "Rhythm" },
    shadow: { id: "kvmpnKMVw4wwGk8c", name: "Shadow" },
};

/* -------------------------------------------------------------------------- */
/*  Harness                                                                    */
/* -------------------------------------------------------------------------- */

const results = [];
const check = (name, condition, detail = "") => {
    results.push({ name, ok: Boolean(condition), detail });
    console.log(`${condition ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
};

/** Build a stand-in for a dialog's form element from its rendered content. */
function fakeForm(content, overrides = {}) {
    const elements = {};
    for (const match of content.matchAll(/<select[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
        const selected = match[2].match(/<option[^>]*value="([^"]*)"[^>]*selected/);
        const first = match[2].match(/<option[^>]*value="([^"]*)"/);
        elements[match[1]] = { value: selected?.[1] ?? first?.[1] ?? "" };
    }
    for (const match of content.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)) {
        elements[match[1]] = { value: match[2] };
    }
    for (const [key, value] of Object.entries(overrides)) {
        if (value !== undefined) elements[key] = { value };
    }
    return { elements };
}

function makeEnvironment({ systemId = "pf2e", systemVersion = "8.6.0", isGM = true, userId = "user-1", socket = null } = {}) {
    const state = {
        created: [],
        damage: [],
        messages: [],
        warnings: [],
        infos: [],
        prompts: [],
        dialogOverrides: {},
        confirmAnswer: true,
    };

    const hooks = { on: new Map(), once: new Map() };
    const moduleStub = { id: "sf2e-vitality-network", api: null };
    const settingValues = new Map();
    const settingOptions = new Map();

    const Hooks = {
        on: (name, fn) => hooks.on.set(name, [...(hooks.on.get(name) ?? []), fn]),
        once: (name, fn) => hooks.once.set(name, [...(hooks.once.get(name) ?? []), fn]),
        call: async (name, ...args) => {
            for (const fn of hooks.on.get(name) ?? []) await fn(...args);
        },
        fireOnce: async (name, ...args) => {
            for (const fn of hooks.once.get(name) ?? []) await fn(...args);
        },
    };

    const game = {
        system: { id: systemId, version: systemVersion },
        version: "14.359",
        release: { version: "14.359" },
        user: { id: userId, isGM, active: true, character: null, targets: new Set() },
        users: { activeGM: null, contents: [] },
        actors: [],
        time: { worldTime: 1000 },
        combat: { id: "combat-1", started: true, round: 1, turn: 0, combatant: null },
        socket: socket ?? { on: () => {}, emit: () => {} },
        pf2e: {},
        i18n: {
            localize: (key) => key,
            format: (key, data) => (data ? `${key} ${JSON.stringify(data)}` : key),
        },
        modules: { get: (id) => (id === "sf2e-vitality-network" ? moduleStub : undefined) },
        settings: {
            register: (namespace, key, options) => {
                const id = `${namespace}.${key}`;
                settingOptions.set(id, options);
                if (!settingValues.has(id)) settingValues.set(id, options.default);
            },
            get: (namespace, key) => settingValues.get(`${namespace}.${key}`),
            set: async (namespace, key, value) => {
                settingValues.set(`${namespace}.${key}`, value);
            },
            registerMenu: () => {},
        },
    };
    // Foundry hands back the same User document, so the GM's own client is
    // identical to `game.users.activeGM`.
    // Foundry hands back the same User document, so a GM's own client is
    // identical to `game.users.activeGM`; a player's client instead sees the GM's
    // user document, which tests wire up when they need it.
    game.users.contents = [game.user];
    game.users.activeGM = isGM ? game.user : null;

    const ui = {
        notifications: {
            warn: (msg) => state.warnings.push(String(msg)),
            info: (msg) => state.infos.push(String(msg)),
        },
    };

    const foundry = {
        utils: {
            escapeHTML: (value) => String(value),
            randomID: () => `rnd-${Math.random().toString(36).slice(2, 8)}`,
            getProperty: (object, path) =>
                String(path)
                    .split(".")
                    .reduce((current, key) => (current === null || current === undefined ? current : current[key]), object),
        },
        applications: {
            api: {
                DialogV2: {
                    // Drive the dialog's own OK callback with a synthetic form,
                    // so the amount/element parsing is genuinely exercised.
                    prompt: async ({ content = "", ok }) => {
                        state.prompts.push(content);
                        const form = fakeForm(content, state.dialogOverrides);
                        return ok?.callback?.(null, { form });
                    },
                    confirm: async () => state.confirmAnswer,
                },
            },
        },
        ux: { TextEditor: { implementation: { enrichHTML: async (html) => html } } },
    };

    const CONFIG = {
        ChatMessage: { documentClass: { getSpeaker: () => ({ alias: "speaker" }) } },
        ux: { TextEditor: { implementation: { enrichHTML: async (html) => html } } },
        PF2E: {},
    };

    const canvas = {
        tokens: { controlled: [] },
        grid: { distance: 5, measurePath: () => ({ distance: 1 }) },
    };

    const sandbox = {
        console,
        setTimeout,
        clearTimeout,
        foundry,
        CONFIG,
        game,
        ui,
        canvas,
        Hooks,
        ChatMessage: {
            create: async (data) => {
                state.messages.push(data);
                return data;
            },
        },
        Dialog: class {},
        fromUuid: async (uuid) => documents.get(uuid) ?? null,
        fromUuidSync: (uuid) => documents.get(uuid) ?? null,
    };

    const context = vm.createContext(sandbox);
    vm.runInContext(readFileSync(SCRIPT_PATH, "utf8"), context, { filename: "sf2e-vitality-network.js" });

    return { sandbox, state, Hooks, game, moduleStub, settingValues, settingOptions };
}

/* -------------------------------------------------------------------------- */
/*  Mock actors                                                                */
/* -------------------------------------------------------------------------- */

/** An item with a working `update()` for dotted duration paths. */
function makeEffectItem({ name, slug, rounds = 3 }) {
    return {
        name,
        slug,
        type: "effect",
        id: `effect-${slug ?? name}`,
        system: { duration: { value: rounds, unit: "rounds", expiry: "turn-end" }, expired: false },
        async update(patch) {
            if ("system.duration.value" in patch) this.system.duration.value = patch["system.duration.value"];
            return this;
        },
    };
}

function makeVitalityItem(
    { kind = "archetypeFeat", sourcePackage = "sf2e-anachronism", sourceId, noSourceId = false, category } = {},
) {
    const isClassFeature = kind === "classFeature";
    const resolvedSourceId =
        sourceId ??
        (isClassFeature
            ? `Compendium.${sourcePackage}.class-features.Item.hNnIAyBxfQ2Howp2`
            : `Compendium.${sourcePackage}.feats.Item.kK5JtGm6PQh7DT7Q`);
    return {
        type: "feat",
        name: "Vitality Network",
        slug: "vitality-network",
        id: isClassFeature ? "feat-vitality-class" : "feat-vitality",
        sourceId: noSourceId ? undefined : resolvedSourceId,
        system: {
            category: category ?? (isClassFeature ? "classfeature" : "class"),
            rules: [
                {
                    key: "SpecialResource",
                    max: isClassFeature ? "6 + @actor.level*4" : "max(10 * floor(@actor.level / 5), 10)",
                },
            ],
        },
        updated: [],
        async update(patch) {
            this.updated.push(patch);
            for (const [path, value] of Object.entries(patch)) {
                const parts = path.split(".");
                let target = this;
                for (const part of parts.slice(0, -1)) target = target[part];
                target[parts.at(-1)] = value;
            }
            return this;
        },
    };
}

function connectionItem(connection, sourcePackage = "sf2e-anachronism") {
    return {
        type: "feat",
        name: connection.name,
        slug: connection.name.toLowerCase(),
        id: `connection-${connection.name}`,
        sourceId: `Compendium.${sourcePackage}.class-features.Item.${connection.id}`,
        system: { category: "classfeature", traits: { otherTags: ["mystic-connection"] } },
        flags: {},
    };
}

function makeCaster(
    {
        level = 10,
        value = 20,
        max = 20,
        spellDcRank = 0,
        isOwner = true,
        rankVia = "base",
        connection = "shadow",
        connectionVia = "sourceId",
        withFeat = true,
        withResource = true,
        source = "archetypeFeat",
        sourcePackage = "sf2e-anachronism",
        sourceId,
        noSourceId = false,
        category,
        connectionPackage,
        flagNamespace = "pf2e",
        extraItems = [],
    } = {},
) {
    const items = [];
    if (withFeat) {
        items.push(makeVitalityItem({ kind: source, sourcePackage, sourceId, noSourceId, category }));
    }

    if (connection) {
        const resolved = CONNECTIONS[connection];
        const connectionPack = connectionPackage ?? sourcePackage;
        const connectionTag = `Compendium.${connectionPack}.class-features.Item.${resolved.id}`;
        items.push(
            connectionVia === "sourceId"
                ? connectionItem(resolved, connectionPack)
                : {
                      type: "feat",
                      name: "Connection",
                      slug: "connection",
                      id: "feat-connection",
                      sourceId: "Compendium.sf2e-anachronism.class-features.Item.68j2yQ0lamRuR6oF",
                      system: { category: "classfeature" },
                      flags: {
                          [flagNamespace]: {
                              rulesSelections: {
                                  connection: connectionTag,
                              },
                          },
                      },
                  },
        );
    }

    items.push(...extraItems);

    const caster = {
        name: "Vex",
        uuid: "Actor.caster",
        type: "character",
        level,
        isOwner,
        combatant: { initiative: 12 },
        items: { contents: items },
        system: {
            resources: withResource ? { vitalityNetwork: { value, max, label: "Vitality Network" } } : {},
            attributes: { hp: { value: 30, max: 50 } },
            proficiencies: {},
        },
        spellcasting: {
            base: rankVia === "base" ? { rank: spellDcRank } : {},
            *[Symbol.iterator]() {
                if (rankVia === "entry" && spellDcRank > 0) yield { statistic: { rank: spellDcRank } };
            },
        },
        async updateResource(key, newValue) {
            caster.system.resources[key].value = newValue;
        },
        appliedDamage: [],
        async applyDamage(params) {
            caster.appliedDamage.push(params);
        },
        created: [],
        async createEmbeddedDocuments(_type, data) {
            caster.created.push(...data);
            return data;
        },
        async deleteEmbeddedDocuments() {},
        deleted: [],
        getActiveTokens: () => [],
    };
    registerDoc(caster);
    return caster;
}

function makeTarget(state, { conditions = [], afflictions = [], isOwner = true } = {}) {
    const items = [
        ...conditions.map((slug) => ({
            type: "condition",
            name: slug.charAt(0).toUpperCase() + slug.slice(1),
            slug,
            id: `condition-${slug}`,
            system: { value: { value: 1 } },
        })),
        ...afflictions.map((name) => ({
            type: "affliction",
            name,
            slug: name.toLowerCase().replace(/\s+/g, "-"),
            id: `affliction-${name}`,
            system: {},
        })),
    ];

    const targetActor = {
        name: "Ally",
        uuid: "Actor.ally",
        type: "character",
        isOwner,
        items: { contents: items },
        system: { attributes: { hp: { value: 10, max: 40 } } },
        async applyDamage(params) {
            state.damage.push(params);
        },
        async deleteEmbeddedDocuments(_type, ids) {
            state.deleted.push(...(Array.isArray(ids) ? ids : [ids]));
        },
        async createEmbeddedDocuments(_type, data) {
            state.created.push(...data);
            return data;
        },
    };
    const targetToken = { actor: targetActor, uuid: "Scene.s1.Token.ally" };
    registerDoc(targetActor);
    registerDoc(targetToken);
    return { targetActor, targetToken };
}

/* -------------------------------------------------------------------------- */
/*  Tests                                                                      */
/* -------------------------------------------------------------------------- */

const { sandbox, state, Hooks, game, moduleStub, settingValues, settingOptions } = makeEnvironment();
await Hooks.fireOnce("init");
await Hooks.fireOnce("ready");

const api = sandbox.game.sf2eVitalityNetwork;
check("api is exposed after ready", Boolean(api?.version), api?.version);

/* --- 1. Resource detection + recharge amounts ---------------------------- */

const master = makeCaster({ value: 4, max: 20, spellDcRank: 3 });
const legendary = makeCaster({ value: 4, max: 20, spellDcRank: 4 });
const untrained = makeCaster({ value: 4, max: 20, spellDcRank: 0 });
const masterViaEntry = makeCaster({ value: 4, max: 20, spellDcRank: 3, rankVia: "entry" });

check("feat detected by sourceId", api.debug(master).hasVitalityNetworkFeat === true);
check("resource found under vitalityNetwork", api.debug(master).resource?.key === "vitalityNetwork");
check("master in spell DC recharges 6", api.debug(master).recharge === 6);
check("legendary in spell DC recharges 8", api.debug(legendary).recharge === 8);
check("untrained recharges 4", api.debug(untrained).recharge === 4);
check("master detected from a spellcasting entry too", api.debug(masterViaEntry).recharge === 6);

await api.recharge(master);
check(
    "recharge adds 6 to the resource",
    master.system.resources.vitalityNetwork.value === 10,
    String(master.system.resources.vitalityNetwork.value),
);

master.system.resources.vitalityNetwork.value = 20;
await api.recharge(master);
check("recharge never exceeds the maximum", master.system.resources.vitalityNetwork.value === 20);

/* --- 2. Max transfer table ----------------------------------------------- */

const perLevel = (level) => api.debug(makeCaster({ level, value: 100, max: 100 })).maxTransfer;
check("max transfer at level 4 is 10", perLevel(4) === 10, String(perLevel(4)));
check("max transfer at level 10 is 20", perLevel(10) === 20, String(perLevel(10)));
check("max transfer at level 15 is 25 (archetype +5 steps)", perLevel(15) === 25, String(perLevel(15)));
check("max transfer at level 20 is 30 (archetype +5 steps)", perLevel(20) === 30, String(perLevel(20)));
check(
    "max transfer capped by the current value",
    api.debug(makeCaster({ level: 20, value: 7, max: 40 })).maxTransfer === 7,
);

/* --- 3. Harmony detection ------------------------------------------------- */

for (const slug of Object.keys(CONNECTIONS)) {
    const actor = makeCaster({ connection: slug });
    check(`connection detects the ${slug} harmony`, api.debug(actor).harmony === slug, String(api.debug(actor).harmony));
}

const viaSelection = makeCaster({ connection: "rhythm", connectionVia: "selection" });
check("Connection ChoiceSet selection detects the harmony", api.debug(viaSelection).harmony === "rhythm");

const noConnection = makeCaster({ connection: null });
check("no connection falls back to shadow", api.debug(noConnection).harmony === "shadow");
check("connections() lists the detected harmonies", JSON.stringify(api.connections(makeCaster({ connection: "healing" }))) === JSON.stringify(["healing"]));

const noFeatNoConnection = makeCaster({ connection: null, withFeat: false });
check("actor without the feat is not automated", api.debug(noFeatNoConnection).hasVitalityNetworkFeat === false);
const noResource = makeCaster({ connection: null, withFeat: false, withResource: false });
check("actor without the resource reports none", api.debug(noResource).resource === null);

/* --- 4. Shadow Harmony (transfer through the action's chat card) ---------- */

const { targetActor, targetToken } = makeTarget(state);
game.user.targets = new Set([{ document: targetToken }]);
state.dialogOverrides = { amount: 15 };

const caster = makeCaster({ level: 10, value: 20, max: 20, spellDcRank: 3, connection: "shadow" });
const actionItem = {
    name: "Transfer Vitality",
    slug: "transfer-vitality",
    uuid: "Actor.caster.Item.action",
    actor: caster,
};

await Hooks.call("createChatMessage", { author: { id: "user-1" }, item: actionItem, actor: caster, flags: {} });

check(
    "network reduced by the transferred amount",
    caster.system.resources.vitalityNetwork.value === 5,
    String(caster.system.resources.vitalityNetwork.value),
);
check("target healed via applyDamage with negative damage", state.damage[0]?.damage === -15, String(state.damage[0]?.damage));
check(
    "healing is not attributed to the action (its card must not read as a use)",
    state.damage[0]?.item == null,
    String(state.damage[0]?.item),
);

const shadow = state.created.at(-1);
check("Shadow Harmony effect created on the target", shadow?.name === "Shadow Harmony" && shadow.type === "effect");
check(
    "effect lasts 1 round, expiring at turn end",
    shadow?.system.duration.value === 1 && shadow.system.duration.unit === "rounds" && shadow.system.duration.expiry === "turn-end",
);
check(
    "effect origin is the caster (so it expires on the caster's turn)",
    shadow?.system.context.origin.actor === "Actor.caster",
    JSON.stringify(shadow?.system.context.origin),
);
check("effect is recorded as the shadow harmony", shadow?.flags?.["sf2e-vitality-network"]?.harmony === "shadow");
check("effect carries the source book", shadow?.flags?.["sf2e-vitality-network"]?.source === "Starfinder Player Core");

const light = shadow?.system.rules.find((rule) => rule.key === "TokenLight");
check(
    "TokenLight is a 10-ft darkness source",
    light?.value.negative === true && light.value.dim === 10 && light.value.bright === 0,
    JSON.stringify(light?.value),
);

const grant = shadow?.system.rules.find((rule) => rule.key === "GrantItem");
check("GrantItem grants concealed", grant?.uuid === "Compendium.pf2e.conditionitems.Item.DmAIPqOBomZ7H95W");
check("GrantItem removes concealed with the effect", grant?.onDeleteActions?.granter === "cascade");
check("shadow harmony adds a roll option", shadow?.system.rules.some((r) => r.key === "RollOption" && r.option === "harmony:shadow"));
check("transfer summary posted to chat", state.messages.length === 1 && /Shadow Harmony/.test(state.messages[0].content));

/* --- 5. Akashic Harmony --------------------------------------------------- */

state.created.length = 0;
state.messages.length = 0;
const akashic = makeCaster({ connection: "akashic" });
await api.transfer(akashic, { amount: 5 });
const akashicEffect = state.created.at(-1);
check("Akashic Harmony effect created", akashicEffect?.name === "Akashic Harmony");
check("Akashic effect adds the akashic roll option", akashicEffect?.system.rules.some((r) => r.option === "harmony:akashic"));
check("Akashic effect carries no darkness", !akashicEffect?.system.rules.some((r) => r.key === "TokenLight"));
check("Akashic effect expires on the caster's turn", akashicEffect?.system.context.origin.actor === "Actor.caster");
check("chat reports the akashic reaction", /Recall Knowledge/.test(state.messages.at(-1)?.content ?? ""));

/* --- 6. Elemental Harmony ------------------------------------------------- */

state.created.length = 0;
state.messages.length = 0;
state.prompts.length = 0;
const { targetActor: elementalTarget, targetToken: elementalToken } = makeTarget(state);
game.user.targets = new Set([{ document: elementalToken }]);
const elemental = makeCaster({ connection: "elemental" });
await api.transfer(elemental, { amount: 5 });

check("element prompt was shown", state.prompts.some((c) => c.includes("sf2e-vn-element")));
const elementalEffect = state.created.at(-1);
check("Elemental Harmony effect created", elementalEffect?.name === "Elemental Harmony");
check(
    "elemental effect expires on the target's turn",
    elementalEffect?.system.context.origin.actor === "Actor.ally",
    String(elementalEffect?.system.context.origin.actor),
);
check(
    "elemental effect tags the element",
    JSON.stringify(elementalEffect?.system.traits) === JSON.stringify({ value: ["magical"], otherTags: ["fire"] }),
    JSON.stringify(elementalEffect?.system.traits),
);
const override = elementalEffect?.system.rules.find((rule) => rule.key === "DamageDice");
check(
    "DamageDice overrides strike damage to the chosen type",
    override?.selector === "strike-damage" && override.override?.damageType === "fire",
    JSON.stringify(override),
);
check("elemental roll option names the element", elementalEffect?.system.rules.some((r) => r.option === "harmony:elemental:fire"));
check("chat notes the elemental damage types", /electricity or sonic|fire/.test(state.messages.at(-1)?.content ?? ""));

/* --- 7. Healing Harmony --------------------------------------------------- */

state.created.length = 0;
state.messages.length = 0;
const { targetActor: hurtTarget, targetToken: hurtToken } = makeTarget(state, {
    conditions: ["clumsy", "sickened"],
    afflictions: ["Red Ache"],
});
game.user.targets = new Set([{ document: hurtToken }]);
const healer = makeCaster({ level: 10, connection: "healing" });
await api.transfer(healer, { amount: 5 });

check("healing harmony attaches no effect", state.created.length === 0);
const healingCard = state.messages.at(-1)?.content ?? "";
check("healing chat card asks for a counteract", /counteract/i.test(healingCard));
check("healing card names the affliction found", /Red Ache/.test(healingCard));
check("healing card names an eligible condition", /Clumsy/.test(healingCard));
check("healing card mentions the heal itself", /transfers/.test(healingCard));

const { targetActor: cleanTarget, targetToken: cleanToken } = makeTarget(state);
game.user.targets = new Set([{ document: cleanToken }]);
state.messages.length = 0;
await api.transfer(makeCaster({ connection: "healing" }), { amount: 5 });
check("healing card reports nothing to counteract", /no affliction or eligible condition/i.test(state.messages.at(-1)?.content ?? ""));

const level19 = makeCaster({ level: 19, connection: "healing" });
const { targetActor: doomedTarget, targetToken: doomedToken } = makeTarget(state, { conditions: ["doomed"] });
game.user.targets = new Set([{ document: doomedToken }]);
state.messages.length = 0;
await api.transfer(level19, { amount: 5 });
check("Perfect Harmony adds the 19th-level conditions", /Doomed/.test(state.messages.at(-1)?.content ?? ""));
check("Perfect Harmony notes the suppression rule", /suppressed/i.test(state.messages.at(-1)?.content ?? ""));

/* --- 8. Rhythm Harmony ---------------------------------------------------- */

state.messages.length = 0;
const anthem = makeEffectItem({ name: "Spell Effect: Anthem", slug: "spell-effect-anthem", rounds: 3 });
const rhythmCaster = makeCaster({ connection: "rhythm", extraItems: [anthem] });
const { targetActor: rhythmTarget, targetToken: rhythmToken } = makeTarget(state);
game.user.targets = new Set([{ document: rhythmToken }]);
await api.transfer(rhythmCaster, { amount: 5 });

check("rhythm harmony extends the active epiphany", anthem.system.duration.value === 4, String(anthem.system.duration.value));
check("rhythm card reports the extension", /Anthem/.test(state.messages.at(-1)?.content ?? ""));

/* --- 9. Amount clamping and guards --------------------------------------- */

state.created.length = 0;
state.damage.length = 0;
const clamped = makeCaster({ level: 10, value: 20, max: 20, connection: "shadow" });
state.dialogOverrides = { amount: 999 };
game.user.targets = new Set([{ document: targetToken }]);
await api.transfer(clamped, {});
check("an over-large entry is clamped to the maximum", clamped.system.resources.vitalityNetwork.value === 0, String(clamped.system.resources.vitalityNetwork.value));
check("the clamped transfer heals by the maximum", state.damage.at(-1)?.damage === -20, String(state.damage.at(-1)?.damage));
state.dialogOverrides = {};

state.warnings.length = 0;
const refused = await api.transfer(makeCaster({ value: 0, max: 20 }), { amount: 5 });
check("empty network refuses the transfer", refused === false && state.warnings.length > 0, state.warnings.at(-1));

state.created.length = 0;
state.messages.length = 0;
const noHarmony = makeCaster({ connection: null });
noHarmony.items.contents = noHarmony.items.contents.filter((i) => i.slug !== "vitality-network");
sandbox.game.sf2eVitalityNetwork.config.harmonyFallback = null;
const offTarget = makeTarget(state);
game.user.targets = new Set([{ document: offTarget.targetToken }]);
await api.transfer(noHarmony, { amount: 5 });
check("harmonyFallback null attaches no harmony effect", state.created.length === 0);
check("the heal still happens without a harmony", offTarget.targetActor.system.attributes.hp.value === 10);
sandbox.game.sf2eVitalityNetwork.config.harmonyFallback = "shadow";

/* --- 10. Source-aware transfer progressions ------------------------------- */

check("class feature detected as the source", api.debug(makeCaster({ source: "classFeature" })).source === "classFeature");
check("archetype feat detected as the source", api.debug(makeCaster()).source === "archetypeFeat");
check(
    "class feature transfer max at 5th is 20",
    api.debug(makeCaster({ level: 5, value: 99, max: 99, source: "classFeature" })).maxTransfer === 20,
);
check(
    "class feature transfer max at 10th is 30",
    api.debug(makeCaster({ level: 10, value: 99, max: 99, source: "classFeature" })).maxTransfer === 30,
);
check(
    "class feature transfer max at 15th is 40",
    api.debug(makeCaster({ level: 15, value: 99, max: 99, source: "classFeature" })).maxTransfer === 40,
);
check(
    "class feature transfer max at 20th is 50",
    api.debug(makeCaster({ level: 20, value: 99, max: 99, source: "classFeature" })).maxTransfer === 50,
);
check("archetype transfer max at 5th is 15", api.debug(makeCaster({ level: 5, value: 99, max: 99 })).maxTransfer === 15);

api.config.transfer.progression = "houseRule";
check(
    "the houseRule option restores the 10/20/30/40 table",
    api.debug(makeCaster({ level: 15, value: 99, max: 99 })).maxTransfer === 30,
);
api.config.transfer.progression = "source";

/* --- 11. Capacity --------------------------------------------------------- */

const previousEnforce = api.config.capacity.enforce;

// Reporting path
api.config.capacity.enforce = false;
const mismatch = await api.checkCapacity(makeCaster({ level: 15, value: 10, max: 100 }));
check(
    "capacity mismatch is reported when enforce is off",
    mismatch?.matches === false && mismatch.expected === 30,
    JSON.stringify(mismatch),
);
const matchingCapacity = await api.checkCapacity(makeCaster({ level: 10, value: 10, max: 20 }));
check("a matching capacity reports no mismatch", matchingCapacity?.matches === true);
const classCapacity = await api.checkCapacity(makeCaster({ level: 20, value: 10, max: 100, source: "classFeature" }));
check("class feature capacity at 20th is 86 (6 + 4 per level)", classCapacity?.expected === 86, JSON.stringify(classCapacity));
api.config.capacity.enforce = previousEnforce;

// Enforcing path (the default)
check("capacity enforcement is on by default", api.config.capacity.enforce === true);
state.infos.length = 0;
const enforced = makeCaster({ level: 15, value: 10, max: 100 });
const enforcedItem = enforced.items.contents.find((item) => item.slug === "vitality-network");
const enforcedReport = await api.checkCapacity(enforced);
const enforcedFormula = enforcedItem?.updated.at(-1)?.["system.rules.0.max"];
check(
    "enforcing rewrites the SpecialResource formula",
    enforcedReport?.enforced === true && typeof enforcedFormula === "string",
    String(enforcedFormula),
);
check(
    "the enforced formula steps at 10th, 15th and 20th",
    /floor\(@actor\.level\/10\)/.test(enforcedFormula ?? "") && /floor\(@actor\.level\/20\)/.test(enforcedFormula ?? ""),
    String(enforcedFormula),
);
check("the enforced expectation is the printed text at 15th", enforcedReport?.expected === 30);
check("correcting the maximum is reported to the table", /maximum is now/.test(state.infos.at(-1) ?? ""));

const classActor = makeCaster({ level: 20, value: 10, max: 100, source: "classFeature" });
const classItem = classActor.items.contents.find((item) => item.slug === "vitality-network");
await api.checkCapacity(classActor);
check("the class feature's own formula is left untouched", classItem.updated.length === 0);

// The whole-world pass the GM's client runs as the world loads.
const startupActor = makeCaster({ level: 15, value: 10, max: 100 });
const startupItem = startupActor.items.contents.find((item) => item.slug === "vitality-network");
game.actors = [startupActor, makeCaster({ level: 5, value: 10, max: 10 })];
const correctedCount = await api.correctCapacities();
check(
    "correctCapacities() fixes each actor whose maximum disagrees",
    correctedCount === 1 && startupItem.updated.length === 1,
    String(correctedCount),
);
game.actors = [];

/* --- 12. Refocus ---------------------------------------------------------- */

const refocusClass = makeCaster({ level: 10, value: 3, max: 20, source: "classFeature" });
const refocusGain = await api.refocus(refocusClass);
check(
    "Refocus fills a class-feature network completely",
    refocusGain === 17 && refocusClass.system.resources.vitalityNetwork.value === 20,
    JSON.stringify({ refocusGain }),
);

const refocusFeat = makeCaster({ level: 10, value: 3, max: 20 });
const archetypeGain = await api.refocus(refocusFeat);
check(
    "Refocus refills an archetype network too (classFeatureOnly is false)",
    archetypeGain === 17 && refocusFeat.system.resources.vitalityNetwork.value === 20,
    JSON.stringify({ archetypeGain }),
);

api.config.refocus.classFeatureOnly = true;
const restricted = makeCaster({ level: 10, value: 3, max: 20 });
check("classFeatureOnly restricts the refill to the class feature", (await api.refocus(restricted)) === 0);
api.config.refocus.classFeatureOnly = false;

const focusActor = makeCaster({ level: 10, value: 2, max: 20, source: "classFeature" });
focusActor.uuid = "Actor.focuser";
focusActor.system.resources.focus = { value: 0, max: 1 };
const focusChanges = { system: { resources: { focus: { value: 1 } } } };
await Hooks.call("preUpdateActor", focusActor, focusChanges);
focusActor.system.resources.focus.value = 1;
await Hooks.call("updateActor", focusActor, focusChanges);
check(
    "restoring a focus point refills the network",
    focusActor.system.resources.vitalityNetwork.value === 20,
    String(focusActor.system.resources.vitalityNetwork.value),
);

const cardActor = makeCaster({ level: 10, value: 4, max: 20, source: "classFeature" });
await Hooks.call("createChatMessage", {
    author: { id: "user-1" },
    item: { name: "Refocus", slug: "refocus", actor: cardActor },
    actor: cardActor,
    flags: {},
});
check(
    "the Refocus action card refills the network",
    cardActor.system.resources.vitalityNetwork.value === 20,
    String(cardActor.system.resources.vitalityNetwork.value),
);

/* --- 13. Module settings -------------------------------------------------- */

const settingId = (key) => `sf2e-vitality-network.${key}`;

check("settings are registered when loaded as a module", settingOptions.size > 0, String(settingOptions.size));
check(
    "the capacity setting is a world-scoped boolean",
    settingOptions.get(settingId("capacityEnforce"))?.scope === "world" &&
        settingOptions.get(settingId("capacityEnforce"))?.type?.name === "Boolean",
    JSON.stringify(settingOptions.get(settingId("capacityEnforce"))?.scope),
);
check("verbose logging is a client setting", settingOptions.get(settingId("verboseLogging"))?.scope === "client");
check(
    "the transfer progression setting offers the four tables",
    Object.keys(settingOptions.get(settingId("transferProgression"))?.choices ?? {}).length === 4,
);
check("the API is exposed on the module too", moduleStub.api === api);

// The stored defaults were applied at ready.
check(
    "stored defaults were applied to the config",
    api.config.capacity.enforce === true && api.config.refocus.classFeatureOnly === false,
    JSON.stringify({ enforce: api.config.capacity.enforce }),
);
check(
    "api.settings() reports the stored values",
    api.settings().capacityEnforce === true && api.settings().transferProgression === "source",
    JSON.stringify(api.settings()),
);

// Changing settings and re-applying pushes them into the config.
settingValues.set(settingId("capacityEnforce"), false);
settingValues.set(settingId("transferProgression"), "houseRule");
settingValues.set(settingId("harmonyFallback"), "none");
api.applySettings();
check(
    "applySettings() pushes stored values into the config",
    api.config.capacity.enforce === false &&
        api.config.transfer.progression === "houseRule" &&
        api.config.harmonyFallback === null,
    JSON.stringify({ enforce: api.config.capacity.enforce, fallback: api.config.harmonyFallback }),
);

// Advanced overrides (JSON)
settingValues.set(
    settingId("advancedOverrides"),
    '{"recharge":{"master":9},"transfer":{"progression":"classFeature"}}',
);
api.applySettings();
check(
    "the JSON overrides are merged over the config",
    api.config.recharge.master === 9 && api.config.transfer.progression === "classFeature",
    JSON.stringify(api.config.recharge),
);

settingValues.set(settingId("advancedOverrides"), '{"capacity":{"classFeature":123},"unknownKey":1}');
api.applySettings();
check(
    "overrides never replace functions or unknown keys",
    typeof api.config.capacity.classFeature === "function" && api.config.unknownKey === undefined,
);

state.warnings.length = 0;
settingValues.set(settingId("advancedOverrides"), "{not json");
api.applySettings();
check(
    "invalid JSON is reported and ignored",
    state.warnings.some((warning) => /valid JSON/.test(warning)) && api.config.recharge.master === 6,
    JSON.stringify(state.warnings),
);

// Restoring the defaults must undo everything the overrides changed.
settingValues.set(settingId("advancedOverrides"), "{}");
settingValues.set(settingId("capacityEnforce"), true);
settingValues.set(settingId("transferProgression"), "source");
settingValues.set(settingId("harmonyFallback"), "shadow");
api.applySettings();
check(
    "restoring the defaults puts the config back",
    api.config.capacity.enforce === true &&
        api.config.transfer.progression === "source" &&
        api.config.recharge.master === 6 &&
        api.config.harmonyFallback === "shadow",
    JSON.stringify({ recharge: api.config.recharge, fallback: api.config.harmonyFallback }),
);

/* --- 14. Dual-system support (PF2e and SF2e) ------------------------------ */

// The module must come up on the SF2e system, not only on PF2e.
const sf = makeEnvironment({ systemId: "sf2e", systemVersion: "1.6.0" });
await sf.Hooks.fireOnce("init");
await sf.Hooks.fireOnce("ready");
const sfApi = sf.sandbox.game.sf2eVitalityNetwork;

check("the module loads on the SF2e system", typeof sfApi?.debug === "function");
check("settings are registered on SF2e too", sf.settingOptions.size > 0, String(sf.settingOptions.size));
check("the SF2e API carries the same surface", typeof sfApi.transfer === "function" && typeof sfApi.refocus === "function");
check("the API is exposed on the module on SF2e", sf.moduleStub.api === sfApi);

// SF2e ships the same items inside its own packs.
check(
    "an SF2e-pack archetype feat is detected",
    sfApi.source(makeCaster({ sourceId: "Compendium.sf2e.feats.Item.kK5JtGm6PQh7DT7Q" })) === "archetypeFeat",
);
check(
    "an SF2e-pack class feature is detected",
    sfApi.source(makeCaster({ source: "classFeature", sourcePackage: "sf2e" })) === "classFeature",
);
check(
    "an SF2e-pack connection grants its harmony",
    sfApi.connections(makeCaster({ connection: "rhythm", connectionPackage: "sf2e" })).includes("rhythm"),
);

// SF2e creates the class feature on the actor, where only an Actor uuid survives.
const embeddedFeature = makeCaster({
    source: "classFeature",
    sourceId: "Actor.RO68UqGkBDZvGCx4.Item.2OvKQHIMWuB4zFWm",
});

// A copy with no source id still classifies by name and category, and the
// category spelling does not matter.
check(
    "a hyphenated class-feature category is understood",
    sfApi.source(makeCaster({ source: "classFeature", noSourceId: true, category: "class-feature" })) === "classFeature",
);
check(
    "a feature with no source id still classifies",
    sfApi.source(makeCaster({ source: "classFeature", noSourceId: true })) === "classFeature",
);

// Connections are found in the SF2e flags namespace as well.
const sfSelection = makeCaster({ connection: "rhythm", connectionVia: "selection", flagNamespace: "sf2e" });
check(
    "connections are read from flags.sf2e",
    sfApi.connections(sfSelection).includes("rhythm"),
    JSON.stringify(sfApi.connections(sfSelection)),
);

// Turn recharge must fire on the SF2e turn hook too.
const sfTurnActor = makeCaster({ level: 10, value: 4, max: 20 });
const sfCombat = { id: "combat-sf2e", started: true, round: 1, turn: 0, combatant: { id: "c1", actor: sfTurnActor } };
sf.sandbox.game.combat = sfCombat;
await sf.Hooks.call("sf2e.startTurn", sfCombat.combatant, sfCombat);
check(
    "the SF2e turn hook recharges the network",
    sfTurnActor.system.resources.vitalityNetwork.value === 8,
    String(sfTurnActor.system.resources.vitalityNetwork.value),
);

// The override settles ambiguous copies, and never invents a network.
sfApi.config.source.override = "classFeature";
check(
    "the override forces the class-feature reading",
    sfApi.source(makeCaster({ source: "archetypeFeat", noSourceId: true })) === "classFeature",
);
sfApi.config.source.override = "archetypeFeat";
check(
    "the override forces the feat reading",
    sfApi.source(makeCaster({ source: "classFeature" })) === "archetypeFeat",
);
check(
    "the override cannot invent a network",
    sfApi.source(makeCaster({ withFeat: false })) === null,
);
sfApi.config.source.override = "auto";
check(
    "auto detection is restored",
    sfApi.source(makeCaster({ source: "classFeature" })) === "classFeature",
);

// The concealed condition is looked up in the running system's own pack.
// (the condition uuid is resolved against the running system, so let it resolve)
sf.sandbox.fromUuidSync = () => ({ uuid: "resolved" });
const sfTarget = makeTarget(sf.state);
await sfApi.applyHarmony(sfTarget.targetActor, { harmony: "shadow", caster: makeCaster({ connection: "shadow" }) });
const sfShadow = sf.state.created.at(-1);
const sfGrant = sfShadow?.system?.rules?.find((rule) => rule.key === "GrantItem");
check(
    "the concealed condition is granted from the SF2e pack",
    sfGrant?.uuid === "Compendium.sf2e.conditionitems.Item.DmAIPqOBomZ7H95W",
    JSON.stringify(sfGrant?.uuid),
);

// An unrelated system keeps the module inert.
const other = makeEnvironment({ systemId: "dnd5e", systemVersion: "4.0.0" });
await other.Hooks.fireOnce("init");
await other.Hooks.fireOnce("ready");
check("the module stays inert on an unrelated system", other.sandbox.game.sf2eVitalityNetwork === undefined);

/* --- 15. The module's own card must not re-trigger the action ------------- */

const { targetToken: reTargetToken } = makeTarget(state);
game.user.targets = new Set([{ document: reTargetToken }]);
state.dialogOverrides = { amount: 5 };

const reCaster = makeCaster({ level: 10, value: 20, max: 20, connection: null });
const reAction = {
    name: "Transfer Vitality",
    slug: "transfer-vitality",
    uuid: "Actor.caster.Item.action",
    actor: reCaster,
};
const promptsBefore = state.prompts.length;

// A genuine use opens the dialog…
await Hooks.call("createChatMessage", {
    id: "msg-use-1",
    author: { id: "user-1" },
    item: reAction,
    actor: reCaster,
    flags: {},
});
check(
    "a use of the action opens the dialog",
    state.prompts.length === promptsBefore + 1,
    String(state.prompts.length - promptsBefore),
);

// …the same card is only ever handled once…
await Hooks.call("createChatMessage", {
    id: "msg-use-1",
    author: { id: "user-1" },
    item: reAction,
    actor: reCaster,
    flags: {},
});
check(
    "the same card is only handled once",
    state.prompts.length === promptsBefore + 1,
    String(state.prompts.length - promptsBefore),
);

// …and the module's own summary card is ignored outright.
const summaryCard = state.messages.at(-1);
check(
    "the summary card is marked as the module's own",
    summaryCard?.flags?.["sf2e-vitality-network"]?.card === true,
    JSON.stringify(summaryCard?.flags ?? {}),
);
check(
    "the summary card links nothing that could be used again",
    !/@UUID/.test(summaryCard?.content ?? ""),
    String(summaryCard?.content ?? "").slice(0, 90),
);
await Hooks.call("createChatMessage", {
    ...summaryCard,
    id: "msg-summary-1",
    author: { id: "user-1" },
    item: reAction,
    actor: reCaster,
});
check(
    "the module's own card does not open the dialog",
    state.prompts.length === promptsBefore + 1,
    String(state.prompts.length - promptsBefore),
);

/* --- 16. Overlapping triggers must not stack dialogs ---------------------- */

const concurrentCaster = makeCaster({ level: 10, value: 20, max: 20, connection: null });
const concurrentAction = {
    name: "Transfer Vitality",
    slug: "transfer-vitality",
    uuid: "Actor.caster.Item.action",
    actor: concurrentCaster,
};
const promptsBeforeConcurrent = state.prompts.length;
const firstTrigger = Hooks.call("createChatMessage", {
    id: "msg-concurrent-1",
    author: { id: "user-1" },
    item: concurrentAction,
    actor: concurrentCaster,
    flags: {},
});
const secondTrigger = Hooks.call("createChatMessage", {
    id: "msg-concurrent-2",
    author: { id: "user-1" },
    item: concurrentAction,
    actor: concurrentCaster,
    flags: {},
});
await Promise.all([firstTrigger, secondTrigger]);
check(
    "overlapping triggers open only one dialog",
    state.prompts.length === promptsBeforeConcurrent + 1,
    String(state.prompts.length - promptsBeforeConcurrent),
);
check(
    "overlapping triggers transfer only once",
    concurrentCaster.system.resources.vitalityNetwork.value === 15,
    String(concurrentCaster.system.resources.vitalityNetwork.value),
);

/* --- 17. A transfer to a character the player does not own ---------------- */

// Two clients sharing one socket: a GM, and a player who owns neither the GM's
// actors nor the target.
const sharedClients = [];
const loopbackSocket = {
    on: (channel, handler) => sharedClients.push({ channel, handler }),
    emit: (channel, message) => {
        for (const client of sharedClients.slice()) {
            if (client.channel === channel) void client.handler(message);
        }
    },
};

const gmEnv = makeEnvironment({ socket: loopbackSocket, userId: "gm-1", isGM: true });
await gmEnv.Hooks.fireOnce("init");
await gmEnv.Hooks.fireOnce("ready");

const playerEnv = makeEnvironment({ socket: loopbackSocket, userId: "user-1", isGM: false });
await playerEnv.Hooks.fireOnce("init");
await playerEnv.Hooks.fireOnce("ready");

// The player's client can see the GM, and the target belongs to someone else.
playerEnv.game.users.contents = [gmEnv.game.user, playerEnv.game.user];
playerEnv.game.users.activeGM = gmEnv.game.user;
gmEnv.game.users.contents = [gmEnv.game.user, playerEnv.game.user];

const relayTarget = makeTarget(playerEnv.state, { isOwner: false });
playerEnv.game.user.targets = new Set([{ document: relayTarget.targetToken }]);
playerEnv.state.dialogOverrides = { amount: 8 };

const relayCaster = makeCaster({ level: 10, value: 20, max: 20, connection: null });
const relayAction = {
    name: "Transfer Vitality",
    slug: "transfer-vitality",
    uuid: "Actor.caster.Item.action",
    actor: relayCaster,
};

await playerEnv.Hooks.call("createChatMessage", {
    id: "msg-relay-1",
    author: { id: "user-1" },
    item: relayAction,
    actor: relayCaster,
    flags: {},
});

check(
    "the network is spent even when the target is not the player's",
    relayCaster.system.resources.vitalityNetwork.value === 12,
    String(relayCaster.system.resources.vitalityNetwork.value),
);
check(
    "the GM's client healed the target",
    playerEnv.state.damage.at(-1)?.damage === -8,
    JSON.stringify(playerEnv.state.damage.at(-1) ?? null),
);
check(
    "the summary says the GM applied it",
    /Applied by the GM's client/.test(playerEnv.state.messages.at(-1)?.content ?? ""),
    String(playerEnv.state.messages.at(-1)?.content ?? "").slice(0, 120),
);
check(
    "the summary does not report a failure",
    !/Not applied automatically/.test(playerEnv.state.messages.at(-1)?.content ?? ""),
    String(playerEnv.state.messages.at(-1)?.content ?? "").slice(0, 120),
);

/* Nobody can apply it: no GM online, and no client owns the target. */

const lonelyEnv = makeEnvironment({ socket: loopbackSocket, userId: "user-9", isGM: false });
await lonelyEnv.Hooks.fireOnce("init");
await lonelyEnv.Hooks.fireOnce("ready");
lonelyEnv.game.users.contents = [lonelyEnv.game.user];
lonelyEnv.game.users.activeGM = null;
lonelyEnv.game.sf2eVitalityNetwork.config.relayTimeoutMs = 30;

const lonelyTarget = makeTarget(lonelyEnv.state, { isOwner: false });
lonelyEnv.game.user.targets = new Set([{ document: lonelyTarget.targetToken }]);
lonelyEnv.state.dialogOverrides = { amount: 4 };
const lonelyCaster = makeCaster({ level: 10, value: 20, max: 20, connection: null });

await lonelyEnv.Hooks.call("createChatMessage", {
    id: "msg-relay-2",
    author: { id: "user-9" },
    item: { ...relayAction, actor: lonelyCaster },
    actor: lonelyCaster,
    flags: {},
});

check(
    "the summary explains why nothing could be applied",
    /no GM is connected/.test(lonelyEnv.state.messages.at(-1)?.content ?? ""),
    String(lonelyEnv.state.messages.at(-1)?.content ?? "").slice(0, 160),
);



/* --- 18. Refocus from a macro card --------------------------------------- */

const macroEnv = makeEnvironment();
await macroEnv.Hooks.fireOnce("init");
await macroEnv.Hooks.fireOnce("ready");
const macroCaster = makeCaster({ level: 10, value: 4, max: 20, connection: null });

await macroEnv.Hooks.call("createChatMessage", {
    id: "msg-refocus-macro",
    author: { id: "user-1" },
    actor: macroCaster,
    content: "<p>Vex spends 10 minutes to <strong>Refocus</strong> and recover.</p>",
    flags: {},
});

check(
    "a Refocus macro card refills the network",
    macroCaster.system.resources.vitalityNetwork.value === 20,
    String(macroCaster.system.resources.vitalityNetwork.value),
);

// A card that does not mention Refocus must leave the network alone.
const quietCaster = makeCaster({ level: 10, value: 5, max: 20, connection: null });
await macroEnv.Hooks.call("createChatMessage", {
    id: "msg-not-refocus",
    author: { id: "user-1" },
    actor: quietCaster,
    content: "<p>Vex looks around the room.</p>",
    flags: {},
});

check(
    "an ordinary card does not refill the network",
    quietCaster.system.resources.vitalityNetwork.value === 5,
    String(quietCaster.system.resources.vitalityNetwork.value),
);

/* --- 19. The workbench Refocus card, and the relay diagnostic ------------- */

// The workbench macro posts its wording in the *flavour* and leaves the content as
// the localised "regains N focus points" line, so the flavour is the only clue.
const workbenchEnv = makeEnvironment();
await workbenchEnv.Hooks.fireOnce("init");
await workbenchEnv.Hooks.fireOnce("ready");
const workbenchCaster = makeCaster({ level: 10, value: 3, max: 20, connection: null });

await workbenchEnv.Hooks.call("createChatMessage", {
    id: "msg-workbench-refocus",
    author: { id: "user-1" },
    actor: workbenchCaster,
    flavor:
        '<strong><img src="systems/pf2e/icons/actions/Passive.webp" width="10" height="10" alt="Passive">Refocus</strong>',
    content: "Regains 1 focus points.",
    style: 3,
    flags: {},
});

check(
    "the workbench Refocus card (wording in the flavour) refills the network",
    workbenchCaster.system.resources.vitalityNetwork.value === 20,
    String(workbenchCaster.system.resources.vitalityNetwork.value),
);

// The relay diagnostic should report the GM client and the candidate list.
const relayReport = await playerEnv.game.sf2eVitalityNetwork.testRelay({ timeoutMs: 20 });
check(
    "the relay diagnostic finds the GM's client",
    relayReport.replies.some((reply) => reply.id === "gm-1"),
    JSON.stringify(relayReport.replies),
);
check(
    "the relay diagnostic lists the GM as a candidate",
    relayReport.candidates.some((user) => user.id === "gm-1"),
    JSON.stringify(relayReport.candidates),
);

/* --- 20. A listed GM whose client runs no module -------------------------- */

const silentClients = [];
const silentSocket = {
    on: (channel, handler) => silentClients.push({ channel, handler }),
    emit: (channel, message) => {
        for (const client of silentClients.slice()) {
            if (client.channel === channel) void client.handler(message);
        }
    },
};

// The target's owner runs the module; the GM who is listed as connected does not.
const ownerEnv = makeEnvironment({ socket: silentSocket, userId: "user-1", isGM: false });
await ownerEnv.Hooks.fireOnce("init");
await ownerEnv.Hooks.fireOnce("ready");

const ownerTarget = makeTarget(ownerEnv.state, { isOwner: true });
const ghostGm = { id: "gm-ghost", name: "Ghost GM", isGM: true, active: true };

const ignoredEnv = makeEnvironment({ socket: silentSocket, userId: "user-9", isGM: false });
await ignoredEnv.Hooks.fireOnce("init");
await ignoredEnv.Hooks.fireOnce("ready");
ignoredEnv.game.users.contents = [ghostGm, ownerEnv.game.user, ignoredEnv.game.user];
ignoredEnv.game.users.activeGM = ghostGm;
ignoredEnv.game.sf2eVitalityNetwork.config.relayTimeoutMs = 40;
ignoredEnv.game.sf2eVitalityNetwork.config.relayPerCandidateMs = 40;
ignoredEnv.game.user.targets = new Set([{ document: ownerTarget.targetToken }]);
ignoredEnv.state.dialogOverrides = { amount: 6 };

const ignoredCaster = makeCaster({ level: 10, value: 20, max: 20, connection: null });
await ignoredEnv.Hooks.call("createChatMessage", {
    id: "msg-ghost-gm",
    author: { id: "user-9" },
    item: {
        name: "Transfer Vitality",
        slug: "transfer-vitality",
        uuid: "Actor.caster.Item.action",
        actor: ignoredCaster,
    },
    actor: ignoredCaster,
    flags: {},
});

check(
    "the network is spent when the listed GM's client runs no module",
    ignoredCaster.system.resources.vitalityNetwork.value === 14,
    String(ignoredCaster.system.resources.vitalityNetwork.value),
);
check(
    "the target's owner applies the transfer instead",
    ownerEnv.state.damage.at(-1)?.damage === -6,
    JSON.stringify(ownerEnv.state.damage.at(-1) ?? null),
);

/* -------------------------------------------------------------------------- */
/*  Summary                                                                    */
/* -------------------------------------------------------------------------- */

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
check(
    "an actor-embedded SF2e class feature is detected",
    sfApi.source(embeddedFeature) === "classFeature",
    JSON.stringify({
        detected: sfApi.source(embeddedFeature),
        items: embeddedFeature.items.contents.map((item) => [item.name, item.slug, item.sourceId, item.system?.category]),
    }),
);
