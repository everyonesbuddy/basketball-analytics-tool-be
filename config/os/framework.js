/**
 * The personal OS's written content: the goal framework, the six categories,
 * the two weekday schedules and the weekend, and the quotes. Static on
 * purpose: it changes rarely, and when it does it's an edit here.
 */

// One active goal per category. Window length in months.
const CATEGORIES = [
  { key: "P1", name: "Physical 1", group: "Physical", months: 1, about: "Health, fitness, energy, body, discipline" },
  { key: "P2", name: "Physical 2", group: "Physical", months: 1, about: "Secondary fitness or health goal" },
  { key: "PF1", name: "Professional/Financial 1", group: "Professional/Financial", months: 6, about: "Primary career, business or income" },
  { key: "PF2", name: "Professional/Financial 2", group: "Professional/Financial", months: 3, about: "Secondary business, venture or project" },
  { key: "PC1", name: "Personal/Creative 1", group: "Personal/Creative", months: 1, about: "Creativity, learning, identity, hobbies" },
  { key: "PC2", name: "Personal/Creative 2", group: "Personal/Creative", months: 1, about: "Secondary creative or personal project" },
];

// A block's `goal` is the category it's for; blocks without one are rest, prep or breaks.
const SCHEDULES = {
  v1: {
    name: "Monday, Wednesday, Friday",
    blocks: [
      { start: "06:00", end: "06:15", label: "Wake up & prep" },
      { start: "06:15", end: "07:00", label: "Physical goal 1", goal: "P1" },
      { start: "07:00", end: "08:30", label: "Morning preparation" },
      { start: "08:30", end: "12:00", label: "Professional/Financial 1, block 1", goal: "PF1" },
      { start: "12:00", end: "12:30", label: "Break" },
      { start: "12:30", end: "15:00", label: "Professional/Financial 1, block 2", goal: "PF1" },
      { start: "15:00", end: "17:30", label: "Professional/Financial 2", goal: "PF2" },
      { start: "17:30", end: "18:30", label: "Break" },
      { start: "18:30", end: "20:00", label: "Physical goal 2", goal: "P2" },
      { start: "20:00", end: "21:00", label: "Rest & evening break" },
      { start: "21:00", end: "21:45", label: "Personal/Creative goal 1", goal: "PC1" },
      { start: "21:45", end: "22:15", label: "Break" },
      { start: "22:15", end: "23:00", label: "Personal/Creative goal 2", goal: "PC2" },
      { start: "23:00", end: "24:00", label: "Rest & reflection" },
    ],
  },
  v2: {
    name: "Tuesday, Thursday",
    blocks: [
      { start: "06:00", end: "06:15", label: "Wake up & prep" },
      { start: "06:15", end: "07:00", label: "Physical goal 1", goal: "P1" },
      { start: "07:00", end: "08:30", label: "Morning preparation" },
      { start: "08:30", end: "11:00", label: "Professional/Financial 2", goal: "PF2" },
      { start: "11:00", end: "12:00", label: "Professional/Financial 1, block 1", goal: "PF1" },
      { start: "12:00", end: "12:30", label: "Break" },
      { start: "12:30", end: "17:30", label: "Professional/Financial 1, block 2", goal: "PF1" },
      { start: "17:30", end: "18:30", label: "Rest & evening break" },
      { start: "18:30", end: "19:15", label: "Personal/Creative goal 1", goal: "PC1" },
      { start: "19:15", end: "21:00", label: "Break" },
      { start: "21:00", end: "22:30", label: "Physical goal 2", goal: "P2" },
      { start: "22:30", end: "22:45", label: "Break" },
      { start: "22:45", end: "23:30", label: "Personal/Creative goal 2", goal: "PC2" },
      { start: "23:30", end: "24:00", label: "Rest & reflection" },
    ],
  },
  weekend: {
    name: "Saturday, Sunday",
    blocks: [
      { start: "06:00", end: "14:00", label: "Free time" },
      { start: "14:00", end: "14:30", label: "Weekly goal review", review: true },
      { start: "14:30", end: "24:00", label: "Free time" },
    ],
  },
};

