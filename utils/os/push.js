/**
 * Sending web push (the standard browser push service; free). Needs a VAPID
 * key pair: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (make them once with
 * `npx web-push generate-vapid-keys`), and VAPID_SUBJECT (mailto:you@…).
 */
const webpush = require("web-push");

const configured = () => Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
let ready = false;
function setup() {
  if (ready || !configured()) return configured();
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:personal-os@example.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  ready = true;
  return true;
}

/** Send one payload to one subscription. Returns "ok", "gone" (remove it) or "failed". */
async function send(sub, payload) {
  if (!setup()) return "failed";
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(payload), { TTL: 60 * 60, urgency: "high" });
    return "ok";
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) return "gone";
    return "failed";
  }
}

module.exports = { configured, send, publicKey: () => process.env.VAPID_PUBLIC_KEY || "" };
