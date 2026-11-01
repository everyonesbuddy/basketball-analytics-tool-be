/**
 * Gifting content, written once: an item catalog (multipack prices are
 * planning estimates from US stores in late 2026; check before buying),
 * group packages by gift level, and one-person hampers by relationship.
 */

// who: which recipients an item suits. weightLb: per single item, for suitcase planning.
// caution: a note to check before carrying it (Nigeria customs, airline rules).
const ITEMS = {
  tee_men_6: { name: "Men's crew T-shirts", search: "men's crew neck t-shirt outfit", category: "clothing", store: "Walmart (George)", packPrice: 19.88, packCount: 6, who: ["adult", "young"], weightLb: 0.4 },
  tee_women_3: { name: "Women's cotton T-shirts", search: "women's basic cotton tee outfit", category: "clothing", store: "Walmart", packPrice: 23.3, packCount: 3, who: ["adult", "young"], weightLb: 0.35 },
  tee_kids_3: { name: "Kids' T-shirts", search: "kids graphic t-shirt", category: "clothing", store: "Walmart (Wonder Nation)", packPrice: 12.98, packCount: 3, who: ["child"], weightLb: 0.25 },
  polo: { name: "Polo shirt (clearance)", search: "men's polo shirt outfit", category: "clothing", store: "Ross / TJ Maxx", packPrice: 9, packCount: 1, who: ["adult", "elder"], weightLb: 0.5 },
  socks_adult_12: { name: "Crew socks", search: "crew socks gift bundle", category: "socks", store: "Walmart (Athletic Works)", packPrice: 9.84, packCount: 12, who: ["adult", "young", "elder"], weightLb: 0.12 },
  socks_kids_20: { name: "Kids' ankle socks", search: "kids fun socks", category: "socks", store: "Walmart (Hanes)", packPrice: 16.49, packCount: 20, who: ["child"], weightLb: 0.06 },
  cap: { name: "Branded baseball cap (clearance)", search: "baseball cap streetwear", category: "accessories", store: "Ross / TJ Maxx", packPrice: 10, packCount: 1, who: ["young", "adult"], weightLb: 0.25 },
  lip_balm_10: { name: "Carmex lip balm", search: "lip balm gift idea", category: "personal care", store: "Sam's Club", packPrice: 8.98, packCount: 10, who: ["adult", "young", "elder"], weightLb: 0.03 },
  chapstick_12: { name: "ChapStick variety", search: "lip balm gift idea", category: "personal care", store: "Sam's Club", packPrice: 12.98, packCount: 12, who: ["adult", "young", "elder"], weightLb: 0.02 },
  hand_cream_5: { name: "Mini hand creams", search: "mini hand cream gift set", category: "personal care", store: "Bath & Body Works (sale)", packPrice: 15, packCount: 5, who: ["adult", "elder"], weightLb: 0.12 },
  lotion_mini: { name: "Vaseline lotion, travel size", search: "travel size lotion gift", category: "personal care", store: "Walmart", packPrice: 1.5, packCount: 1, who: ["adult", "elder", "young"], weightLb: 0.15 },
  sanitizer_5: { name: "Scented hand sanitizers", search: "bath and body works hand sanitizer gift", category: "personal care", store: "Bath & Body Works (sale)", packPrice: 7, packCount: 5, who: ["young", "adult"], weightLb: 0.07 },
  mist_set: { name: "Mini fragrance mist set", search: "fragrance mist gift set", category: "beauty", store: "TJ Maxx", packPrice: 15, packCount: 1, who: ["adult", "young"], weightLb: 0.6, caution: "Liquids: pack in checked bags, sealed in a zip bag." },
  cable_5: { name: "Anker USB-C cables", search: "usb c cable organizer gift", category: "tech", store: "Best Buy", packPrice: 18.99, packCount: 5, who: ["young", "adult"], weightLb: 0.15 },
  phone_stand_3: { name: "Folding phone stands", search: "phone stand gift", category: "tech", store: "Online (Newegg/Amazon)", packPrice: 18.99, packCount: 3, who: ["young", "adult", "elder"], weightLb: 0.15 },
  power_bank: { name: "Compact power bank (reputable brand)", search: "power bank gift for men", category: "tech", store: "Walmart / Best Buy", packPrice: 18, packCount: 1, who: ["adult", "young"], weightLb: 0.45, caution: "Power banks must go in carry-on, never checked bags." },
  toy_cars_8: { name: "Hot Wheels cars", search: "hot wheels gift for kids", category: "kids", store: "Target", packPrice: 9.79, packCount: 8, who: ["child"], weightLb: 0.05 },
  fidget_30: { name: "Pop-fidget keychains", search: "pop fidget keychain party favor", category: "kids", store: "Target", packPrice: 9.99, packCount: 30, who: ["child", "young"], weightLb: 0.02, caution: "Not for children under 4 (small parts)." },
  wallet: { name: "Wallet (clearance)", search: "men's leather wallet gift", category: "accessories", store: "Ross / TJ Maxx", packPrice: 12, packCount: 1, who: ["adult", "elder"], weightLb: 0.2 },
  cosmetic_bag: { name: "Cosmetic pouch", search: "cosmetic pouch gift", category: "accessories", store: "TJ Maxx / Ross", packPrice: 6, packCount: 1, who: ["adult", "young"], weightLb: 0.2 },
  scarf: { name: "Soft scarf or wrap", search: "pashmina scarf gift for mom", category: "accessories", store: "TJ Maxx / Ross", packPrice: 12, packCount: 1, who: ["adult", "elder"], weightLb: 0.3 },
  chocolate_220: { name: "Hershey's minis (220 pieces)", search: "chocolate gift bag treats", category: "treats", store: "Walmart", packPrice: 18, packCount: 40, who: ["child", "young", "adult"], weightLb: 0.1, caution: "Food: check Nigeria's current import rules before packing a lot." },
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
  children: { name: "Children's package", search: "kids christmas gift bag ideas", target: "$4–7", slots: [{ item: "tee_kids_3" }, { item: "toy_cars_8" }, { item: "socks_kids_20", optional: true }, { item: "fidget_30", optional: true }] },
  clothing: { name: "Clothing package", search: "t-shirt and socks gift bundle", target: "$6–10", slots: [{ split: { men: "tee_men_6", women: "tee_women_3" } }, { item: "socks_adult_12" }, { item: "lip_balm_10", optional: true }, { split: { men: "cable_5", women: "sanitizer_5" }, optional: true }] },
  kids_small: { name: "Kids' small bag", search: "kids party favor bag ideas", target: "$2–4", slots: [{ item: "toy_cars_8" }, { item: "socks_kids_20" }, { item: "fidget_30", optional: true }] },
  everyday: { name: "Everyday gift bag", search: "small practical gift bag ideas", target: "$3–6", slots: [{ item: "socks_adult_12" }, { item: "lip_balm_10" }, { item: "lotion_mini", optional: true }] },
  special: { name: "Special person package", search: "gift box for parents", target: "$12–20", slots: [{ split: { men: "polo", women: "scarf" } }, { item: "socks_adult_12" }, { split: { men: "lip_balm_10", women: "hand_cream_5" } }, { split: { men: "cap", women: "cosmetic_bag" }, optional: true }] },
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
    search: "self care gift basket for her",
    container: { name: "Woven basket", price: 8, search: "woven gift basket" },
    items: [
      { name: "Body lotion and wash set", price: 15, search: "body lotion gift set" },
      { name: "Plush slippers or socks", price: 10, search: "plush slippers gift" },
      { name: "Fragrance mist", price: 12, search: "fragrance mist gift" },
      { name: "Box of chocolates", price: 8, search: "luxury chocolate box" },
      { name: "Soft robe or wrap", price: 25, search: "soft robe gift for her" },
      { name: "Silk scrunchies or sleep mask", price: 8, search: "silk sleep mask scrunchie set" },
    ],
  },
  comfort_care: {
    name: "Comfort and care",
    search: "comfort gift box for mom",
    container: { name: "Lidded gift box", price: 6, search: "lidded gift box" },
    items: [
      { name: "Soft scarf or wrap", price: 12, search: "soft scarf wrap gift for mom" },
      { name: "Rich hand cream", price: 8, search: "luxury hand cream gift" },
      { name: "Good socks", price: 6, search: "cozy socks gift" },
      { name: "Cosmetic pouch", price: 6, search: "cosmetic pouch gift" },
      { name: "Tea or coffee sampler", price: 10, search: "tea sampler gift box" },
      { name: "Reading glasses case or small photo frame", price: 10, search: "small photo frame gift" },
    ],
  },
  grooming_gadget: {
    name: "Grooming and gadget",
    search: "grooming gift box for dad",
    container: { name: "Sturdy gift box", price: 6, search: "men's gift box" },
    items: [
      { name: "Grooming kit (beard oil, comb, balm)", price: 15, search: "beard grooming kit gift" },
      { name: "Polo shirt", price: 12, search: "men's polo shirt outfit" },
      { name: "Compact power bank", price: 18, search: "power bank gift" },
      { name: "Good socks", price: 6, search: "cozy socks gift" },
      { name: "Cologne mini", price: 12, search: "men's cologne gift set" },
      { name: "Leather wallet", price: 15, search: "men's leather wallet gift" },
    ],
  },
  fun_box: {
    name: "Fun box",
    search: "kids gift box ideas",
    container: { name: "Bright gift bag", price: 3, search: "colorful kids gift bag" },
    items: [
      { name: "Kids' T-shirt", price: 5, search: "kids graphic t-shirt" },
      { name: "Toy cars or a small toy", price: 5, search: "small toy gift for kids" },
      { name: "Coloring book and crayons", price: 5, search: "coloring book gift set" },
      { name: "Fun socks", price: 3, search: "kids fun socks" },
      { name: "Treats (if allowed)", price: 4, search: "kids treat bag" },
    ],
  },
  thank_you: {
    name: "Thank-you box",
    search: "thank you gift box ideas",
    container: { name: "Kraft gift box", price: 4, search: "kraft gift box" },
    items: [
      { name: "Nice candle or room spray", price: 10, search: "candle gift idea" },
      { name: "Gourmet snacks", price: 8, search: "gourmet snack gift box" },
      { name: "Hand cream or lip balm set", price: 8, search: "hand cream lip balm gift set" },
      { name: "Notebook and pen", price: 8, search: "notebook and pen gift set" },
      { name: "Mug or tumbler", price: 12, search: "tumbler gift idea" },
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

/**
 * Services and experiences: for the people a "thing" isn't the best gift.
 * price is a typical starting amount in US dollars. where: "us", "ng"
 * (back home in Nigeria) or "any". Planning ranges; check locally.
 */
const SERVICES = [
  { key: "spa", name: "Spa day or massage", price: 80, for: ["wife", "mother", "mother_in_law", "sibling", "friend"], where: "any", search: "spa day gift card idea", how: "Book a time with them, or give a gift card with a handwritten note." },
  { key: "salon", name: "Hair or nails appointment", price: 40, for: ["wife", "mother", "mother_in_law", "sibling", "friend"], where: "any", search: "salon gift card idea", how: "In Nigeria, a home-service stylist is a thoughtful touch for an older relative." },
  { key: "dinner", name: "Dinner out, booked and paid", price: 60, for: ["wife", "mother", "mother_in_law", "father", "father_in_law", "sibling", "friend"], where: "any", search: "date night dinner gift idea", how: "Reserve the table and settle the bill ahead so they just show up." },
  { key: "cleaning", name: "A house cleaning", price: 100, for: ["wife", "mother", "mother_in_law", "father", "father_in_law"], where: "any", search: "house cleaning gift certificate", how: "One deep clean, or a monthly one for a season." },
  { key: "meals", name: "A week of meals", price: 60, for: ["mother", "mother_in_law", "father", "father_in_law", "sibling", "friend"], where: "any", search: "meal delivery gift", how: "Meal delivery in the US; a cook for a week back home." },
  { key: "class", name: "A class together (cooking, pottery, painting)", price: 50, for: ["wife", "sibling", "friend", "child"], where: "us", search: "pottery class date gift", how: "The time together is the gift; book two spots." },
  { key: "photoshoot", name: "Family photo shoot", price: 120, for: ["wife", "mother", "mother_in_law", "father", "father_in_law"], where: "any", search: "family photoshoot gift", how: "Print one framed photo from it as the reveal." },
  { key: "car_detail", name: "Car detailing", price: 80, for: ["father", "father_in_law", "sibling", "friend", "wife"], where: "us", search: "car detailing gift card", how: "Pair it with a car air freshener in the card." },
  { key: "tickets", name: "Tickets to a game or concert", price: 70, for: ["wife", "father", "father_in_law", "sibling", "friend", "child"], where: "us", search: "concert tickets gift reveal", how: "Wrap the printed tickets with something from the team or artist." },
  { key: "streaming", name: "Streaming or TV subscription (6 months)", price: 40, for: ["mother", "mother_in_law", "father", "father_in_law", "sibling", "friend"], where: "any", search: "subscription gift card idea", how: "In Nigeria, a DStv or GOtv renewal is a welcome one." },
  { key: "airtime", name: "Airtime and data top-up", price: 15, for: ["mother", "mother_in_law", "father", "father_in_law", "sibling", "friend", "colleague"], where: "ng", search: "phone data gift", how: "Send it on the day with a message; easy to do from the US." },
  { key: "tailor", name: "Tailored outfit (fabric plus sewing)", price: 50, for: ["wife", "mother", "mother_in_law", "father", "father_in_law", "sibling"], where: "ng", search: "ankara outfit styles", how: "Pay a trusted tailor for fabric and sewing; let them pick the style." },
  { key: "ride", name: "Driver for a day of errands", price: 30, for: ["mother", "mother_in_law", "father", "father_in_law"], where: "ng", search: "chauffeur service gift", how: "Arrange a trusted driver for market and visiting day." },
];

module.exports = { SERVICES, HAMPER_FOR, ITEMS, PACKAGING, TAX_RATE, SUITCASE_LB, GROUPS, PACKAGES, DEFAULT_PACKAGE, FALLBACK_PACKAGE, RELATIONSHIPS, HAMPERS };