const MODES = {
  m1: {
    name: "Mode 1",
    short: "Get the tool",
    what: "The goal is locked: a tool or prerequisite is missing. Work the prerequisite sub-goal to acquire it.",
  },
  m2single: {
    name: "Mode 2-Single",
    short: "Clear it outright",
    what: "You have the tool and one obstacle blocks the goal. Attack it directly to clear it (or a milestone) in one focused effort.",
  },
  m2tiered: {
    name: "Mode 2-Tiered",
    short: "Earn a % today",
    what: "You have the tool and the obstacle recurs in capped instances. Attack today's instance; a % gain is a real win, not a shortfall.",
  },
};

const FRAMEWORK = {
  intro:
    "Life is shaped by goals, obstacles and solutions. Every goal has an obstacle. Every obstacle has a principle of causation.",
  terms: [
    { term: "Goal", text: "A defined want or need: something I am trying to achieve." },
    { term: "Obstacle", text: "Something that possesses, controls or stands in the way of what I want. Animate obstacles are living beings; inanimate ones are external (tools, money, access, environment) or internal (discipline, clarity, confidence, energy)." },
    { term: "Principle of causation", text: "A solution is an agent using resources to apply a stimulus to an obstacle, producing the response that progresses the goal. With animate obstacles the stimulus is reward or punishment, depending on context." },
    { term: "Resources", text: "Every cause needs prerequisites. Missing prerequisites lock the goal; a locked goal creates a sub-goal to acquire them, then the original goal resumes." },
  ],
  goalStandard: ["Complete, specific outcome (not vague or ongoing)", "Scoped to fit the category's window", "Prerequisite tools can be identified", "Actionable through Mode 1, Mode 2-Single or Mode 2-Tiered"],
  classify: [
    "Single or tiered? Single: one focused action can clear it. Tiered: it recurs as separate capped instances, earning % toward 100%.",
    "If tiered, bounded or unbounded? Bounded means a finite number of instances (risk: running out before 100%).",
    "If tiered, sequential or parallel? Can several instances be pursued at once, for example with a team?",
    "Tool check: do I have the tool to attack this obstacle at all?",
  ],
  windowEnd: [
    { when: "Completed early", then: "Expand scope to fill the remaining time, or pull in a related tiered obstacle." },
    { when: "Completed at the window's end", then: "Set the next goal and classify its obstacle before scheduling." },
    { when: "Not completed", then: "Roll over one full window. If the tool hit a ceiling, the rollover starts in Mode 1." },
  ],
  focus:
    "Work as long as focus holds: 25, 45 or 90 minutes. When it dips, take 5 to 10 minutes: stretch, walk, breathe, no screens. Return and repeat until the block ends.",
  principles: [
    "Mode awareness: know which track you're on today, and why.",
    "Prerequisite honesty: be realistic about what tool is missing and how long it takes.",
    "Tiered honesty: a day's % gain is real progress.",
    "Ceiling vigilance: flat % gains mean the tool stopped working, not that you should push harder the same way.",
    "Windows are rhythm, not artificial deadlines.",
    "One goal per category, six at most.",
    "Completed goals produce tools for future goals.",
    "Only deviate from the schedule for emergencies, then get back on it.",
  ],
};

const QUOTES = [
  "What would the best performers in this field do to achieve my current goal? Do that, because it increases your chances. Anything else reduces them.",
  "Fear not… there is always a way, always an action to get your goal. If you execute the wrong action, you will be stopped, but now you know what the right action is not. Act now, act again.",
  "You're always one right move within the right range of time from a hit, and a hit from a hot streak. Don't miss your move. Don't miss your time. But if you do, go again. Keep moving. Never give up.",
];

module.exports = { CATEGORIES, SCHEDULES, MODES, FRAMEWORK, QUOTES };
