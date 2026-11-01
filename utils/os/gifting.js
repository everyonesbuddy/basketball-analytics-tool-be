/**
 * Gifting rules, as pure functions: plan gifts for a group on a budget,
 * build a one-person hamper, and work out who to gift soon.
 */
const G = require("../../config/os/gifting");

const DAY = 24 * 60 * 60 * 1000;
const money = (n) => Math.round(n * 100) / 100;
const unit = (key) => G.ITEMS[key].packPrice / G.ITEMS[key].packCount;

/**
 * Plan gifts for a group. Every recipient group gets a package; if the total
 * (with packaging and sales tax) is over budget, it trims in steps: drop the
 * optional extras, then move adults and young adults to the everyday bag,
 * then special people to the clothing package.
 *
 * @param {number} budget dollars
 * @param {{child?:number, young?:number, adult?:number, elder?:number}} counts
 * @param {number} special how many people get the special package (on top of counts)
 * @param {number} womenShare share of adults/young adults who get the women's items (0–1)
 * @param {number} suitcases checked suitcases for gifts
 */
function planGroup({ budget = 150, counts = {}, special = 0, womenShare = 0.5, suitcases = 1 } = {}) {
  const share = Math.max(0, Math.min(1, Number(womenShare) || 0));
  const groups = [
    ...G.GROUPS.map((g) => ({ key: g.key, name: g.name, count: Math.max(0, Math.floor(Number(counts[g.key]) || 0)), pkg: G.DEFAULT_PACKAGE[g.key], dropOptional: false })),
    { key: "special", name: "Special people", count: Math.max(0, Math.floor(Number(special) || 0)), pkg: "special", dropOptional: false },
  ].filter((g) => g.count > 0);
  const people = groups.reduce((s, g) => s + g.count, 0);
  if (!people) return { people: 0, packages: [], shopping: [], totals: { items: 0, packaging: 0, tax: 0, total: 0, budget: money(budget), left: money(budget) }, steps: [], cautions: [], weight: { lb: 0, suitcases: 0 } };

  const build = () => {
    const need = {};
    const packages = groups.map((g) => {
      const women = g.key === "child" ? 0 : Math.round(g.count * share);
      const men = g.count - women;
      const items = [];
      let cost = 0;
      for (const slot of G.PACKAGES[g.pkg].slots) {
        if (slot.optional && g.dropOptional) continue;
        if (slot.item) {
          need[slot.item] = (need[slot.item] || 0) + g.count;
          items.push(G.ITEMS[slot.item].name);
          cost += unit(slot.item) * g.count;
        } else {
          const { men: m, women: w } = slot.split;
          if (men) need[m] = (need[m] || 0) + men;
          if (women) need[w] = (need[w] || 0) + women;
          items.push(men && women ? `${G.ITEMS[m].name} (men) or ${G.ITEMS[w].name} (women)` : G.ITEMS[men ? m : w].name);
          cost += unit(m) * men + unit(w) * women;
        }
      }
      return { group: g.key, groupName: g.name, count: g.count, package: g.pkg, name: G.PACKAGES[g.pkg].name, target: G.PACKAGES[g.pkg].target, items, perPerson: money(cost / g.count), trimmed: g.dropOptional };
    });
    const shopping = Object.entries(need)
      .map(([key, qty]) => {
        const it = G.ITEMS[key];
        const packs = Math.ceil(qty / it.packCount);
        return { key, name: it.name, category: it.category, store: it.store, qty, packs, packCount: it.packCount, packPrice: it.packPrice, cost: money(packs * it.packPrice), spare: packs * it.packCount - qty, weightLb: it.weightLb * qty, caution: it.caution || null };
      })
      .sort((a, b) => a.store.localeCompare(b.store) || b.cost - a.cost);
    const items = shopping.reduce((s, x) => s + x.cost, 0);
    const packaging = G.PACKAGING.base + G.PACKAGING.perGift * people;
    const tax = items * G.TAX_RATE;
    const total = items + packaging + tax;
    return { packages, shopping, totals: { items: money(items), packaging: money(packaging), tax: money(tax), total: money(total), budget: money(budget), left: money(budget - total) } };
  };

  // Trim steps, cheapest change first.
  const steps = [];
  const dropExtras = (k) => () => {
    const g = groups.find((x) => x.key === k && !x.dropOptional);
    if (!g) return null;
    g.dropOptional = true;
    return `Dropped the extras for ${g.name.toLowerCase()}`;
  };
  const downgrade = (k, from) => () => {
    const g = groups.find((x) => x.key === k && x.pkg === from);
    if (!g) return null;
    g.pkg = G.FALLBACK_PACKAGE[from];
    g.dropOptional = false;
    return `${g.name} get the ${G.PACKAGES[g.pkg].name.toLowerCase()} instead`;
  };
  const trims = [
    dropExtras("elder"),
    dropExtras("adult"),
    dropExtras("young"),
    dropExtras("special"),
    downgrade("adult", "clothing"),
    downgrade("young", "clothing"),
    dropExtras("child"),
    downgrade("child", "children"),
    dropExtras("child"),
    dropExtras("adult"),
    dropExtras("young"),
    downgrade("special", "special"),
  ];
  let plan = build();
  for (const trim of trims) {
    if (plan.totals.left >= 0) break;
    const step = trim();
    if (step) {
      steps.push(step);
      plan = build();
    }
  }

  // Use what's left: add extras back where they still fit.
  if (steps.length && plan.totals.left >= 0) {
    for (const g of groups) {
      if (!g.dropOptional) continue;
      g.dropOptional = false;
      const tryPlan = build();
      if (tryPlan.totals.left >= 0) {
        plan = tryPlan;
        steps.push(`Added the extras back for ${g.name.toLowerCase()}`);
      } else g.dropOptional = true;
    }
  }

  const lb = plan.shopping.reduce((s, x) => s + x.weightLb, 0) + people * 0.05;
  const cap = Math.max(1, Number(suitcases) || 1) * G.SUITCASE_LB;
  return {
    people,
    ...plan,
    steps,
    over: plan.totals.left < 0,
    perPerson: money(plan.totals.total / people),
    weight: { lb: Math.round(lb * 10) / 10, capacityLb: cap, fits: lb <= cap },
    cautions: [...new Set(plan.shopping.map((x) => x.caution).filter(Boolean)), "Check Nigeria Customs' current prohibition list, keep receipts, and declare goods when required."],
    packaging: G.PACKAGING,
  };
}

