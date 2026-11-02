/**
 * The personal style guide, written once: color structures, silhouette
 * rules, occasions, the color families used to build tonal outfits, and the
 * core pieces the guide calls for (which feed the shopping list).
 */

// Color keys used for wardrobe items. `family` groups tones that make a tonal outfit.
const COLORS = {
  black: { name: "Black", family: "black", hex: "#111111", neutral: true },
  charcoal: { name: "Charcoal", family: "grey", hex: "#3c3f44", also: "black", neutral: true },
  grey: { name: "Grey", family: "grey", hex: "#8a8f98", neutral: true },
  light_grey: { name: "Light grey", family: "grey", hex: "#c9ccd1", neutral: true },
  white: { name: "White", family: "white", hex: "#f7f7f5", neutral: true },
  navy: { name: "Navy", family: "navy", hex: "#1f2a44" },
  slate: { name: "Slate blue", family: "navy", hex: "#4f6d8f" },
  light_blue: { name: "Light blue", family: "navy", hex: "#a9c4e0" },
  denim: { name: "Blue denim", family: "denim", hex: "#3b5b85", neutral: true },
  olive: { name: "Olive", family: "olive", hex: "#5b5f3a" },
  dark_olive: { name: "Dark olive", family: "olive", hex: "#3f4229" },
  tan: { name: "Tan", family: "tan", hex: "#c4a57a", neutral: true },
  brown: { name: "Brown", family: "tan", hex: "#6b4a2f" },
  camo: { name: "Camo", family: "camo", hex: "#6b6b4a", neutral: true },
  // Mostly for native wear
  cream: { name: "Cream", family: "white", hex: "#efe6d2", neutral: true },
  wine: { name: "Wine", family: "wine", hex: "#6d1f2c" },
  emerald: { name: "Emerald", family: "green", hex: "#1f5c45" },
  gold: { name: "Gold", family: "gold", hex: "#b8913a" },
};

// Tonal families: the ones the guide builds full-monochrome outfits from.
const TONAL = {
  white: { name: "Tonal cream / white", colors: ["white", "cream", "light_grey"], search: "men all white cream native wear" },
  black: { name: "Tonal black", colors: ["black", "charcoal"], search: "tall men all black tonal outfit" },
  grey: { name: "Tonal grey", colors: ["charcoal", "grey", "light_grey"], search: "tall men tonal grey outfit" },
  navy: { name: "Tonal navy", colors: ["navy", "slate", "light_blue"], search: "men tonal navy outfit" },
  olive: { name: "Tonal olive", colors: ["olive", "dark_olive", "tan"], search: "men tonal olive outfit" },
};

const STRUCTURES = {
  monochrome: {
    name: "Full monochrome (tonal)",
    short: "One color family, head to toe",
    why: "At 6'7\" and broad, one continuous color line elongates you instead of cutting you into blocks. Tonal (shades of one family) keeps it interesting without breaking the line.",
  },
  neutral_accent: {
    name: "Neutral base + accent",
    short: "Easy base, one accent layer",
    why: "Your fastest everyday option: a neutral base (white or black tee, denim, black jeans, tan chino, camo) with an accent layer when you want one. Coordinated, not color-matched.",
  },
  contrast: {
    name: "High contrast",
    short: "Black and white, on purpose",
    why: "A sharp, graphic line rather than an elongating one. Use it deliberately for a bold going-out look, not as a default.",
  },
};

const SILHOUETTE = [
  "One straight line from shoulder to shoe.",
  "Pants straight or slim-straight: never skinny, never baggy.",
  "Tailoring soft-shouldered, not padded; sleeve, inseam and hem length matter more than brand. Use a tailor.",
  "Layers soft-structured, not fully oversized; cropped-waist jackets (bomber, leather) read cleaner than long coats.",
  "Shoes minimal and sleek with a thin sole. A chunky shoe undoes the line, except in streetwear looks where it's on purpose.",
  "Jackets and overshirts are optional layers, never required.",
];

