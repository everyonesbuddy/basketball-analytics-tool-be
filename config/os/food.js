/**
 * The meal library: written once, no bread and little to no sugar by design.
 * Each meal: cuisine, which meals it suits, minutes to cook, cook/order,
 * sugar ("none", or "low" for a little in a sauce), ingredients by grocery
 * aisle, a Pinterest recipe search, and what to search for when ordering.
 * `batch`: makes enough for leftovers (lunch tomorrow, or freeze).
 * `tortilla`: uses corn tortillas (hidden if tortillas count as bread).
 * Shellfish-free: crayfish is swapped for smoked fish powder, oyster sauce for
 * a mushroom sauce; fish (salmon, tilapia, catfish) is fine.
 */

// Words that mean shellfish (crustaceans and mollusks), for the allergy filter.
const SHELLFISH = ["shrimp", "prawn", "crab", "lobster", "crayfish", "crawfish", "langoustine", "scallop", "clam", "mussel", "oyster", "periwinkle", "isam", "snail", "escargot", "squid", "calamari", "octopus", "cockle", "whelk", "abalone", "seafood boil", "shrimp paste"];

const CUISINES = ["Nigerian", "American", "Mexican", "Greek", "Asian", "Indian", "Caribbean", "Middle Eastern", "Italian"];

// Grocery aisles, in the order a list is shopped.
const AISLES = [
  { key: "produce", name: "Produce" },
  { key: "protein", name: "Meat & fish" },
  { key: "dairy", name: "Dairy & eggs" },
  { key: "pantry", name: "Pantry" },
  { key: "intl", name: "African / Asian / Latin aisle or store" },
  { key: "frozen", name: "Frozen" },
  { key: "spices", name: "Spices & sauces" },
];

// Staples most kitchens have; listed separately as "check you have".
const STAPLES = new Set(["salt", "black pepper", "vegetable oil", "olive oil", "onions", "garlic", "rice", "eggs", "butter"]);

const m = (key, name, cuisine, slots, mins, mode, ing, search, extra = {}) => ({ key, name, cuisine, slots, mins, mode, ing, search, sugar: "none", ...extra });
const B = ["breakfast"];
const LD = ["lunch", "dinner"];