/**
 * One person: pick the hamper that fits the relationship, then add its items
 * in order while they fit the budget (after the container, a card and tax).
 * Also returns the other hampers that fit, as alternatives.
 */
function planHamper({ relationship = "friend", budget = 50, likes = "" } = {}) {
  const keys = G.HAMPER_FOR[relationship] || G.HAMPER_FOR.friend;
  const card = 3;
  const options = keys.map((key) => {
    const h = G.HAMPERS[key];
    const spendable = budget / (1 + G.TAX_RATE) - h.container.price - card;
    const chosen = [];
    let sum = 0;
    for (const it of h.items) {
      if (sum + it.price <= spendable) {
        chosen.push(it);
        sum += it.price;
      }
    }
    const subtotal = sum + h.container.price + card;
    const total = subtotal * (1 + G.TAX_RATE);
    return {
      key,
      name: h.name,
      container: h.container,
      items: chosen,
      skipped: h.items.filter((i) => !chosen.includes(i)).map((i) => i.name),
      card: { name: "Handwritten card", price: card },
      total: money(total),
      left: money(budget - total),
    };
  });
  const tooSmall = options[0].items.length < 2;
  return {
    relationship,
    budget: money(budget),
    best: options[0],
    alternatives: options.slice(1),
    tips: [
      likes ? `Make one item about what they love: ${likes}.` : "Add one item that's only about them (a hobby, a favorite snack, a team).",
      "Line the basket or box with tissue, put the tallest item at the back, and tie it with ribbon.",
      ...(tooSmall ? [`This budget fits only ${options[0].items.length} item${options[0].items.length === 1 ? "" : "s"}; about $${Math.ceil(options[0].container.price + card + 25)} makes a fuller hamper.`] : []),
    ],
  };
}