// Occasions: which structures fit, best first, and whether chunky sneakers are allowed.
const OCCASIONS = {
  everyday: { name: "Everyday casual", structures: ["neutral_accent", "monochrome"], shoe: "minimal sneaker" },
  smart: { name: "Smart-casual", structures: ["neutral_accent", "monochrome"], shoe: "clean boot or minimal sneaker" },
  work: { name: "Work / office", structures: ["monochrome"], shoe: "black shoe or derby" },
  going_out: { name: "Going out", structures: ["monochrome", "contrast", "neutral_accent"], shoe: "minimal black shoe" },
  street: { name: "Athletic / streetwear", structures: ["neutral_accent", "monochrome"], shoe: "chunky sneaker", chunky: true },
  // Yoruba traditional. `layer`: none = no outer layer; wear = the agbada is the occasion, not the weather.
  trad_simple: { name: "Traditional: up & down", structures: ["monochrome", "neutral_accent"], shoe: "leather loafers or slip-ons", trad: true, layer: "none" },
  trad_agbada: { name: "Traditional: agbada / owambe", structures: ["monochrome", "neutral_accent", "contrast"], shoe: "leather loafers or slip-ons", trad: true, layer: "wear" },
};

// The guide's example outfits, used when the wardrobe doesn't cover a look yet.
// Each piece: slot, color key, what it is. `layer` pieces are optional.
const LOOKS = [
  { key: "tonal_black", structure: "monochrome", family: "black", occasions: ["everyday", "going_out", "work"], pieces: [["top", "black", "Black tee"], ["bottom", "black", "Black jeans"], ["layer", "charcoal", "Charcoal overshirt"], ["shoe", "black", "Black minimal sneaker"]], search: "tall men all black tonal outfit overshirt" },
  { key: "tonal_grey", structure: "monochrome", family: "grey", occasions: ["work", "smart", "everyday"], pieces: [["top", "charcoal", "Charcoal shirt"], ["bottom", "grey", "Grey trousers"], ["layer", "light_grey", "Light grey layer"], ["shoe", "grey", "Grey or white sneaker / derby"]], search: "men tonal grey outfit trousers" },
  { key: "tonal_navy", structure: "monochrome", family: "navy", occasions: ["smart", "everyday", "work"], pieces: [["top", "navy", "Navy tee or shirt"], ["bottom", "navy", "Navy chinos"], ["layer", "slate", "Slate blue overshirt"], ["shoe", "navy", "Navy sneaker"]], search: "men tonal navy outfit overshirt" },
  { key: "tonal_olive", structure: "monochrome", family: "olive", occasions: ["everyday", "street"], pieces: [["top", "olive", "Olive tee"], ["bottom", "olive", "Olive cargo"], ["layer", "dark_olive", "Dark olive jacket"], ["shoe", "tan", "Tan or olive boot"]], search: "men tonal olive outfit cargo" },
  { key: "tonal_charcoal_work", name: "Tonal charcoal, tailored", structure: "monochrome", family: "grey", occasions: ["work"], pieces: [["top", "charcoal", "Charcoal shirt"], ["bottom", "charcoal", "Charcoal trousers"], ["layer", "charcoal", "Soft-shoulder charcoal blazer"], ["shoe", "black", "Black shoes"]], search: "tall men charcoal tonal suit soft shoulder blazer" },
  { key: "white_denim_olive", structure: "neutral_accent", occasions: ["everyday"], pieces: [["top", "white", "White tee"], ["bottom", "denim", "Blue denim"], ["layer", "olive", "Olive overshirt"], ["shoe", "white", "Minimal sneaker"]], search: "men white tee blue jeans olive overshirt outfit" },
  { key: "black_black_brown", structure: "neutral_accent", occasions: ["everyday", "going_out"], pieces: [["top", "black", "Black tee"], ["bottom", "black", "Black jeans"], ["layer", "brown", "Brown leather jacket"], ["shoe", "black", "Minimal sneaker"]], search: "men black tee black jeans brown leather jacket" },
  { key: "camo_black_bomber", structure: "neutral_accent", occasions: ["everyday", "street"], pieces: [["top", "black", "Black tee"], ["bottom", "camo", "Camo cargo"], ["layer", "black", "Black bomber"], ["shoe", "black", "Minimal sneaker (chunky for streetwear)"]], search: "men camo cargo black tee black bomber outfit" },
  { key: "jeans_white_navy", structure: "neutral_accent", occasions: ["everyday", "smart"], pieces: [["top", "white", "White tee"], ["bottom", "black", "Black jeans"], ["layer", "navy", "Navy overshirt"], ["shoe", "white", "Minimal sneaker"]], search: "men white tee black jeans navy overshirt" },
  { key: "chino_oxford", structure: "neutral_accent", occasions: ["smart"], pieces: [["top", "white", "White oxford shirt"], ["bottom", "tan", "Tan chinos"], ["layer", "navy", "Navy overshirt"], ["shoe", "brown", "Clean boot"]], search: "men tan chinos white oxford navy overshirt outfit" },
  { key: "contrast_white_black", structure: "contrast", occasions: ["going_out"], pieces: [["top", "white", "White tee"], ["bottom", "black", "Black jeans"], ["layer", "black", "Black jacket"], ["shoe", "black", "Minimal black shoe"]], search: "men white tee black jeans black jacket outfit" },
  { key: "contrast_black_white", structure: "contrast", occasions: ["going_out"], pieces: [["top", "black", "Black tee"], ["bottom", "white", "White pants"], ["shoe", "black", "Minimal black shoe"]], search: "men black tee white pants outfit" },
  { key: "street_white_bomber", structure: "neutral_accent", occasions: ["street"], pieces: [["top", "white", "White tee"], ["bottom", "black", "Black jeans"], ["layer", "olive", "Bomber"], ["shoe", "white", "Chunky sneaker"]], search: "men streetwear white tee black jeans bomber chunky sneakers" },
  // Yoruba traditional: buba (top), sokoto (bottom), agbada (the outer layer), fila (cap).
  { key: "trad_navy_ud", trad: true, name: "Tonal navy up & down", structure: "monochrome", family: "navy", occasions: ["trad_simple"], pieces: [["top", "navy", "Navy buba"], ["bottom", "navy", "Navy sokoto"], ["cap", "navy", "Navy fila"], ["shoe", "black", "Black leather loafers"]], search: "yoruba men navy senator up and down fila" },
  { key: "trad_black_wine", trad: true, name: "Black up & down, wine fila", structure: "neutral_accent", occasions: ["trad_simple"], pieces: [["top", "black", "Black buba"], ["bottom", "black", "Black sokoto"], ["cap", "wine", "Wine fila"], ["shoe", "black", "Black leather loafers"]], search: "men black native up and down wine fila" },
  { key: "trad_cream_ud", trad: true, name: "Tonal cream up & down", structure: "monochrome", family: "white", occasions: ["trad_simple"], pieces: [["top", "cream", "Cream buba"], ["bottom", "cream", "Cream sokoto"], ["cap", "cream", "Cream fila"], ["shoe", "brown", "Brown leather loafers"]], search: "men cream native up and down fila" },
  { key: "trad_olive_ud", trad: true, name: "Tonal olive up & down", structure: "monochrome", family: "olive", occasions: ["trad_simple"], pieces: [["top", "olive", "Olive buba"], ["bottom", "olive", "Olive sokoto"], ["cap", "dark_olive", "Dark olive fila"], ["shoe", "brown", "Brown leather loafers"]], search: "men olive green native wear up and down" },
  { key: "trad_grey_ud", trad: true, name: "Tonal charcoal up & down", structure: "monochrome", family: "grey", occasions: ["trad_simple"], pieces: [["top", "charcoal", "Charcoal buba"], ["bottom", "charcoal", "Charcoal sokoto"], ["cap", "grey", "Grey fila"], ["shoe", "black", "Black leather loafers"]], search: "men charcoal grey native up and down" },
  { key: "agbada_navy", trad: true, name: "Tonal navy agbada", structure: "monochrome", family: "navy", occasions: ["trad_agbada"], pieces: [["top", "navy", "Navy buba"], ["bottom", "navy", "Navy sokoto"], ["layer", "navy", "Navy agbada"], ["cap", "navy", "Navy fila"], ["shoe", "black", "Black leather loafers"]], search: "yoruba men navy blue agbada" },
  { key: "agbada_grey", trad: true, name: "Tonal grey agbada", structure: "monochrome", family: "grey", occasions: ["trad_agbada"], pieces: [["top", "charcoal", "Charcoal buba"], ["bottom", "charcoal", "Charcoal sokoto"], ["layer", "grey", "Grey agbada"], ["cap", "charcoal", "Charcoal fila"], ["shoe", "black", "Black leather loafers"]], search: "men grey agbada" },
  { key: "agbada_cream_gold", trad: true, name: "Cream agbada, gold fila", structure: "neutral_accent", occasions: ["trad_agbada"], pieces: [["top", "cream", "Cream buba"], ["bottom", "cream", "Cream sokoto"], ["layer", "cream", "Cream agbada"], ["cap", "gold", "Gold aso-oke fila"], ["shoe", "brown", "Brown leather loafers"]], search: "men cream agbada gold aso oke fila" },
  { key: "agbada_wine_black", trad: true, name: "Wine agbada over black", structure: "neutral_accent", occasions: ["trad_agbada"], pieces: [["top", "black", "Black buba"], ["bottom", "black", "Black sokoto"], ["layer", "wine", "Wine agbada"], ["cap", "wine", "Wine fila"], ["shoe", "black", "Black leather loafers"]], search: "men wine burgundy agbada" },
  { key: "agbada_emerald", trad: true, name: "Emerald agbada over cream", structure: "neutral_accent", occasions: ["trad_agbada"], pieces: [["top", "cream", "Cream buba"], ["bottom", "cream", "Cream sokoto"], ["layer", "emerald", "Emerald agbada"], ["cap", "emerald", "Emerald fila"], ["shoe", "brown", "Brown leather loafers"]], search: "men emerald green agbada" },
  { key: "agbada_white_black", trad: true, name: "White set, black agbada", structure: "contrast", occasions: ["trad_agbada"], pieces: [["top", "white", "White buba"], ["bottom", "white", "White sokoto"], ["layer", "black", "Black agbada"], ["cap", "black", "Black fila"], ["shoe", "black", "Black leather loafers"]], search: "men white and black agbada" },
];