const MEALS = [
  // ── Breakfast ──
  m("akara_pap", "Akara & Eggs", "Nigerian", B, 40, "both", [["black-eyed peas", "pantry"], ["scotch bonnet peppers", "produce"], ["onions", "produce"], ["vegetable oil", "pantry"], ["salt", "spices"]], "nigerian akara recipe", { order: "akara", note: "Skip the bread; unsweetened pap works too.", orderNote: "Ask for no bread." }),
  m("yam_egg", "Yam & Egg Sauce", "Nigerian", B, 30, "cook", [["puna yam", "intl"], ["eggs", "dairy"], ["tomatoes", "produce"], ["onions", "produce"], ["scotch bonnet peppers", "produce"]], "nigerian yam and egg sauce"),
  m("dodo_eggs", "Dodo & Eggs", "Nigerian", B, 20, "cook", [["ripe plantains", "produce"], ["eggs", "dairy"], ["bell peppers", "produce"], ["onions", "produce"]], "plantain and egg breakfast nigerian"),
  m("moimoi", "Moi Moi", "Nigerian", [...B, "lunch"], 75, "both", [["black-eyed peas", "pantry"], ["red bell peppers", "produce"], ["scotch bonnet peppers", "produce"], ["eggs", "dairy"], ["smoked fish powder (not crayfish)", "intl"], ["vegetable oil", "pantry"]], "nigerian moi moi recipe", { batch: true, order: "moi moi" }),
  m("omelet_veg", "Veggie Omelet & Avocado", "American", B, 15, "cook", [["eggs", "dairy"], ["spinach", "produce"], ["bell peppers", "produce"], ["avocado", "produce"], ["cheddar", "dairy"]], "veggie omelet avocado"),
  m("steak_eggs", "Steak & Eggs", "American", B, 30, "both", [["sirloin steak", "protein"], ["eggs", "dairy"], ["potatoes", "produce"]], "steak and eggs breakfast potatoes", { order: "steak and eggs breakfast" }),
  m("yogurt_bowl", "Greek Yogurt Berry Bowl", "Greek", B, 5, "cook", [["plain greek yogurt", "dairy"], ["berries", "produce"], ["walnuts", "pantry"], ["chia seeds", "pantry"]], "greek yogurt bowl berries nuts no sugar"),
  m("shakshuka", "Shakshuka", "Middle Eastern", B, 30, "cook", [["eggs", "dairy"], ["canned tomatoes", "pantry"], ["bell peppers", "produce"], ["onions", "produce"], ["feta", "dairy"], ["cumin", "spices"]], "shakshuka recipe"),
  m("chilaquiles", "Chilaquiles Verdes", "Mexican", B, 25, "both", [["corn tortillas", "pantry"], ["salsa verde", "spices"], ["eggs", "dairy"], ["queso fresco", "dairy"], ["avocado", "produce"]], "chilaquiles verdes recipe", { tortilla: true, order: "chilaquiles" }),
  m("breakfast_bowl", "Breakfast Burrito Bowl", "Mexican", B, 20, "cook", [["eggs", "dairy"], ["black beans", "pantry"], ["potatoes", "produce"], ["salsa", "spices"], ["avocado", "produce"], ["cheddar", "dairy"]], "breakfast burrito bowl no tortilla"),
  m("congee", "Chicken Congee", "Asian", B, 60, "both", [["rice", "pantry"], ["chicken thighs", "protein"], ["ginger", "produce"], ["green onions", "produce"], ["soy sauce", "spices"]], "chicken congee recipe", { order: "congee" }),
  m("savory_oats", "Savory Oats", "American", B, 15, "cook", [["rolled oats", "pantry"], ["eggs", "dairy"], ["spinach", "produce"], ["parmesan", "dairy"]], "savory oatmeal egg"),
  m("japanese_bfast", "Salmon, Rice & Miso", "Asian", B, 25, "cook", [["salmon fillets", "protein"], ["rice", "pantry"], ["miso paste", "intl"], ["tofu", "protein"], ["green onions", "produce"]], "japanese breakfast salmon miso"),

  // ── Nigerian ──
  m("jollof_chicken", "Jollof Rice & Chicken", "Nigerian", LD, 75, "both", [["long grain parboiled rice", "pantry"], ["chicken drumsticks", "protein"], ["tomatoes", "produce"], ["red bell peppers", "produce"], ["scotch bonnet peppers", "produce"], ["tomato paste", "pantry"], ["onions", "produce"], ["curry powder", "spices"], ["thyme", "spices"], ["bay leaves", "spices"], ["chicken bouillon", "spices"]], "nigerian jollof rice chicken recipe", { batch: true, order: "nigerian jollof rice", note: "Make a big pot: it covers tomorrow's lunch." }),
  m("fried_rice_ng", "Nigerian Fried Rice", "Nigerian", LD, 60, "both", [["long grain parboiled rice", "pantry"], ["chicken thighs", "protein"], ["mixed vegetables", "frozen"], ["liver", "protein"], ["curry powder", "spices"], ["thyme", "spices"]], "nigerian fried rice recipe", { batch: true, order: "nigerian fried rice" }),
  m("egusi", "Egusi Soup", "Nigerian", LD, 90, "both", [["ground egusi", "intl"], ["spinach", "produce"], ["goat meat", "protein"], ["stockfish", "intl"], ["smoked fish powder (not crayfish)", "intl"], ["palm oil", "intl"], ["scotch bonnet peppers", "produce"], ["pounded yam flour", "intl"]], "nigerian egusi soup recipe", { batch: true, order: "egusi soup", note: "Freezes well: cook once, eat three times." }),
  m("efo_riro", "Efo Riro", "Nigerian", LD, 60, "both", [["spinach", "produce"], ["beef", "protein"], ["smoked fish", "intl"], ["iru (locust beans)", "intl"], ["red bell peppers", "produce"], ["palm oil", "intl"], ["smoked fish powder (not crayfish)", "intl"]], "efo riro recipe", { batch: true, order: "efo riro" }),
  m("ofada_ayamase", "Ofada Rice & Ayamase", "Nigerian", LD, 90, "both", [["ofada rice", "intl"], ["green bell peppers", "produce"], ["scotch bonnet peppers", "produce"], ["assorted meat", "protein"], ["eggs", "dairy"], ["iru (locust beans)", "intl"], ["palm oil", "intl"]], "ofada rice ayamase recipe", { batch: true, order: "ofada rice ayamase" }),
  m("pepper_soup", "Goat Pepper Soup", "Nigerian", LD, 60, "both", [["goat meat", "protein"], ["pepper soup spice", "intl"], ["scotch bonnet peppers", "produce"], ["scent leaves or basil", "produce"], ["potatoes", "produce"]], "goat meat pepper soup recipe", { order: "pepper soup" }),
  m("ewa_dodo", "Ewa Riro & Dodo", "Nigerian", LD, 75, "cook", [["honey beans", "intl"], ["ripe plantains", "produce"], ["palm oil", "intl"], ["red bell peppers", "produce"], ["smoked fish powder (not crayfish)", "intl"], ["onions", "produce"]], "ewa riro beans and plantain", { batch: true }),
  m("asaro", "Asaro (Yam Porridge)", "Nigerian", LD, 50, "cook", [["puna yam", "intl"], ["palm oil", "intl"], ["red bell peppers", "produce"], ["smoked fish", "intl"], ["spinach", "produce"], ["smoked fish powder (not crayfish)", "intl"]], "asaro yam porridge recipe", { batch: true }),
  m("suya_salad", "Beef Suya Plate", "Nigerian", LD, 30, "both", [["flank steak", "protein"], ["suya spice (yaji)", "intl"], ["red onions", "produce"], ["tomatoes", "produce"], ["cucumbers", "produce"]], "beef suya recipe", { order: "suya" }),
  m("okra_soup", "Okra Soup", "Nigerian", LD, 50, "both", [["okra", "produce"], ["beef", "protein"], ["smoked fish", "intl"], ["palm oil", "intl"], ["smoked fish powder (not crayfish)", "intl"], ["spinach", "produce"], ["garri", "intl"]], "nigerian okra soup recipe", { batch: true, order: "okra soup" }),

  // ── American ──
  m("sheet_pan_chicken", "Sheet-Pan Chicken & Veg", "American", LD, 40, "cook", [["chicken thighs", "protein"], ["broccoli", "produce"], ["sweet potatoes", "produce"], ["red onions", "produce"], ["paprika", "spices"], ["garlic powder", "spices"]], "sheet pan chicken and vegetables"),
  m("steak_potatoes", "Steak & Roasted Potatoes", "American", LD, 35, "both", [["ribeye or sirloin steak", "protein"], ["baby potatoes", "produce"], ["mixed greens", "produce"], ["cherry tomatoes", "produce"]], "steak and roasted potatoes dinner", { order: "steakhouse" }),
  m("burger_bowl", "Burger Bowl", "American", LD, 25, "both", [["ground beef", "protein"], ["romaine", "produce"], ["tomatoes", "produce"], ["pickles", "pantry"], ["cheddar", "dairy"], ["red onions", "produce"]], "burger bowl no bun", { order: "burger lettuce wrap", note: "Ordering: ask for a lettuce wrap, no bun." }),
  m("chili", "Beef & Bean Chili", "American", LD, 60, "cook", [["ground beef", "protein"], ["kidney beans", "pantry"], ["canned tomatoes", "pantry"], ["bell peppers", "produce"], ["chili powder", "spices"], ["cumin", "spices"]], "beef chili recipe", { batch: true }),
  m("salmon_asparagus", "Garlic Butter Salmon", "American", LD, 25, "cook", [["salmon fillets", "protein"], ["asparagus", "produce"], ["lemons", "produce"], ["butter", "dairy"], ["rice", "pantry"]], "garlic butter salmon asparagus"),
  m("cobb_salad", "Cobb Salad", "American", ["lunch"], 20, "both", [["chicken breast", "protein"], ["bacon", "protein"], ["eggs", "dairy"], ["avocado", "produce"], ["romaine", "produce"], ["blue cheese", "dairy"]], "cobb salad recipe", { order: "cobb salad" }),
  m("catfish_grits", "Blackened Catfish & Grits", "American", LD, 35, "both", [["catfish fillets", "protein"], ["stone-ground grits", "pantry"], ["cheddar", "dairy"], ["cajun seasoning", "spices"], ["green onions", "produce"]], "blackened catfish and grits", { order: "blackened catfish" }),
  m("bbq_dry_rub", "Dry-Rub Wings & Slaw", "American", LD, 50, "both", [["chicken wings", "protein"], ["cabbage", "produce"], ["carrots", "produce"], ["paprika", "spices"], ["mayonnaise", "pantry"]], "dry rub chicken wings oven", { order: "dry rub wings", note: "Ordering: dry rub or buffalo, not honey BBQ." }),

  // ── Mexican ──
  m("fajita_bowl", "Chicken Fajita Bowl", "Mexican", LD, 30, "both", [["chicken breast", "protein"], ["bell peppers", "produce"], ["onions", "produce"], ["rice", "pantry"], ["black beans", "pantry"], ["avocado", "produce"], ["fajita seasoning", "spices"]], "chicken fajita bowl recipe", { order: "chicken fajitas" }),
  m("carne_asada_tacos", "Carne Asada Tacos", "Mexican", LD, 35, "both", [["flank steak", "protein"], ["corn tortillas", "pantry"], ["limes", "produce"], ["cilantro", "produce"], ["white onions", "produce"], ["salsa", "spices"]], "carne asada tacos recipe", { tortilla: true, order: "carne asada tacos" }),
  m("burrito_bowl", "Burrito Bowl", "Mexican", LD, 30, "both", [["ground beef or chicken", "protein"], ["rice", "pantry"], ["pinto beans", "pantry"], ["corn", "frozen"], ["salsa", "spices"], ["sour cream", "dairy"], ["romaine", "produce"]], "burrito bowl recipe", { order: "burrito bowl" }),
  m("pozole", "Pozole Rojo", "Mexican", LD, 90, "both", [["pork shoulder", "protein"], ["hominy", "pantry"], ["guajillo chiles", "intl"], ["cabbage", "produce"], ["radishes", "produce"], ["limes", "produce"]], "pozole rojo recipe", { batch: true, order: "pozole" }),
  m("fish_tacos", "Tilapia Fish Tacos", "Mexican", LD, 25, "both", [["tilapia fillets", "protein"], ["corn tortillas", "pantry"], ["cabbage", "produce"], ["limes", "produce"], ["chipotle in adobo", "intl"], ["sour cream", "dairy"]], "tilapia fish tacos cabbage slaw", { tortilla: true, order: "fish tacos" }),
  m("tortilla_soup", "Chicken Tortilla Soup", "Mexican", LD, 40, "cook", [["chicken thighs", "protein"], ["canned tomatoes", "pantry"], ["black beans", "pantry"], ["corn tortillas", "pantry"], ["avocado", "produce"], ["cumin", "spices"]], "chicken tortilla soup recipe", { tortilla: true, batch: true }),

  // ── Greek / Mediterranean ──
  m("souvlaki_plate", "Chicken Souvlaki Plate", "Greek", LD, 40, "both", [["chicken breast", "protein"], ["lemons", "produce"], ["oregano", "spices"], ["cucumbers", "produce"], ["plain greek yogurt", "dairy"], ["tomatoes", "produce"], ["rice", "pantry"]], "chicken souvlaki plate", { order: "chicken souvlaki plate", note: "Ordering: plate, not pita." }),
  m("greek_salad_salmon", "Greek Salad & Salmon", "Greek", LD, 20, "both", [["salmon fillets", "protein"], ["cucumbers", "produce"], ["tomatoes", "produce"], ["feta", "dairy"], ["kalamata olives", "pantry"], ["red onions", "produce"]], "greek salad grilled salmon", { order: "greek salad with salmon" }),
  m("kofta_rice", "Lamb Kofta & Rice", "Greek", LD, 35, "both", [["ground lamb", "protein"], ["parsley", "produce"], ["plain greek yogurt", "dairy"], ["cucumbers", "produce"], ["rice", "pantry"], ["cumin", "spices"]], "lamb kofta recipe", { order: "lamb kofta plate" }),
  m("avgolemono", "Lemon Chicken Soup", "Greek", LD, 45, "cook", [["chicken breast", "protein"], ["rice", "pantry"], ["lemons", "produce"], ["eggs", "dairy"], ["chicken broth", "pantry"]], "avgolemono soup recipe", { batch: true }),
  m("moussaka", "Moussaka", "Greek", ["dinner"], 120, "cook", [["eggplants", "produce"], ["ground lamb or beef", "protein"], ["potatoes", "produce"], ["canned tomatoes", "pantry"], ["milk", "dairy"], ["parmesan", "dairy"], ["cinnamon", "spices"]], "moussaka recipe", { batch: true }),

  // ── Asian ──
  m("chicken_stirfry", "Chicken Stir-Fry", "Asian", LD, 25, "both", [["chicken breast", "protein"], ["broccoli", "produce"], ["snap peas", "produce"], ["soy sauce", "spices"], ["ginger", "produce"], ["rice", "pantry"]], "chicken vegetable stir fry no sugar", { order: "chicken stir fry" }),
  m("beef_broccoli", "Beef & Broccoli", "Asian", LD, 30, "both", [["flank steak", "protein"], ["broccoli", "produce"], ["soy sauce", "spices"], ["mushroom stir-fry sauce (vegetarian 'oyster' sauce)", "spices"], ["ginger", "produce"], ["rice", "pantry"]], "beef and broccoli healthy", { sugar: "low", order: "beef and broccoli" }),
  m("green_curry", "Thai Green Curry", "Asian", LD, 35, "both", [["chicken thighs", "protein"], ["coconut milk", "pantry"], ["green curry paste (check the label: no shrimp paste)", "intl"], ["bamboo shoots", "intl"], ["thai basil", "produce"], ["jasmine rice", "pantry"]], "thai green curry chicken", { order: "thai green curry", note: "Ordering: Thai curry pastes often have shrimp paste; tell them about the shellfish allergy." }),
  m("pho", "Pho", "Asian", LD, 180, "order", [["beef bones", "protein"], ["rice noodles", "intl"], ["star anise", "spices"], ["bean sprouts", "produce"], ["thai basil", "produce"]], "beef pho", { order: "pho" }),
  m("bibimbap", "Bibimbap", "Asian", LD, 40, "both", [["ground beef", "protein"], ["rice", "pantry"], ["spinach", "produce"], ["carrots", "produce"], ["bean sprouts", "produce"], ["eggs", "dairy"], ["gochujang", "intl"]], "bibimbap recipe", { sugar: "low", order: "bibimbap" }),
  m("salmon_rice_bowl", "Salmon Rice Bowl", "Asian", LD, 25, "both", [["salmon fillets", "protein"], ["sushi rice", "pantry"], ["cucumbers", "produce"], ["avocado", "produce"], ["soy sauce", "spices"], ["sesame seeds", "spices"]], "salmon rice bowl", { order: "poke bowl" }),
  m("egg_fried_rice", "Chicken Fried Rice", "Asian", LD, 20, "both", [["rice", "pantry"], ["eggs", "dairy"], ["chicken thighs", "protein"], ["mixed vegetables", "frozen"], ["soy sauce", "spices"], ["green onions", "produce"]], "chicken egg fried rice", { order: "chicken fried rice" }),
  m("ramen", "Ramen", "Asian", LD, 30, "order", [["ramen noodles", "intl"], ["eggs", "dairy"], ["chicken broth", "pantry"]], "ramen bowl", { order: "ramen" }),

  // ── Indian ──
  m("butter_chicken", "Butter Chicken", "Indian", LD, 45, "both", [["chicken thighs", "protein"], ["canned tomatoes", "pantry"], ["heavy cream", "dairy"], ["garam masala", "spices"], ["ginger", "produce"], ["basmati rice", "pantry"]], "butter chicken recipe", { order: "butter chicken", note: "Ordering: rice, not naan." }),
  m("chana_masala", "Chana Masala", "Indian", LD, 35, "both", [["chickpeas", "pantry"], ["canned tomatoes", "pantry"], ["onions", "produce"], ["garam masala", "spices"], ["ginger", "produce"], ["basmati rice", "pantry"]], "chana masala recipe", { batch: true, order: "chana masala" }),
  m("dal", "Dal Tadka", "Indian", LD, 35, "cook", [["red lentils", "pantry"], ["tomatoes", "produce"], ["cumin seeds", "spices"], ["turmeric", "spices"], ["basmati rice", "pantry"]], "dal tadka recipe", { batch: true }),

  // ── Caribbean / Middle Eastern / Italian ──
  m("jerk_chicken", "Jerk Chicken, Rice & Peas", "Caribbean", LD, 60, "both", [["chicken leg quarters", "protein"], ["jerk seasoning", "spices"], ["kidney beans", "pantry"], ["coconut milk", "pantry"], ["rice", "pantry"], ["scotch bonnet peppers", "produce"]], "jerk chicken rice and peas", { order: "jerk chicken" }),
  m("curry_goat", "Curry Goat", "Caribbean", LD, 120, "both", [["goat meat", "protein"], ["curry powder", "spices"], ["potatoes", "produce"], ["scotch bonnet peppers", "produce"], ["rice", "pantry"]], "jamaican curry goat", { batch: true, order: "curry goat" }),
  m("shawarma_plate", "Chicken Shawarma Plate", "Middle Eastern", LD, 40, "both", [["chicken thighs", "protein"], ["plain greek yogurt", "dairy"], ["cucumbers", "produce"], ["tomatoes", "produce"], ["rice", "pantry"], ["shawarma spice", "spices"]], "chicken shawarma rice plate", { order: "chicken shawarma plate", note: "Ordering: plate or bowl, not wrap." }),
  m("spaghetti_bolognese", "Spaghetti Bolognese", "Italian", LD, 45, "both", [["spaghetti", "pantry"], ["ground beef", "protein"], ["canned tomatoes", "pantry"], ["carrots", "produce"], ["celery", "produce"], ["parmesan", "dairy"]], "spaghetti bolognese", { batch: true, order: "spaghetti bolognese" }),
  m("chicken_piccata", "Chicken Piccata", "Italian", LD, 30, "cook", [["chicken breast", "protein"], ["lemons", "produce"], ["capers", "pantry"], ["green beans", "produce"], ["butter", "dairy"]], "chicken piccata"),
];