const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/** Days until the next MM-DD on or after `today` (YYYY-MM-DD). */
function daysUntil(md, today) {
  if (!/^\d{2}-\d{2}$/.test(md || "")) return null;
  const year = Number(today.slice(0, 4));
  let next = `${year}-${md}`;
  if (next < today) next = `${year + 1}-${md}`;
  const real = (d) => {
    const t = Date.parse(`${d}T00:00:00Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
  };
  if (!real(next)) next = next.replace(/-02-29$/, "-02-28"); // Feb 29 birthdays fall on Feb 28 in common years
  if (!real(next)) return null;
  return daysBetween(today, next);
}

/**
 * Who to gift soon: dates coming up (birthdays, anniversaries), close people
 * you haven't given anything to in a while, plans with shopping or packing
 * due, and a gentle weekly nudge when nothing's been given lately.
 */
function reminders({ people = [], plans = [], today }) {
  const out = [];
  const lastGift = (p) => (p.gifts || []).map((g) => ymd(g.date)).sort().at(-1) || null;

  for (const p of people) {
    for (const d of [...(p.birthday ? [{ label: "birthday", md: p.birthday }] : []), ...(p.dates || [])]) {
      const n = daysUntil(d.md, today);
      if (n !== null && n <= 21) out.push({ kind: "date", personId: String(p._id), priority: n <= 7 ? 1 : 2, days: n, text: n === 0 ? `It's ${p.name}'s ${d.label} today.` : `${p.name}'s ${d.label} is in ${n} day${n === 1 ? "" : "s"}.` });
    }
    if (p.tier === "close") {
      const last = lastGift(p);
      const since = last ? daysBetween(last, today) : p.createdAt ? daysBetween(ymd(p.createdAt), today) : 0;
      if ((last && since >= 120) || (!last && since >= 60)) {
        out.push({ kind: "overdue", personId: String(p._id), priority: 2, days: since, text: last ? `It's been ${Math.round(since / 30)} months since you gave ${p.name} something.` : `You haven't logged a gift for ${p.name} yet.` });
      }
    }
  }

  for (const plan of plans) {
    if (plan.status === "done" || !plan.date) continue;
    const n = daysBetween(today, ymd(plan.date));
    if (n < 0) continue;
    const list = plan.checklist || [];
    const bought = list.filter((c) => c.bought).length;
    const packed = list.filter((c) => c.packed).length;
    if (n <= 7 && list.length && packed < list.length) out.push({ kind: "pack", planId: String(plan._id), priority: 1, days: n, text: `Pack for ${plan.title}: ${n} day${n === 1 ? "" : "s"} to go, ${packed} of ${list.length} packed.` });
    else if (n <= 45 && (!list.length || bought < list.length)) out.push({ kind: "shop", planId: String(plan._id), priority: n <= 21 ? 1 : 2, days: n, text: `Start shopping for ${plan.title}: ${n} days to go${list.length ? `, ${bought} of ${list.length} bought` : ""}.` });
  }

  // The nudge: nothing given in 30 days → suggest the people with the oldest (or no) last gift.
  const recent = people.some((p) => (p.gifts || []).some((g) => daysBetween(ymd(g.date), today) <= 30));
  if (people.length && !recent) {
    const pick = [...people]
      .filter((p) => p.tier !== "casual")
      .sort((a, b) => String(lastGift(a) || "").localeCompare(String(lastGift(b) || "")))
      .slice(0, 3)
      .map((p) => p.name);
    if (pick.length) out.push({ kind: "nudge", priority: 3, text: `Gift someone this week: ${pick.join(", ").replace(/, ([^,]*)$/, " or $1")}.` });
  }
  return out.sort((a, b) => a.priority - b.priority || (a.days ?? 99) - (b.days ?? 99));
}

/** The shopping list as checklist rows (one per item to buy). */
const checklistFrom = (plan) => plan.shopping.map((s) => ({ key: s.key, name: s.name, store: s.store, packs: s.packs, bought: false, packed: false }));

module.exports = { planGroup, planHamper, reminders, daysUntil, checklistFrom };
