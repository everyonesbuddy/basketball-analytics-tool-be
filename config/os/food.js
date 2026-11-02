/**
 * The meal library: written once, no bread and little to no sugar by design.
 * Each meal: cuisine, which meals it suits, minutes to cook, cook/order,
 * sugar ("none", or "low" for a little in a sauce), ingredients by grocery
 * aisle, a Pinterest recipe search, and what to search for when ordering.
 * `batch`: makes enough for leftovers (lunch tomorrow, or freeze).
 * `tortilla`: uses corn tortillas (hidden if tortillas count as bread).
 */

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
  m("akara_pap", "Akara with pap (no sugar) or eggs", "Nigerian", B, 40, "both", [["black-eyed peas", "pantry"], ["scotch bonnet peppers", "produce"], ["onions", "produce"], ["vegetable oil", "pantry"], ["salt", "spices"]], "nigerian akara recipe", { order: "akara", note: "Skip the bread; pair with eggs or unsweetened pap." }),
  m("yam_egg", "Boiled yam with egg sauce", "Nigerian", B, 30, "cook", [["puna yam", "intl"], ["eggs", "dairy"], ["tomatoes", "produce"], ["onions", "produce"], ["scotch bonnet peppers", "produce"]], "nigerian yam and egg sauce"),
  m("dodo_eggs", "Dodo (fried plantain) and eggs", "Nigerian", B, 20, "cook", [["ripe plantains", "produce"], ["eggs", "dairy"], ["bell peppers", "produce"], ["onions", "produce"]], "plantain and egg breakfast nigerian"),
  m("moimoi", "Moi moi", "Nigerian", [...B, "lunch"], 75, "both", [["black-eyed peas", "pantry"], ["red bell peppers", "produce"], ["scotch bonnet peppers", "produce"], ["eggs", "dairy"], ["crayfish", "intl"], ["vegetable oil", "pantry"]], "nigerian moi moi recipe", { batch: true, order: "moi moi" }),
  m("omelet_veg", "Veggie omelet with avocado", "American", B, 15, "cook", [["eggs", "dairy"], ["spinach", "produce"], ["bell peppers", "produce"], ["avocado", "produce"], ["cheddar", "dairy"]], "veggie omelet avocado"),
  m("steak_eggs", "Steak and eggs with potatoes", "American", B, 30, "both", [["sirloin steak", "protein"], ["eggs", "dairy"], ["potatoes", "produce"]], "steak and eggs breakfast potatoes", { order: "steak and eggs breakfast" }),
  m("yogurt_bowl", "Greek yogurt bowl (plain), berries and nuts", "Greek", B, 5, "cook", [["plain greek yogurt", "dairy"], ["berries", "produce"], ["walnuts", "pantry"], ["chia seeds", "pantry"]], "greek yogurt bowl berries nuts no sugar"),
  m("shakshuka", "Shakshuka (no bread; eat it with a spoon or potatoes)", "Middle Eastern", B, 30, "cook", [["eggs", "dairy"], ["canned tomatoes", "pantry"], ["bell peppers", "produce"], ["onions", "produce"], ["feta", "dairy"], ["cumin", "spices"]], "shakshuka recipe"),
  m("chilaquiles", "Chilaquiles verdes with eggs", "Mexican", B, 25, "both", [["corn tortillas", "pantry"], ["salsa verde", "spices"], ["eggs", "dairy"], ["queso fresco", "dairy"], ["avocado", "produce"]], "chilaquiles verdes recipe", { tortilla: true, order: "chilaquiles" }),
  m("breakfast_bowl", "Breakfast burrito bowl", "Mexican", B, 20, "cook", [["eggs", "dairy"], ["black beans", "pantry"], ["potatoes", "produce"], ["salsa", "spices"], ["avocado", "produce"], ["cheddar", "dairy"]], "breakfast burrito bowl no tortilla"),
  m("congee", "Chicken congee", "Asian", B, 60, "both", [["rice", "pantry"], ["chicken thighs", "protein"], ["ginger", "produce"], ["green onions", "produce"], ["soy sauce", "spices"]], "chicken congee recipe", { order: "congee" }),
  m("savory_oats", "Savory oats with egg and greens", "American", B, 15, "cook", [["rolled oats", "pantry"], ["eggs", "dairy"], ["spinach", "produce"], ["parmesan", "dairy"]], "savory oatmeal egg"),
  m("japanese_bfast", "Salmon, rice and miso soup", "Asian", B, 25, "cook", [["salmon fillets", "protein"], ["rice", "pantry"], ["miso paste", "intl"], ["tofu", "protein"], ["green onions", "produce"]], "japanese breakfast salmon miso"),

  // ── Nigerian ──
  m("jollof_chicken", "Jollof rice with chicken", "Nigerian", LD, 75, "both", [["long grain parboiled rice", "pantry"], ["chicken drumsticks", "protein"], ["tomatoes", "produce"], ["red bell peppers", "produce"], ["scotch bonnet peppers", "produce"], ["tomato paste", "pantry"], ["onions", "produce"], ["curry powder", "spices"], ["thyme", "spices"], ["bay leaves", "spices"], ["chicken bouillon", "spices"]], "nigerian jollof rice chicken recipe", { batch: true, order: "nigerian jollof rice", note: "Make a big pot: it covers tomorrow's lunch." }),
  m("fried_rice_ng", "Nigerian fried rice with chicken", "Nigerian", LD, 60, "both", [["long grain parboiled rice", "pantry"], ["chicken thighs", "protein"], ["mixed vegetables", "frozen"], ["liver", "protein"], ["curry powder", "spices"], ["thyme", "spices"], ["shrimp", "protein"]], "nigerian fried rice recipe", { batch: true, order: "nigerian fried rice" }),
  m("egusi", "Egusi soup with pounded yam or eba", "Nigerian", LD, 90, "both", [["ground egusi", "intl"], ["spinach", "produce"], ["goat meat", "protein"], ["stockfish", "intl"], ["crayfish", "intl"], ["palm oil", "intl"], ["scotch bonnet peppers", "produce"], ["pounded yam flour", "intl"]], "nigerian egusi soup recipe", { batch: true, order: "egusi soup", note: "Freezes well: cook once, eat three times." }),
  m("efo_riro", "Efo riro with rice or amala", "Nigerian", LD, 60, "both", [["spinach", "produce"], ["beef", "protein"], ["smoked fish", "intl"], ["iru (locust beans)", "intl"], ["red bell peppers", "produce"], ["palm oil", "intl"], ["crayfish", "intl"]], "efo riro recipe", { batch: true, order: "efo riro" }),
  m("ofada_ayamase", "Ofada rice with ayamase (green pepper stew)", "Nigerian", LD, 90, "both", [["ofada rice", "intl"], ["green bell peppers", "produce"], ["scotch bonnet peppers", "produce"], ["assorted meat", "protein"], ["eggs", "dairy"], ["iru (locust beans)", "intl"], ["palm oil", "intl"]], "ofada rice ayamase recipe", { batch: true, order: "ofada rice ayamase" }),
  m("pepper_soup", "Goat meat or catfish pepper soup", "Nigerian", LD, 60, "both", [["goat meat", "protein"], ["pepper soup spice", "intl"], ["scotch bonnet peppers", "produce"], ["scent leaves or basil", "produce"], ["potatoes", "produce"]], "goat meat pepper soup recipe", { order: "pepper soup" }),
  m("ewa_dodo", "Ewa riro (beans) with dodo", "Nigerian", LD, 75, "cook", [["honey beans", "intl"], ["ripe plantains", "produce"], ["palm oil", "intl"], ["red bell peppers", "produce"], ["crayfish", "intl"], ["onions", "produce"]], "ewa riro beans and plantain", { batch: true }),
  m("asaro", "Asaro (yam porridge)", "Nigerian", LD, 50, "cook", [["puna yam", "intl"], ["palm oil", "intl"], ["red bell peppers", "produce"], ["smoked fish", "intl"], ["spinach", "produce"], ["crayfish", "intl"]], "asaro yam porridge recipe", { batch: true }),
  m("suya_salad", "Beef suya with onions, tomato and cucumber", "Nigerian", LD, 30, "both", [["flank steak", "protein"], ["suya spice (yaji)", "intl"], ["red onions", "produce"], ["tomatoes", "produce"], ["cucumbers", "produce"]], "beef suya recipe", { order: "suya" }),
  m("okra_soup", "Okra soup with eba or rice", "Nigerian", LD, 50, "both", [["okra", "produce"], ["beef", "protein"], ["shrimp", "protein"], ["palm oil", "intl"], ["crayfish", "intl"], ["spinach", "produce"], ["garri", "intl"]], "nigerian okra soup recipe", { batch: true, order: "okra soup" }),

  // ── American ──
  m("sheet_pan_chicken", "Sheet-pan chicken and roasted vegetables", "American", LD, 40, "cook", [["chicken thighs", "protein"], ["broccoli", "produce"], ["sweet potatoes", "produce"], ["red onions", "produce"], ["paprika", "spices"], ["garlic powder", "spices"]], "sheet pan chicken and vegetables"),
  m("steak_potatoes", "Steak, roasted potatoes and salad", "American", LD, 35, "both", [["ribeye or sirloin steak", "protein"], ["baby potatoes", "produce"], ["mixed greens", "produce"], ["cherry tomatoes", "produce"]], "steak and roasted potatoes dinner", { order: "steakhouse" }),
  m("burger_bowl", "Burger bowl (no bun)", "American", LD, 25, "both", [["ground beef", "protein"], ["romaine", "produce"], ["tomatoes", "produce"], ["pickles", "pantry"], ["cheddar", "dairy"], ["red onions", "produce"]], "burger bowl no bun", { order: "burger lettuce wrap", note: "Ordering: ask for a lettuce wrap, no bun." }),
  m("chili", "Beef and bean chili", "American", LD, 60, "cook", [["ground beef", "protein"], ["kidney beans", "pantry"], ["canned tomatoes", "pantry"], ["bell peppers", "produce"], ["chili powder", "spices"], ["cumin", "spices"]], "beef chili recipe", { batch: true }),
  m("salmon_asparagus", "Garlic butter salmon and asparagus", "American", LD, 25, "cook", [["salmon fillets", "protein"], ["asparagus", "produce"], ["lemons", "produce"], ["butter", "dairy"], ["rice", "pantry"]], "garlic butter salmon asparagus"),
  m("cobb_salad", "Cobb salad", "American", ["lunch"], 20, "both", [["chicken breast", "protein"], ["bacon", "protein"], ["eggs", "dairy"], ["avocado", "produce"], ["romaine", "produce"], ["blue cheese", "dairy"]], "cobb salad recipe", { order: "cobb salad" }),
  m("shrimp_grits", "Shrimp and grits", "American", LD, 35, "both", [["shrimp", "protein"], ["stone-ground grits", "pantry"], ["cheddar", "dairy"], ["bacon", "protein"], ["green onions", "produce"]], "shrimp and grits recipe", { order: "shrimp and grits" }),
  m("bbq_dry_rub", "Dry-rub chicken wings and coleslaw (no sugary sauce)", "American", LD, 50, "both", [["chicken wings", "protein"], ["cabbage", "produce"], ["carrots", "produce"], ["paprika", "spices"], ["mayonnaise", "pantry"]], "dry rub chicken wings oven", { order: "dry rub wings", note: "Ordering: dry rub or buffalo, not honey BBQ." }),

  // ── Mexican ──
  m("fajita_bowl", "Chicken fajita bowl", "Mexican", LD, 30, "both", [["chicken breast", "protein"], ["bell peppers", "produce"], ["onions", "produce"], ["rice", "pantry"], ["black beans", "pantry"], ["avocado", "produce"], ["fajita seasoning", "spices"]], "chicken fajita bowl recipe", { order: "chicken fajitas" }),
  m("carne_asada_tacos", "Carne asada tacos (corn tortillas)", "Mexican", LD, 35, "both", [["flank steak", "protein"], ["corn tortillas", "pantry"], ["limes", "produce"], ["cilantro", "produce"], ["white onions", "produce"], ["salsa", "spices"]], "carne asada tacos recipe", { tortilla: true, order: "carne asada tacos" }),
  m("burrito_bowl", "Burrito bowl", "Mexican", LD, 30, "both", [["ground beef or chicken", "protein"], ["rice", "pantry"], ["pinto beans", "pantry"], ["corn", "frozen"], ["salsa", "spices"], ["sour cream", "dairy"], ["romaine", "produce"]], "burrito bowl recipe", { order: "burrito bowl" }),
  m("pozole", "Pozole rojo", "Mexican", LD, 90, "both", [["pork shoulder", "protein"], ["hominy", "pantry"], ["guajillo chiles", "intl"], ["cabbage", "produce"], ["radishes", "produce"], ["limes", "produce"]], "pozole rojo recipe", { batch: true, order: "pozole" }),
  m("shrimp_tacos", "Shrimp tacos with cabbage slaw", "Mexican", LD, 25, "both", [["shrimp", "protein"], ["corn tortillas", "pantry"], ["cabbage", "produce"], ["limes", "produce"], ["chipotle in adobo", "intl"], ["sour cream", "dairy"]], "shrimp tacos cabbage slaw", { tortilla: true, order: "shrimp tacos" }),
  m("tortilla_soup", "Chicken tortilla soup", "Mexican", LD, 40, "cook", [["chicken thighs", "protein"], ["canned tomatoes", "pantry"], ["black beans", "pantry"], ["corn tortillas", "pantry"], ["avocado", "produce"], ["cumin", "spices"]], "chicken tortilla soup recipe", { tortilla: true, batch: true }),

  // ── Greek / Mediterranean ──
  m("souvlaki_plate", "Chicken souvlaki plate (no pita): rice, salad, tzatziki", "Greek", LD, 40, "both", [["chicken breast", "protein"], ["lemons", "produce"], ["oregano", "spices"], ["cucumbers", "produce"], ["plain greek yogurt", "dairy"], ["tomatoes", "produce"], ["rice", "pantry"]], "chicken souvlaki plate", { order: "chicken souvlaki plate", note: "Ordering: plate, not pita." }),
  m("greek_salad_shrimp", "Greek salad with grilled shrimp", "Greek", LD, 20, "both", [["shrimp", "protein"], ["cucumbers", "produce"], ["tomatoes", "produce"], ["feta", "dairy"], ["kalamata olives", "pantry"], ["red onions", "produce"]], "greek salad grilled shrimp", { order: "greek salad" }),
  m("kofta_rice", "Lamb kofta with rice and tzatziki", "Greek", LD, 35, "both", [["ground lamb", "protein"], ["parsley", "produce"], ["plain greek yogurt", "dairy"], ["cucumbers", "produce"], ["rice", "pantry"], ["cumin", "spices"]], "lamb kofta recipe", { order: "lamb kofta plate" }),
  m("avgolemono", "Avgolemono (lemon chicken rice soup)", "Greek", LD, 45, "cook", [["chicken breast", "protein"], ["rice", "pantry"], ["lemons", "produce"], ["eggs", "dairy"], ["chicken broth", "pantry"]], "avgolemono soup recipe", { batch: true }),
  m("moussaka", "Moussaka", "Greek", ["dinner"], 120, "cook", [["eggplants", "produce"], ["ground lamb or beef", "protein"], ["potatoes", "produce"], ["canned tomatoes", "pantry"], ["milk", "dairy"], ["parmesan", "dairy"], ["cinnamon", "spices"]], "moussaka recipe", { batch: true }),

  // ── Asian ──
  m("chicken_stirfry", "Chicken and vegetable stir-fry with rice", "Asian", LD, 25, "both", [["chicken breast", "protein"], ["broccoli", "produce"], ["snap peas", "produce"], ["soy sauce", "spices"], ["ginger", "produce"], ["rice", "pantry"]], "chicken vegetable stir fry no sugar", { order: "chicken stir fry" }),
  m("beef_broccoli", "Beef and broccoli (no sugar in the sauce)", "Asian", LD, 30, "both", [["flank steak", "protein"], ["broccoli", "produce"], ["soy sauce", "spices"], ["oyster sauce", "spices"], ["ginger", "produce"], ["rice", "pantry"]], "beef and broccoli healthy", { sugar: "low", order: "beef and broccoli" }),
  m("green_curry", "Thai green curry with chicken", "Asian", LD, 35, "both", [["chicken thighs", "protein"], ["coconut milk", "pantry"], ["green curry paste", "intl"], ["bamboo shoots", "intl"], ["thai basil", "produce"], ["jasmine rice", "pantry"]], "thai green curry chicken", { order: "thai green curry" }),
  m("pho", "Pho", "Asian", LD, 180, "order", [["beef bones", "protein"], ["rice noodles", "intl"], ["star anise", "spices"], ["bean sprouts", "produce"], ["thai basil", "produce"]], "beef pho", { order: "pho" }),
  m("bibimbap", "Bibimbap", "Asian", LD, 40, "both", [["ground beef", "protein"], ["rice", "pantry"], ["spinach", "produce"], ["carrots", "produce"], ["bean sprouts", "produce"], ["eggs", "dairy"], ["gochujang", "intl"]], "bibimbap recipe", { sugar: "low", order: "bibimbap" }),
  m("salmon_rice_bowl", "Salmon rice bowl with cucumber and avocado", "Asian", LD, 25, "both", [["salmon fillets", "protein"], ["sushi rice", "pantry"], ["cucumbers", "produce"], ["avocado", "produce"], ["soy sauce", "spices"], ["sesame seeds", "spices"]], "salmon rice bowl", { order: "poke bowl" }),
  m("egg_fried_rice", "Egg fried rice with shrimp", "Asian", LD, 20, "both", [["rice", "pantry"], ["eggs", "dairy"], ["shrimp", "protein"], ["mixed vegetables", "frozen"], ["soy sauce", "spices"], ["green onions", "produce"]], "shrimp egg fried rice", { order: "shrimp fried rice" }),
  m("ramen", "Ramen", "Asian", LD, 30, "order", [["ramen noodles", "intl"], ["eggs", "dairy"], ["chicken broth", "pantry"]], "ramen bowl", { order: "ramen" }),

  // ── Indian ──
  m("butter_chicken", "Butter chicken with basmati rice", "Indian", LD, 45, "both", [["chicken thighs", "protein"], ["canned tomatoes", "pantry"], ["heavy cream", "dairy"], ["garam masala", "spices"], ["ginger", "produce"], ["basmati rice", "pantry"]], "butter chicken recipe", { order: "butter chicken", note: "Ordering: rice, not naan." }),
  m("chana_masala", "Chana masala with rice", "Indian", LD, 35, "both", [["chickpeas", "pantry"], ["canned tomatoes", "pantry"], ["onions", "produce"], ["garam masala", "spices"], ["ginger", "produce"], ["basmati rice", "pantry"]], "chana masala recipe", { batch: true, order: "chana masala" }),
  m("dal", "Dal tadka with rice", "Indian", LD, 35, "cook", [["red lentils", "pantry"], ["tomatoes", "produce"], ["cumin seeds", "spices"], ["turmeric", "spices"], ["basmati rice", "pantry"]], "dal tadka recipe", { batch: true }),

  // ── Caribbean / Middle Eastern / Italian ──
  m("jerk_chicken", "Jerk chicken with rice and peas", "Caribbean", LD, 60, "both", [["chicken leg quarters", "protein"], ["jerk seasoning", "spices"], ["kidney beans", "pantry"], ["coconut milk", "pantry"], ["rice", "pantry"], ["scotch bonnet peppers", "produce"]], "jerk chicken rice and peas", { order: "jerk chicken" }),
  m("curry_goat", "Curry goat with rice", "Caribbean", LD, 120, "both", [["goat meat", "protein"], ["curry powder", "spices"], ["potatoes", "produce"], ["scotch bonnet peppers", "produce"], ["rice", "pantry"]], "jamaican curry goat", { batch: true, order: "curry goat" }),
  m("shawarma_plate", "Chicken shawarma plate (no pita)", "Middle Eastern", LD, 40, "both", [["chicken thighs", "protein"], ["plain greek yogurt", "dairy"], ["cucumbers", "produce"], ["tomatoes", "produce"], ["rice", "pantry"], ["shawarma spice", "spices"]], "chicken shawarma rice plate", { order: "chicken shawarma plate", note: "Ordering: plate or bowl, not wrap." }),
  m("spaghetti_bolognese", "Spaghetti bolognese", "Italian", LD, 45, "both", [["spaghetti", "pantry"], ["ground beef", "protein"], ["canned tomatoes", "pantry"], ["carrots", "produce"], ["celery", "produce"], ["parmesan", "dairy"]], "spaghetti bolognese", { batch: true, order: "spaghetti bolognese" }),
  m("chicken_piccata", "Chicken piccata with green beans", "Italian", LD, 30, "cook", [["chicken breast", "protein"], ["lemons", "produce"], ["capers", "pantry"], ["green beans", "produce"], ["butter", "dairy"]], "chicken piccata"),
];

module.exports = { CUISINES, AISLES, STAPLES, MEALS };