// One line on what each meal is.
const DESC = {
  "akara_pap": "Crispy bean fritters with peppered scrambled eggs.",
  "yam_egg": "Boiled yam with a tomato-pepper egg sauce.",
  "dodo_eggs": "Fried ripe plantain with peppery eggs.",
  "moimoi": "Steamed bean pudding with egg; great for breakfast or lunch.",
  "omelet_veg": "Spinach, peppers and cheddar, with sliced avocado.",
  "steak_eggs": "Seared steak, eggs and crispy potatoes.",
  "yogurt_bowl": "Plain Greek yogurt, berries, walnuts and chia. No added sugar.",
  "shakshuka": "Eggs poached in spiced tomato and peppers, with feta.",
  "chilaquiles": "Tortilla chips in salsa verde with eggs and queso fresco.",
  "breakfast_bowl": "Eggs, black beans, potatoes, salsa and avocado.",
  "congee": "Silky ginger rice porridge with chicken.",
  "savory_oats": "Oats cooked with parmesan, topped with an egg and greens.",
  "japanese_bfast": "Japanese-style breakfast: grilled salmon, rice and miso soup.",
  "jollof_chicken": "Smoky party jollof with seasoned chicken.",
  "fried_rice_ng": "Curry-thyme rice with mixed veg, liver and chicken.",
  "egusi": "Melon-seed soup with goat meat and greens; with pounded yam or eba.",
  "efo_riro": "Rich spinach stew with beef and smoked fish; with rice or amala.",
  "ofada_ayamase": "Local rice with green pepper 'designer' stew and assorted meat.",
  "pepper_soup": "Spicy, aromatic goat (or catfish) pepper soup.",
  "ewa_dodo": "Soft stewed beans in palm-oil pepper sauce, with plantain.",
  "asaro": "Yam cooked down in palm oil and peppers with greens.",
  "suya_salad": "Spiced grilled beef with onions, tomato and cucumber.",
  "okra_soup": "Draw soup with beef and smoked fish; with eba or rice.",
  "sheet_pan_chicken": "Paprika chicken thighs roasted with broccoli and sweet potato.",
  "steak_potatoes": "Seared steak, crispy baby potatoes and a side salad.",
  "burger_bowl": "Everything in a burger, on a bed of lettuce instead of a bun.",
  "chili": "A big pot of hearty chili.",
  "salmon_asparagus": "Pan-seared salmon with asparagus and rice.",
  "cobb_salad": "Chicken, bacon, egg, avocado and blue cheese.",
  "catfish_grits": "Cajun-spiced catfish over cheesy grits.",
  "bbq_dry_rub": "Oven-crisp wings with a spice rub (no sugary sauce) and coleslaw.",
  "fajita_bowl": "Sizzling chicken and peppers over rice and beans.",
  "carne_asada_tacos": "Grilled steak on corn tortillas with onion, cilantro and lime.",
  "burrito_bowl": "Rice, beans, corn, salsa and your protein.",
  "pozole": "Red chile pork and hominy stew.",
  "fish_tacos": "Chipotle tilapia on corn tortillas with lime slaw.",
  "tortilla_soup": "Smoky tomato chicken soup with avocado.",
  "souvlaki_plate": "Lemon-oregano chicken over rice with salad and tzatziki.",
  "greek_salad_salmon": "Classic Greek salad topped with grilled salmon.",
  "kofta_rice": "Spiced lamb skewers with rice and tzatziki.",
  "avgolemono": "Greek avgolemono: chicken, rice and lemon.",
  "moussaka": "Layered eggplant, spiced meat and creamy topping.",
  "chicken_stirfry": "Chicken, broccoli and snap peas with ginger-soy, over rice.",
  "beef_broccoli": "Tender beef and broccoli in a savory sauce, no added sugar.",
  "green_curry": "Chicken in coconut green curry with jasmine rice.",
  "pho": "Vietnamese beef noodle soup.",
  "bibimbap": "Korean rice bowl with beef, veggies and a fried egg.",
  "salmon_rice_bowl": "Salmon, rice, cucumber and avocado.",
  "egg_fried_rice": "Quick egg fried rice with chicken and veg.",
  "ramen": "A big bowl of noodle soup.",
  "butter_chicken": "Creamy tomato-spiced chicken with basmati rice.",
  "chana_masala": "Spiced chickpea curry with rice.",
  "dal": "Comforting spiced lentils with rice.",
  "jerk_chicken": "Fiery jerk chicken with coconut rice and peas.",
  "curry_goat": "Slow-cooked Caribbean goat curry with rice.",
  "shawarma_plate": "Spiced chicken over rice with salad and garlic yogurt.",
  "spaghetti_bolognese": "Slow-simmered meat sauce over spaghetti.",
  "chicken_piccata": "Lemon-caper chicken with green beans."
};

// Notes that start with "Ordering:" are tips for ordering it; the rest are cooking tips.
for (const meal of MEALS) {
  meal.desc = DESC[meal.key] || "";
  if (meal.note && meal.note.startsWith("Ordering:")) {
    meal.orderNote = meal.note.replace(/^Ordering:\s*/, "").replace(/^./, (c) => c.toUpperCase());
    meal.note = "";
  }
}

module.exports = { CUISINES, AISLES, STAPLES, MEALS, SHELLFISH };
