/**
 * Gifting content, written once: an item catalog (multipack prices are
 * planning estimates from US stores in late 2026; check before buying),
 * group packages by gift level, and one-person hampers by relationship.
 */

// who: which recipients an item suits. weightLb: per single item, for suitcase planning.
// caution: a note to check before carrying it (Nigeria customs, airline rules).
const ITEMS = {
  tee_men_6: { name: "Men's crew T-shirts", category: "clothing", store: "Walmart (George)", packPrice: 19.88, packCount: 6, who: ["adult", "young"], weightLb: 0.4 },
  tee_women_3: { name: "Women's cotton T-shirts", category: "clothing", store: "Walmart", packPrice: 23.3, packCount: 3, who: ["adult", "young"], weightLb: 0.35 },
  tee_kids_3: { name: "Kids' T-shirts", category: "clothing", store: "Walmart (Wonder Nation)", packPrice: 12.98, packCount: 3, who: ["child"], weightLb: 0.25 },
  polo: { name: "Polo shirt (clearance)", category: "clothing", store: "Ross / TJ Maxx", packPrice: 9, packCount: 1, who: ["adult", "elder"], weightLb: 0.5 },
  socks_adult_12: { name: "Crew socks", category: "socks", store: "Walmart (Athletic Works)", packPrice: 9.84, packCount: 12, who: ["adult", "young", "elder"], weightLb: 0.12 },
  socks_kids_20: { name: "Kids' ankle socks", category: "socks", store: "Walmart (Hanes)", packPrice: 16.49, packCount: 20, who: ["child"], weightLb: 0.06 },
  cap: { name: "Branded baseball cap (clearance)", category: "accessories", store: "Ross / TJ Maxx", packPrice: 10, packCount: 1, who: ["young", "adult"], weightLb: 0.25 },
  lip_balm_10: { name: "Carmex lip balm", category: "personal care", store: "Sam's Club", packPrice: 8.98, packCount: 10, who: ["adult", "young", "elder"], weightLb: 0.03 },
  chapstick_12: { name: "ChapStick variety", category: "personal care", store: "Sam's Club", packPrice: 12.98, packCount: 12, who: ["adult", "young", "elder"], weightLb: 0.02 },
  hand_cream_5: { name: "Mini hand creams", category: "personal care", store: "Bath & Body Works (sale)", packPrice: 15, packCount: 5, who: ["adult", "elder"], weightLb: 0.12 },
  lotion_mini: { name: "Vaseline lotion, travel size", category: "personal care", store: "Walmart", packPrice: 1.5, packCount: 1, who: ["adult", "elder", "young"], weightLb: 0.15 },
  sanitizer_5: { name: "Scented hand sanitizers", category: "personal care", store: "Bath & Body Works (sale)", packPrice: 7, packCount: 5, who: ["young", "adult"], weightLb: 0.07 },
  mist_set: { name: "Mini fragrance mist set", category: "beauty", store: "TJ Maxx", packPrice: 15, packCount: 1, who: ["adult", "young"], weightLb: 0.6, caution: "Liquids: pack in checked bags, sealed in a zip bag." },
  cable_5: { name: "Anker USB-C cables", category: "tech", store: "Best Buy", packPrice: 18.99, packCount: 5, who: ["young", "adult"], weightLb: 0.15 },
  phone_stand_3: { name: "Folding phone stands", category: "tech", store: "Online (Newegg/Amazon)", packPrice: 18.99, packCount: 3, who: ["young", "adult", "elder"], weightLb: 0.15 },
  power_bank: { name: "Compact power bank (reputable brand)", category: "tech", store: "Walmart / Best Buy", packPrice: 18, packCount: 1, who: ["adult", "young"], weightLb: 0.45, caution: "Power banks must go in carry-on, never checked bags." },
  toy_cars_8: { name: "Hot Wheels cars", category: "kids", store: "Target", packPrice: 9.79, packCount: 8, who: ["child"], weightLb: 0.05 },
  fidget_30: { name: "Pop-fidget keychains", category: "kids", store: "Target", packPrice: 9.99, packCount: 30, who: ["child", "young"], weightLb: 0.02, caution: "Not for children under 4 (small parts)." },
  wallet: { name: "Wallet (clearance)", category: "accessories", store: "Ross / TJ Maxx", packPrice: 12, packCount: 1, who: ["adult", "elder"], weightLb: 0.2 },
  cosmetic_bag: { name: "Cosmetic pouch", category: "accessories", store: "TJ Maxx / Ross", packPrice: 6, packCount: 1, who: ["adult", "young"], weightLb: 0.2 },
  scarf: { name: "Soft scarf or wrap", category: "accessories", store: "TJ Maxx / Ross", packPrice: 12, packCount: 1, who: ["adult", "elder"], weightLb: 0.3 },
  chocolate_220: { name: "Hershey's minis (220 pieces)", category: "treats", store: "Walmart", packPrice: 18, packCount: 40, who: ["child", "young", "adult"], weightLb: 0.1, caution: "Food: check Nigeria's current import rules before packing a lot." },
};

// Packaging, shared across a whole group plan.
const PACKAGING = {
  theme: "Brown kraft bags, white tissue paper, black or gold ribbon, small white tags with names.",
  note: "A little something from America, with love.",
  base: 6, // ribbon, tags, tissue for the whole batch
  perGift: 0.35, // one kraft bag each
};

const TAX_RATE = 0.08; // sales tax allowance
const SUITCASE_LB = 45; // usable gift weight per checked suitcase