// The core pieces the guide calls for, for the shopping list. `look` is what to look for.
const CORE = [
  { key: "tee_black", slot: "top", color: "black", name: "Black tee", priority: 1, look: "Heavyweight cotton, tall length so it stays tucked-free and clean at the hem.", search: "men heavyweight black tee tall" },
  { key: "tee_white", slot: "top", color: "white", name: "White tee", priority: 1, look: "Heavyweight, opaque, tall length.", search: "men heavyweight white tee" },
  { key: "jeans_black", slot: "bottom", color: "black", name: "Black jeans, straight or slim-straight", priority: 1, look: "Straight or slim-straight, never skinny; long inseam, hemmed to just touch the shoe.", search: "men black straight leg jeans outfit tall" },
  { key: "jeans_blue", slot: "bottom", color: "denim", name: "Blue denim, straight", priority: 1, look: "Mid wash, straight leg, long inseam.", search: "men straight leg blue jeans outfit" },
  { key: "sneaker_black", slot: "shoe", color: "black", name: "Black minimal sneaker", priority: 1, look: "Thin sole, clean lines, no bulky stacking.", search: "men black minimal leather sneakers" },
  { key: "sneaker_white", slot: "shoe", color: "white", name: "White minimal sneaker", priority: 1, look: "Thin sole, clean leather, no logos shouting.", search: "men white minimal leather sneakers outfit" },
  { key: "overshirt_olive", slot: "layer", color: "olive", name: "Olive overshirt", priority: 2, look: "Soft-structured, not oversized; long enough in the body and sleeve.", search: "men olive overshirt outfit" },
  { key: "overshirt_navy", slot: "layer", color: "navy", name: "Navy overshirt", priority: 2, look: "Soft-structured; works with navy tonal and white tee looks.", search: "men navy overshirt outfit" },
  { key: "overshirt_charcoal", slot: "layer", color: "charcoal", name: "Charcoal overshirt", priority: 2, look: "Soft-structured; the layer for tonal black.", search: "men charcoal overshirt outfit" },
  { key: "chino_navy", slot: "bottom", color: "navy", name: "Navy chinos", priority: 2, look: "Straight or slim-straight, long inseam.", search: "men navy chinos outfit" },
  { key: "chino_tan", slot: "bottom", color: "tan", name: "Tan chinos", priority: 2, look: "Straight or slim-straight, long inseam.", search: "men tan chinos outfit" },
  { key: "trouser_grey", slot: "bottom", color: "grey", name: "Grey trousers", priority: 2, look: "Straight, soft drape, tailored length.", search: "men grey trousers outfit" },
  { key: "shirt_charcoal", slot: "top", color: "charcoal", name: "Charcoal shirt", priority: 2, look: "Long sleeve length; tall fit through the body.", search: "men charcoal shirt outfit" },
  { key: "oxford_white", slot: "top", color: "white", name: "White oxford shirt", priority: 2, look: "Tall fit, sleeves long enough to show at the wrist.", search: "men white oxford shirt outfit" },
  { key: "tee_navy", slot: "top", color: "navy", name: "Navy tee", priority: 2, look: "Heavyweight, tall length.", search: "men navy tee outfit" },
  { key: "bomber_black", slot: "layer", color: "black", name: "Black bomber (cropped waist)", priority: 3, look: "Cropped at the waist, soft structure; not oversized.", search: "men black bomber jacket outfit" },
  { key: "leather_brown", slot: "layer", color: "brown", name: "Brown or black leather jacket (cropped)", priority: 3, look: "Cropped waist, clean lines.", search: "men brown leather jacket outfit" },
  { key: "blazer_charcoal", slot: "layer", color: "charcoal", name: "Soft-shoulder charcoal blazer", priority: 3, look: "Unpadded shoulder, long sleeve; tailor it.", search: "men unstructured charcoal blazer outfit" },
  { key: "boot_clean", slot: "shoe", color: "brown", name: "Clean boot", priority: 3, look: "Slim profile, thin sole.", search: "men clean chelsea boot outfit" },
  { key: "derby_black", slot: "shoe", color: "black", name: "Black derby", priority: 3, look: "Sleek, thin sole.", search: "men black derby shoes outfit" },
  { key: "cargo_camo", slot: "bottom", color: "camo", name: "Camo cargo", priority: 3, look: "Straight, not baggy; for streetwear looks.", search: "men camo cargo pants outfit" },
  { key: "chunky_sneaker", slot: "shoe", color: "white", name: "Chunky sneaker (streetwear only)", priority: 3, look: "Only for streetwear fits, worn on purpose.", search: "men chunky sneakers streetwear outfit" },
  // Traditional (sewn by a tailor). An up & down set counts as its buba (top).
  { key: "trad_ud_navy", group: "traditional", slot: "top", color: "navy", name: "Navy up & down set", priority: 2, look: "Buba and sokoto in one fabric, sewn to your measurements; straight sokoto, not tapered tight.", search: "yoruba men navy up and down native" },
  { key: "trad_ud_black", group: "traditional", slot: "top", color: "black", name: "Black up & down set", priority: 2, look: "Pairs with an accent fila (wine or gold).", search: "men black native up and down" },
  { key: "trad_fila_navy", group: "traditional", slot: "cap", color: "navy", name: "Fila in your set's fabric", priority: 2, look: "Ask the tailor to make one from the leftover fabric.", search: "yoruba fila cap men" },
  { key: "trad_loafers", group: "traditional", slot: "shoe", color: "black", name: "Black leather loafers or slip-ons", priority: 2, look: "Sleek, thin sole; no bulky sneakers with native.", search: "men black leather loafers native wear" },
  { key: "trad_agbada_navy", group: "traditional", slot: "layer", color: "navy", name: "Navy agbada (over the navy set)", priority: 3, look: "Full length, clears the ankle; tonal with the set keeps the line.", search: "yoruba men navy agbada" },
  { key: "trad_ud_cream", group: "traditional", slot: "top", color: "cream", name: "Cream up & down set", priority: 3, look: "Light fabric for hot days and daytime events.", search: "men cream native up and down" },
  { key: "trad_agbada_cream", group: "traditional", slot: "layer", color: "cream", name: "Cream agbada", priority: 3, look: "Goes over cream or black; finish with a gold aso-oke fila.", search: "men cream agbada" },
  { key: "trad_fila_accent", group: "traditional", slot: "cap", color: "wine", name: "Accent fila (wine or gold aso-oke)", priority: 3, look: "The one accent on a black or cream set.", search: "aso oke fila men wine gold" },
];

// Native wear: notes for the traditional occasions.
const TRAD_NOTES = [
  "Have it sewn to your measurements: the tailor solves the length problem. Ask for a straight sokoto, and an agbada that clears the ankle.",
  "Tonal (set, fila and agbada in one color family) keeps the long line, same as everyday wear.",
  "One accent at most: usually the fila, or the agbada over a neutral set.",
  "Leather loafers or slip-ons with a thin sole; no sneakers with agbada.",
];

const TALL_NOTE = "Shop tall sizes and long inseams; brands with tall ranges save a trip to the tailor. Fit first: sleeve, inseam and hem length matter more than brand.";

module.exports = { COLORS, TONAL, STRUCTURES, SILHOUETTE, OCCASIONS, LOOKS, CORE, TALL_NOTE, TRAD_NOTES };
