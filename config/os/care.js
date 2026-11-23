/**
 * Care ideas for a wife or partner: services to book, outings, small
 * gestures. Written once; the suggester picks from these.
 *
 * size:     "small" (a gesture, under ~$40 or an hour) or "big" (a booking or outing)
 * kind:     pamper, active, social, quality (time together), service (take something off her plate), words, surprise
 * price:    rough US cost for planning; 0 when it only costs time
 * lead:     days ahead to book or arrange it
 * find:     what to search on a map or booking site ("near me" is added), or null
 * how:      one line on doing it well
 */
const CARE_IDEAS = [
  // Pamper
  { key: "pedicure", title: "Book her a pedicure", size: "big", kind: "pamper", price: 45, lead: 3, find: "pedicure salon", how: "Book it, pay ahead, and tell her the time. Bonus: add a manicure." },
  { key: "mani_pedi", title: "Mani and pedi, together or for her and a friend", size: "big", kind: "pamper", price: 80, lead: 4, find: "nail salon", how: "Booking her best friend too turns it into an afternoon." },
  { key: "massage", title: "Book her a massage", size: "big", kind: "pamper", price: 90, lead: 5, find: "massage spa", how: "Ask for 60 or 90 minutes; handle the kids and the house that afternoon." },
  { key: "facial", title: "Book her a facial", size: "big", kind: "pamper", price: 85, lead: 5, find: "facial spa", how: "Pair it with a quiet evening with no chores waiting." },
  { key: "spa_day", title: "A full spa day", size: "big", kind: "pamper", price: 180, lead: 10, find: "day spa package", how: "Save this for a big moment or a hard season. Clear her whole day." },
  { key: "hair_day", title: "Pay for her next hair appointment", size: "big", kind: "pamper", price: 120, lead: 7, find: "hair salon braids", how: "Ask her stylist for the booking; you just pay and cover home." },
  { key: "home_spa", title: "Run a home spa night", size: "small", kind: "pamper", price: 25, lead: 1, find: null, how: "Run the bath, candles, face mask, her playlist; kids in bed, phone away." },
  { key: "foot_rub", title: "Give her a foot rub", size: "small", kind: "pamper", price: 0, lead: 0, find: null, how: "No reason needed. Lotion, 15 minutes, her show on." },

  // Active
  { key: "spin", title: "Book her a spin class", size: "big", kind: "active", price: 30, lead: 2, find: "spin class cycling studio", how: "Book a first-timer class or a class pack; offer to go together." },
  { key: "pilates", title: "Book her a Pilates or barre class", size: "big", kind: "active", price: 35, lead: 2, find: "pilates barre studio", how: "Many studios do a cheap intro week; buy it for her." },
  { key: "yoga", title: "A yoga class or a month of classes", size: "big", kind: "active", price: 30, lead: 2, find: "yoga studio", how: "A month pass is a gift that keeps going." },
  { key: "dance_class", title: "Book a dance class together", size: "big", kind: "active", price: 50, lead: 5, find: "salsa or afrobeats dance class", how: "Laughing at yourself together is the point." },
  { key: "walk", title: "Take her on an evening walk", size: "small", kind: "active", price: 0, lead: 0, find: "scenic walking trail park", how: "Phones in pockets; ask about her week and just listen." },
  { key: "hike", title: "A day hike or nature trail", size: "big", kind: "active", price: 20, lead: 3, find: "hiking trail", how: "Pack the snacks and the water; she just shows up." },

  // Social
  { key: "book_club", title: "Book her into a book club meetup", size: "big", kind: "social", price: 25, lead: 7, find: "book club meetup", how: "Buy the book for her too, and cover home on the night." },
  { key: "girls_brunch", title: "Pay for brunch with her friends", size: "big", kind: "social", price: 80, lead: 5, find: "brunch restaurant", how: "Message one of her friends to organize it; you pay and keep it a surprise." },
  { key: "paint_sip", title: "Paint and sip night for her and a friend", size: "big", kind: "social", price: 70, lead: 7, find: "paint and sip class", how: "Two tickets; she picks who goes." },
  { key: "workshop", title: "A workshop she'd enjoy (pottery, cooking, floral)", size: "big", kind: "social", price: 75, lead: 7, find: "pottery or floral workshop", how: "Go together, or book her and a friend." },
  { key: "her_event", title: "Tickets to something she loves", size: "big", kind: "social", price: 100, lead: 14, find: "concerts and comedy shows", how: "Check her favorite artists and comedians; see Events & concerts too." },

  // Quality time
  { key: "date_night", title: "Plan a date night, start to finish", size: "big", kind: "quality", price: 120, lead: 5, find: "romantic restaurant", how: "You book the table, the babysitter and the ride. She only gets dressed." },
  { key: "picnic", title: "A picnic in the park", size: "small", kind: "quality", price: 30, lead: 1, find: "park with picnic area", how: "Blanket, her favorite snacks, a speaker. Ten minutes to pack." },
  { key: "movie_night", title: "Movie night at home, her pick", size: "small", kind: "quality", price: 10, lead: 0, find: null, how: "Her movie, her snacks, no phones, kids asleep." },
  { key: "breakfast", title: "Breakfast in bed", size: "small", kind: "quality", price: 15, lead: 0, find: null, how: "Weekend morning; let her sleep in first." },
  { key: "cook_favorite", title: "Cook her favorite meal", size: "small", kind: "quality", price: 25, lead: 1, find: null, how: "Ask her mum or sister for the recipe if you have to." },
  { key: "weekend_away", title: "A weekend away, just you two", size: "big", kind: "quality", price: 400, lead: 21, find: "weekend getaway bed and breakfast", how: "Sort the kids, the time off and the booking before you tell her." },
  { key: "sunset", title: "Watch the sunset somewhere nice", size: "small", kind: "quality", price: 0, lead: 0, find: "sunset viewpoint", how: "Bring something warm to drink." },

  // Service: take something off her plate
  { key: "cleaning", title: "Book a house cleaning", size: "big", kind: "service", price: 120, lead: 4, find: "house cleaning service", how: "Book it on a day she'd normally clean." },
  { key: "her_chores", title: "Do the chore she hates most, all week", size: "small", kind: "service", price: 0, lead: 0, find: null, how: "Without being asked and without announcing it." },
  { key: "kids_out", title: "Take the kids out for the afternoon", size: "small", kind: "service", price: 20, lead: 0, find: "kids activities", how: "Give her three quiet hours at home to do whatever she wants." },
  { key: "car_wash", title: "Get her car washed and filled up", size: "small", kind: "service", price: 30, lead: 0, find: "car wash", how: "Do it quietly; she'll notice." },
  { key: "meal_prep", title: "Order a week of meal prep", size: "big", kind: "service", price: 90, lead: 3, find: "meal prep delivery", how: "Her favorite cuisine; nobody cooks for a week." },
  { key: "sleep_in", title: "Let her sleep in, you take the morning", size: "small", kind: "service", price: 0, lead: 0, find: null, how: "Kids, breakfast, house, all yours until noon." },

  // Words
  { key: "letter", title: "Write her a handwritten letter", size: "small", kind: "words", price: 0, lead: 0, find: null, how: "Three things you love about her and one memory. Leave it on her pillow." },
  { key: "notes", title: "Hide little notes for her to find", size: "small", kind: "words", price: 0, lead: 0, find: null, how: "Mirror, handbag, lunch, car. Short and specific." },
  { key: "public_praise", title: "Praise her in front of family or friends", size: "small", kind: "words", price: 0, lead: 0, find: null, how: "Something specific she did well this month." },

  // Surprise
  { key: "flowers", title: "Flowers, for no reason", size: "small", kind: "surprise", price: 35, lead: 0, find: "florist", how: "Her favorite flowers, delivered to work makes it a moment." },
  { key: "treat", title: "Bring home her favorite treat", size: "small", kind: "surprise", price: 10, lead: 0, find: null, how: "The snack or drink she always picks for herself." },
  { key: "small_gift", title: "Something she mentioned wanting", size: "small", kind: "surprise", price: 40, lead: 2, find: null, how: "Keep a note of things she mentions; this is where it pays off." },
  { key: "playlist", title: "Make her a playlist", size: "small", kind: "surprise", price: 0, lead: 0, find: null, how: "Songs from your story together, in order." },
];

