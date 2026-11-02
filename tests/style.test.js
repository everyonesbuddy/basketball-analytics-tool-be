const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../config/os/style");
const st = require("../utils/os/style");

const W = (slot, color, name) => ({ _id: `${slot}-${color}-${name || ""}`, slot, color, name: name || `${color} ${slot}` });

test("guide is consistent: every look and core piece uses known colors, slots, occasions and structures", () => {
  for (const l of S.LOOKS) {
    assert.ok(S.STRUCTURES[l.structure], l.key);
    if (l.structure === "monochrome") assert.ok(S.TONAL[l.family], l.key);
    for (const o of l.occasions) assert.ok(S.OCCASIONS[o], `${l.key} → ${o}`);
    for (const [slot, color] of l.pieces) {
      assert.ok(["top", "bottom", "layer", "shoe", "cap"].includes(slot), l.key);
      assert.ok(S.COLORS[color], `${l.key} → ${color}`);
    }
  }
  for (const c of S.CORE) assert.ok(S.COLORS[c.color], c.key);
  for (const [k, o] of Object.entries(S.OCCASIONS)) {
    for (const s of o.structures) assert.ok(S.STRUCTURES[s], k);
    assert.ok(S.LOOKS.some((l) => l.occasions.includes(k)), `no look for ${k}`);
  }
});

test("work only suggests monochrome; going out mixes monochrome and contrast", () => {
  const work = st.suggestOutfits({ occasion: "work", date: "2026-11-02" });
  assert.ok(work.outfits.length >= 2);
  assert.ok(work.outfits.every((o) => o.structure === "monochrome"));
  const out = st.suggestOutfits({ occasion: "going_out", date: "2026-11-02" });
  const kinds = new Set(out.outfits.map((o) => o.structure));
  assert.ok(kinds.has("monochrome") && kinds.has("contrast"));
});

test("weather decides the layer", () => {
  const hot = st.suggestOutfits({ occasion: "everyday", weather: { tempF: 88 }, date: "2026-07-01" });
  assert.ok(hot.outfits.every((o) => !o.pieces.some((p) => p.slot === "layer")));
  const cool = st.suggestOutfits({ occasion: "everyday", weather: { tempF: 55 }, date: "2026-11-02" });
  const layered = cool.outfits.find((o) => o.pieces.some((p) => p.slot === "layer"));
  assert.ok(layered && layered.pieces.find((p) => p.slot === "layer").optional === false);
  const mild = st.suggestOutfits({ occasion: "everyday", weather: { tempF: 70 }, date: "2026-05-02" });
  assert.ok(mild.outfits.some((o) => o.pieces.some((p) => p.slot === "layer" && p.optional)));
  const wet = st.suggestOutfits({ occasion: "everyday", weather: { tempF: 70, rain: true }, date: "2026-05-02" });
  assert.ok(wet.outfits[0].notes.some((n) => /boot/.test(n)));
});

test("uses your wardrobe: exact color first, then the same family; missing pieces are flagged", () => {
  const wardrobe = [W("top", "black", "Heavy black tee"), W("bottom", "black", "Black straight jeans"), W("shoe", "black", "Black sneakers"), W("layer", "grey", "Grey overshirt")];
  const r = st.suggestOutfits({ occasion: "everyday", weather: { tempF: 55 }, wardrobe, date: "2026-11-02" });
  const black = r.outfits.find((o) => o.key === "tonal_black") || st.suggestOutfits({ occasion: "going_out", weather: { tempF: 55 }, wardrobe, date: "2026-11-02" }).outfits.find((o) => o.key === "tonal_black");
  assert.ok(black);
  assert.equal(black.pieces.find((p) => p.slot === "top").item.name, "Heavy black tee");
  // charcoal layer asked for; the grey overshirt is the same family
  assert.equal(black.pieces.find((p) => p.slot === "layer").item.name, "Grey overshirt");
  assert.equal(black.owned, black.total);
  const none = st.suggestOutfits({ occasion: "everyday", date: "2026-11-02" });
  assert.ok(none.outfits[0].pieces.every((p) => p.missing));
});

