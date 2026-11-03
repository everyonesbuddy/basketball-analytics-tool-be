/**
 * Which push notifications are due right now, as a pure function. A few
 * useful nudges a day, never noise:
 *  - brief:   morning brief at your chosen time
 *  - blocks:  when a goal block starts
 *  - checkin: when a goal block ends and you haven't checked in (with buttons)
 *  - review:  weekly review at its slot, and Sunday evening if still not done
 *  - meals:   tonight's planned dinner in the afternoon; weekend "plan next week"
 *  - gifts:   birthdays/anniversaries 7 days, 1 day and on the day; shopping/packing milestones
 *  - events:  shows in the next days and tickets going on sale
 * Quiet hours and a daily cap apply; each notification has a key so it's
 * sent once.
 */
const LONG_DAY = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

const DEFAULTS = {
  brief: true,
  blocks: true,
  checkin: true,
  review: true,
  meals: true,
  gifts: true,
  events: true,
  briefTime: "06:00",
  quietStart: "23:00",
  quietEnd: "06:00",
  dailyCap: 12,
};

const toMin = (hhmm) => {
  const [h, m] = String(hhmm || "0:0").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Is `minutes` inside quiet hours (which may wrap past midnight)? */
function inQuiet(minutes, start, end) {
  const s = toMin(start);
  const e = toMin(end);
  if (s === e) return false;
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}

/** Did `hhmm` happen in the last `window` minutes (now inclusive)? */
const justNow = (minutes, hhmm, window) => {
  const t = toMin(hhmm);
  return minutes >= t && minutes < t + window;
};

/**
 * @param today   buildToday() output for now (blocks, goals, focus, date, weekday, reviewDone)
 * @param minutes minutes since local midnight
 * @param raw     { gifts, shows, meals } reminders with their ids
 * @param dinner  tonight's planned dinner { name, mode } or null
 * @param settings notification settings
 * @param sentToday number already sent today (for the cap)
 * @param window  how far back to look, in minutes (the run interval plus slack)
 */
function dueNotifications({ today, minutes, raw = {}, dinner = null, settings = {}, sentToday = 0, window = 15, now = new Date() }) {
  const s = { ...DEFAULTS, ...settings };
  const out = [];
  const date = today.date;
  const add = (n) => out.push({ url: "/", ...n });

  if (s.brief && justNow(minutes, s.briefTime, window)) {
    const first = today.blocks.find((b) => b.category && b.goalTitle && toMin(b.start) >= toMin(s.briefTime));
    const extras = [];
    if (dinner) extras.push(`Dinner: ${dinner.name}${dinner.mode === "order" ? " (order in)" : ""}`);
    for (const g of raw.gifts || []) if (g.kind === "date" && g.days === 0) extras.push(g.text);
    for (const e of raw.shows || []) if (e.kind === "event" && /today/.test(e.text)) extras.push(e.text);
    const body =
      today.dayType === "weekend"
        ? ["Weekend: free time, weekly review at 2:00 PM.", ...extras].join("\n")
        : [first ? `First up ${clock(first.start)}: ${first.goalTitle}` : "No goal blocks set yet.", ...extras].join("\n");
    add({ key: `brief:${date}`, kind: "brief", title: `Good morning. ${LONG_DAY[today.weekday] || today.weekday}'s plan`, body });
  }

  for (const b of today.blocks) {
    if (!b.category || !b.goalId) continue;
    if (s.blocks && justNow(minutes, b.start, window) && !b.loggedToday) {
      add({ key: `block:${date}:${b.start}`, kind: "blocks", title: `Now: ${b.category} · ${b.goalTitle}`, body: `Until ${clock(b.end)}. Move it forward.`, tag: `block-${b.start}` });
    }
    if (s.checkin && justNow(minutes, b.end === "24:00" ? "23:59" : b.end, window) && !b.loggedToday) {
      add({
        key: `checkin:${date}:${b.start}`,
        kind: "checkin",
        title: `Done with ${b.category}?`,
        body: `${b.goalTitle}: moved it forward today, or cleared it?`,
        tag: `block-${b.start}`,
        checkin: { goalId: b.goalId, block: b.start, date },
        actions: [
          { action: "progress", title: "Moved it forward" },
          { action: "cleared", title: "Cleared it" },
        ],
      });
    }
  }

  if (s.review && !today.reviewDone) {
    const rb = today.blocks.find((b) => b.review);
    if (rb && justNow(minutes, rb.start, window)) add({ key: `review:${date}`, kind: "review", title: "Weekly review: 30 minutes", body: "Where each goal stands this week, and anything to adjust.", url: "/review" });
    if (today.weekday === "Sun" && justNow(minutes, "18:00", window)) add({ key: `review-late:${date}`, kind: "review", title: "Weekly review is still due", body: "30 minutes before Monday: where each goal stands this week.", url: "/review" });
  }

  if (s.meals) {
    if (dinner && justNow(minutes, "16:30", window)) add({ key: `dinner:${date}`, kind: "meals", title: `Tonight: ${dinner.name}`, body: dinner.mode === "order" ? "It's an order-in night. Mention the shellfish allergy." : "Time to start or defrost what you need.", url: "/food" });
    if ((raw.meals || []).length && today.weekday === "Sun" && justNow(minutes, "16:00", window)) add({ key: `mealplan:${date}`, kind: "meals", title: "Plan next week's dinners", body: "Two minutes now: dinners picked and the grocery list made.", url: "/food/week" });
  }

  if (s.gifts && justNow(minutes, "09:00", window)) {
    for (const g of raw.gifts || []) {
      const milestone = g.kind === "date" ? [7, 1, 0].includes(g.days) : [21, 14, 7, 3, 1].includes(g.days);
      if (milestone) add({ key: `gift:${g.personId || g.planId}:${g.kind}:${g.days}:${date.slice(0, 7)}`, kind: "gifts", title: "Gifting", body: g.text, url: g.planId ? `/gifting/plan/${g.planId}` : "/gifting" });
    }
  }

  if (s.events) {
    for (const e of raw.shows || []) {
      if (e.kind === "onsale" && e.at) {
        // 30 minutes before tickets go on sale.
        const at = new Date(e.at);
        const diff = (at.getTime() - now.getTime()) / 60000;
        if (diff > 0 && diff <= 30 + window && diff > 30 - window) add({ key: `onsale:${e.savedId}`, kind: "events", title: "Tickets on sale soon", body: e.text, url: "/events/saved" });
      } else if (e.kind === "event" && justNow(minutes, "09:00", window)) {
        add({ key: `show:${e.savedId}:${date}`, kind: "events", title: "Coming up", body: e.text, url: "/events/saved" });
      }
    }
  }

  // Quiet hours (check-ins and on-sale alerts still respect them) and the daily cap.
  const allowed = inQuiet(minutes, s.quietStart, s.quietEnd) ? [] : out;
  return allowed.slice(0, Math.max(0, s.dailyCap - sentToday));
}

function clock(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, "0")} ${h < 12 || h === 24 ? "AM" : "PM"}`;
}

module.exports = { DEFAULTS, dueNotifications, inQuiet, clock };