// Recipient groups for a group plan.
const GROUPS = [
  { key: "child", name: "Children" },
  { key: "young", name: "Young adults" },
  { key: "adult", name: "Adults" },
  { key: "elder", name: "Older relatives" },
];

/**
 * Group packages. Each slot is one item, or a men/women split. `optional`
 * slots are the first dropped when the budget is tight.
 */
const PACKAGES = {
  children: { name: "Children's package", target: "$4–7", slots: [{ item: "tee_kids_3" }, { item: "toy_cars_8" }, { item: "socks_kids_20", optional: true }, { item: "fidget_30", optional: true }] },
  clothing: { name: "Clothing package", target: "$6–10", slots: [{ split: { men: "tee_men_6", women: "tee_women_3" } }, { item: "socks_adult_12" }, { item: "lip_balm_10", optional: true }, { split: { men: "cable_5", women: "sanitizer_5" }, optional: true }] },
  kids_small: { name: "Kids' small bag", target: "$2–4", slots: [{ item: "toy_cars_8" }, { item: "socks_kids_20" }, { item: "fidget_30", optional: true }] },
  everyday: { name: "Everyday gift bag", target: "$3–6", slots: [{ item: "socks_adult_12" }, { item: "lip_balm_10" }, { item: "lotion_mini", optional: true }] },
  special: { name: "Special person package", target: "$12–20", slots: [{ split: { men: "polo", women: "scarf" } }, { item: "socks_adult_12" }, { split: { men: "lip_balm_10", women: "hand_cream_5" } }, { split: { men: "cap", women: "cosmetic_bag" }, optional: true }] },
};

// Which package each group gets by default, and the cheaper one to fall back to.
const DEFAULT_PACKAGE = { child: "children", young: "clothing", adult: "clothing", elder: "everyday" };
const FALLBACK_PACKAGE = { clothing: "everyday", children: "kids_small", special: "clothing" };

/** One-person hampers. Items are chosen in order until the budget runs out. */
const RELATIONSHIPS = [
  { key: "wife", name: "Wife or partner" },
  { key: "mother", name: "Mother" },
  { key: "mother_in_law", name: "Mother-in-law" },
  { key: "father", name: "Dad" },
  { key: "father_in_law", name: "Father-in-law" },
  { key: "sibling", name: "Brother or sister" },
  { key: "friend", name: "Friend" },
  { key: "child", name: "Child" },
  { key: "colleague", name: "Colleague or host" },
];

// price: typical single-item price. A hamper always includes the container and a card.
const HAMPERS = {
  self_care: {
    name: "Self-care evening",
    container: { name: "Woven basket", price: 8 },
    items: [
      { name: "Body lotion and wash set", price: 15 },
      { name: "Plush slippers or socks", price: 10 },
      { name: "Fragrance mist", price: 12 },
      { name: "Box of chocolates", price: 8 },
      { name: "Soft robe or wrap", price: 25 },
      { name: "Silk scrunchies or sleep mask", price: 8 },
    ],
  },
  comfort_care: {
    name: "Comfort and care",
    container: { name: "Lidded gift box", price: 6 },
    items: [
      { name: "Soft scarf or wrap", price: 12 },
      { name: "Rich hand cream", price: 8 },
      { name: "Good socks", price: 6 },
      { name: "Cosmetic pouch", price: 6 },
      { name: "Tea or coffee sampler", price: 10 },
      { name: "Reading glasses case or small photo frame", price: 10 },
    ],
  },
  grooming_gadget: {
    name: "Grooming and gadget",
    container: { name: "Sturdy gift box", price: 6 },
    items: [
      { name: "Grooming kit (beard oil, comb, balm)", price: 15 },
      { name: "Polo shirt", price: 12 },
      { name: "Compact power bank", price: 18 },
      { name: "Good socks", price: 6 },
      { name: "Cologne mini", price: 12 },
      { name: "Leather wallet", price: 15 },
    ],
  },
  fun_box: {
    name: "Fun box",
    container: { name: "Bright gift bag", price: 3 },
    items: [
      { name: "Kids' T-shirt", price: 5 },
      { name: "Toy cars or a small toy", price: 5 },
      { name: "Coloring book and crayons", price: 5 },
      { name: "Fun socks", price: 3 },
      { name: "Treats (if allowed)", price: 4 },
    ],
  },
  thank_you: {
    name: "Thank-you box",
    container: { name: "Kraft gift box", price: 4 },
    items: [
      { name: "Nice candle or room spray", price: 10 },
      { name: "Gourmet snacks", price: 8 },
      { name: "Hand cream or lip balm set", price: 8 },
      { name: "Notebook and pen", price: 8 },
      { name: "Mug or tumbler", price: 12 },
    ],
  },
};

// Which hampers fit each relationship, best first.
const HAMPER_FOR = {
  wife: ["self_care"],
  mother: ["comfort_care", "self_care"],
  mother_in_law: ["comfort_care", "self_care"],
  father: ["grooming_gadget"],
  father_in_law: ["grooming_gadget"],
  sibling: ["thank_you", "grooming_gadget", "self_care"],
  friend: ["thank_you", "grooming_gadget", "self_care"],
  child: ["fun_box"],
  colleague: ["thank_you"],
};

module.exports = { HAMPER_FOR, ITEMS, PACKAGING, TAX_RATE, SUITCASE_LB, GROUPS, PACKAGES, DEFAULT_PACKAGE, FALLBACK_PACKAGE, RELATIONSHIPS, HAMPERS };