test("owned outfits rank higher, and a look worn yesterday drops", () => {
  const wardrobe = [W("top", "white"), W("bottom", "denim"), W("shoe", "white"), W("layer", "olive")];
  const r = st.suggestOutfits({ occasion: "everyday", wardrobe, date: "2026-11-02" });
  assert.equal(r.outfits[0].key, "white_denim_olive");
  const again = st.suggestOutfits({ occasion: "everyday", wardrobe, date: "2026-11-02", recent: [{ date: "2026-11-01", lookKey: "white_denim_olive" }] });
  assert.notEqual(again.outfits[0].key, "white_denim_olive");
});

test("chunky shoes only for streetwear", () => {
  const everyday = st.suggestOutfits({ occasion: "everyday", date: "2026-11-02" });
  for (const o of everyday.outfits) assert.ok(!/chunky/i.test(o.pieces.find((p) => p.slot === "shoe").desc), o.key);
  const street = st.suggestOutfits({ occasion: "street", date: "2026-11-02" });
  assert.ok(street.outfits.every((o) => /chunky/i.test(o.pieces.find((p) => p.slot === "shoe").desc)));
});

test("gaps: owned pieces drop off, the next buys are the top-priority missing ones", () => {
  const g0 = st.gaps({ wardrobe: [] });
  assert.equal(g0.owned, 0);
  assert.equal(g0.missing, S.CORE.length);
  assert.ok(g0.next.every((n) => n.priority === 1));
  const g1 = st.gaps({ wardrobe: [W("top", "black"), W("top", "white"), W("bottom", "black"), W("bottom", "denim"), W("shoe", "black"), W("shoe", "white")] });
  assert.equal(g1.owned, 6);
  assert.ok(g1.next.every((n) => n.priority === 2));
  assert.equal(g1.items[g1.items.length - 1].owned, true);
});

test("traditional: up & down has no layer, agbada is always on whatever the weather, native pieces stay native", () => {
  const simple = st.suggestOutfits({ occasion: "trad_simple", weather: { tempF: 40 }, date: "2026-11-02" });
  assert.ok(simple.outfits.length >= 2);
  assert.ok(simple.outfits.every((o) => !o.pieces.some((p) => p.slot === "layer")));
  assert.ok(simple.outfits.every((o) => o.pieces.some((p) => p.slot === "cap")));
  const hot = st.suggestOutfits({ occasion: "trad_agbada", weather: { tempF: 92 }, date: "2026-11-02" });
  assert.ok(hot.outfits.every((o) => o.pieces.some((p) => p.slot === "layer" && !p.optional)));
  assert.ok(hot.outfits[0].notes.some((n) => /lightest fabric/.test(n)));
  const kinds = new Set(hot.outfits.map((o) => o.structure));
  assert.ok(kinds.size >= 2);

  const wardrobe = [W("top", "navy", "Navy tee"), { ...W("top", "navy", "Navy buba"), trad: true }, { ...W("bottom", "navy", "Navy sokoto"), trad: true }, W("shoe", "black", "Black loafers")];
  const navy = st.suggestOutfits({ occasion: "trad_simple", wardrobe, date: "2026-11-02" }).outfits.find((o) => o.key === "trad_navy_ud");
  assert.equal(navy.pieces.find((p) => p.slot === "top").item.name, "Navy buba");
  assert.equal(navy.pieces.find((p) => p.slot === "shoe").item.name, "Black loafers");
  const everyday = st.suggestOutfits({ occasion: "smart", wardrobe, date: "2026-11-02" });
  for (const o of everyday.outfits) assert.ok(!o.pieces.some((p) => p.item && /buba|sokoto/i.test(p.item.name)), o.key);
  // gaps: native pieces only match native items, and "buy next" stays everyday
  const g = st.gaps({ wardrobe });
  assert.equal(g.items.find((i) => i.key === "trad_ud_navy").owned, true);
  assert.equal(g.items.find((i) => i.key === "tee_navy").owned, true);
  assert.ok(g.next.every((n) => n.group !== "traditional"));
});