const KINDS = {
  pamper: "Pamper",
  active: "Active",
  social: "With friends",
  quality: "Time together",
  service: "Take it off her plate",
  words: "Words",
  surprise: "Surprise",
};

// How often to suggest, by default: a small gesture weekly, something booked monthly.
const DEFAULTS = { smallEveryDays: 7, bigEveryDays: 30, circleEveryDays: 45, circleBudget: 50 };

// Who's in the gift circle by default (the relationships from gifting).
/** How each kind of person reads in a sentence: "Send an uncle something". */
const CIRCLE_PHRASE = {
  mother: "your mom",
  father: "your dad",
  mother_in_law: "your mother-in-law",
  father_in_law: "your father-in-law",
  grandmother: "a grandma",
  grandfather: "a grandpa",
  aunt: "an aunt",
  uncle: "an uncle",
  sibling: "a brother or sister",
  cousin: "a cousin",
  friend: "a friend",
  colleague: "a colleague or host",
  child: "a child in the family",
};

const CIRCLE_RELATIONSHIPS = ["mother", "father", "mother_in_law", "father_in_law", "grandmother", "grandfather", "aunt", "uncle", "sibling", "cousin", "friend", "colleague"];

module.exports = { CIRCLE_PHRASE, CARE_IDEAS, KINDS, DEFAULTS, CIRCLE_RELATIONSHIPS };
