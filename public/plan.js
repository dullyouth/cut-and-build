// Static program blueprint — runs entirely in the browser (no server).
// Two phases: CUT (active) and BULK (queued). User logs live in IndexedDB (store.js).

// Phase-specific macro targets.
export const CUT_TARGETS = { cal_target: 2300, protein_target: 220, carb_target: 185, fat_target: 75 };
export const BULK_TARGETS = { cal_target: 2900, protein_target: 200, carb_target: 330, fat_target: 80 };

export const DEFAULT_SETTINGS = {
  start_weight: 195,
  goal_weight: 175,
  phase: 'cut',
  ...CUT_TARGETS,
};

// Form videos, keyed by exercise name. Existing entries were verified live via
// YouTube oEmbed; the 8 new hypertrophy lifts are patched in from the video workflow.
const yt = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q + ' proper form')}`;
export const VIDEOS = {
  // — verified —
  'Bench Press': { url: 'https://www.youtube.com/watch?v=vcBig73ojpE', title: 'How To Get A Huge Bench Press with Perfect Technique', channel: 'Jeff Nippard' },
  'Barbell / DB Row': { url: 'https://www.youtube.com/watch?v=axoeDmW0oAY', title: 'How To Build a Thick Back With Perfect Rowing Technique', channel: 'Jeff Nippard' },
  'Overhead Press': { url: 'https://www.youtube.com/watch?v=eNFXEEdfQp4', title: 'How To Press (Overhead Press)', channel: 'Alan Thrall' },
  'Pull-ups / Lat work': { url: 'https://www.youtube.com/watch?v=Hdc7Mw6BIEE', title: 'The Best Way To Do Pull Ups For A Wide Back', channel: 'Jeff Nippard' },
  'Back Squat': { url: 'https://www.youtube.com/watch?v=SbgHegC6lEs', title: 'How to Back Squat | #AskSquatU Show Ep. 10', channel: 'Squat University' },
  'Romanian Deadlift': { url: 'https://www.youtube.com/watch?v=_oyxCn2iSjU', title: 'How To Do Romanian Deadlifts (RDLs) With Perfect Technique', channel: 'Jeff Nippard' },
  'DB Split Squat / Lunge': { url: 'https://www.youtube.com/watch?v=hiLF_pF3EJM', title: 'Stop F*cking Up Bulgarian Split Squats (PROPER FORM!)', channel: 'ATHLEAN-X' },
  'Calf Raise': { url: 'https://www.youtube.com/watch?v=97NbelB5yvQ', title: 'How to do Standing Calf Raises: Proper Form', channel: 'Canadian Protein' },
  'Deadlift': { url: 'https://www.youtube.com/watch?v=wYREQkVtvEc', title: 'How To Deadlift: Starting Strength 5 Step Deadlift', channel: 'Alan Thrall' },
  'Incline DB Press': { url: 'https://www.youtube.com/watch?v=hChjZQhX1Ls', title: 'How To: Dumbbell Incline Press | 3 Golden Rules', channel: 'ScottHermanFitness' },
  'DB Row': { url: 'https://www.youtube.com/watch?v=pYcpY20QaE8', title: 'How To: Dumbbell Bent-Over Row (Single-Arm)', channel: 'ScottHermanFitness' },
  'Goblet Squat': { url: 'https://www.youtube.com/watch?v=k_EhLGvM8TQ', title: 'How to Perform Goblet Squats | Tutorial', channel: 'Buff Dudes' },
  'Core (plank / leg raise)': { url: 'https://www.youtube.com/watch?v=A2b2EmIg0dA', title: 'How To Plank (Proper Form | Cues | Progressions)', channel: 'E3 Rehab' },
  // Hammer curl reuses the verified ScottHermanFitness hammer-curl tutorial.
  'Hammer Curl': { url: 'https://www.youtube.com/watch?v=zC3nLlEvin4', title: 'How To: Dumbbell Hammer Curl', channel: 'ScottHermanFitness' },
  // — new lifts: verified live via YouTube oEmbed —
  'DB Lateral Raise': { url: 'https://www.youtube.com/watch?v=3VcKaXpzqRo', title: 'How To: Dumbbell Side Lateral Raise', channel: 'ScottHermanFitness' },
  'DB Curl': { url: 'https://www.youtube.com/watch?v=ykJmrZ5v0Oo', title: 'How to Do a Dumbbell Biceps Curl', channel: 'Howcast' },
  'Overhead Triceps Extension': { url: 'https://www.youtube.com/watch?v=X-iV-cG8cYs', title: 'How To PROPERLY Overhead Dumbbell Tricep Extension', channel: 'Colossus Fitness' },
  'DB Hip Thrust': { url: 'https://www.youtube.com/watch?v=xDmFkJxPzeM', title: 'How To Build Great Glutes with Perfect Hip Thrust Technique', channel: 'Jeff Nippard' },
  'DB Rear Delt Fly': { url: 'https://www.youtube.com/watch?v=Lec8GC1SiS8', title: 'Rear Delt Bent Over Flies: How To', channel: 'Hammer Fitness' },
  'Skullcrusher': { url: 'https://www.youtube.com/watch?v=tj81tVq3wLo', title: 'How to Do Lying Triceps Extension (Skull Crusher)', channel: 'FIT.nl' },
  'Front Squat': { url: 'https://www.youtube.com/watch?v=v-mQm_droHg', title: 'How To Front Squat: Build Bigger Quads & A Stronger Squat', channel: 'Jeff Nippard' },
  'Walking Lunge': { url: 'https://www.youtube.com/watch?v=Pbmj6xPo-Hw', title: 'Walking Lunges Exercise Tutorial', channel: 'Buff Dudes Workouts' },
};

const withVideo = (ex) => ({ ...ex, ...(VIDEOS[ex.name] ? { video: VIDEOS[ex.name] } : {}) });
const build = (sessions) => sessions.map((s) => ({ ...s, exercises: s.exercises.map(withVideo) }));

// ── CUT · 3-day Full Body (each muscle ~3×/week, moderate volume, high frequency) ──
const CUT_STRENGTH = build([
  {
    key: 'A', title: 'Full Body A', day: 'Mon', focus: 'Squat · push · pull',
    exercises: [
      { name: 'Back Squat', scheme: '3 × 6–8' },
      { name: 'Bench Press', scheme: '3 × 6–8' },
      { name: 'Barbell / DB Row', scheme: '3 × 8–10' },
      { name: 'DB Lateral Raise', scheme: '3 × 15–20' },
      { name: 'DB Curl', scheme: '3 × 10–12' },
      { name: 'Calf Raise', scheme: '3 × 12–15' },
    ],
  },
  {
    key: 'B', title: 'Full Body B', day: 'Wed', focus: 'Hinge · overhead · vertical pull',
    exercises: [
      { name: 'Romanian Deadlift', scheme: '3 × 8–10' },
      { name: 'Overhead Press', scheme: '3 × 6–8' },
      { name: 'Pull-ups / Lat work', scheme: '3 × 8–10' },
      { name: 'Incline DB Press', scheme: '3 × 10–12' },
      { name: 'Hammer Curl', scheme: '3 × 10–12' },
      { name: 'Core (plank / leg raise)', scheme: '3 sets' },
    ],
  },
  {
    key: 'C', title: 'Full Body C', day: 'Fri', focus: 'Deadlift · unilateral · arms',
    exercises: [
      { name: 'Deadlift', scheme: '3 × 5' },
      { name: 'Incline DB Press', scheme: '3 × 8–10' },
      { name: 'DB Split Squat / Lunge', scheme: '3 × 10–12 /leg' },
      { name: 'DB Row', scheme: '3 × 10–12' },
      { name: 'DB Lateral Raise', scheme: '3 × 15–20' },
      { name: 'Overhead Triceps Extension', scheme: '3 × 12–15' },
    ],
  },
]);

const CUT_SCHEDULE = [
  { day: 'Mon', session: 'Full Body A (strength)', type: 'lift' },
  { day: 'Tue', session: 'Run — intervals', type: 'run' },
  { day: 'Wed', session: 'Full Body B (strength)', type: 'lift' },
  { day: 'Thu', session: 'Run — easy / Zone 2', type: 'run' },
  { day: 'Fri', session: 'Full Body C (strength)', type: 'lift' },
  { day: 'Sat', session: 'Run — longest, all easy', type: 'run' },
  { day: 'Sun', session: 'Rest / walk', type: 'rest' },
];

// ── BULK · 4-day Upper/Lower (each muscle 2×/week, higher volume ceiling) ──
const BULK_STRENGTH = build([
  {
    key: 'UA', title: 'Upper A', day: 'Mon', focus: 'Horizontal push / pull',
    exercises: [
      { name: 'Bench Press', scheme: '4 × 6–8' },
      { name: 'Barbell / DB Row', scheme: '4 × 8–10' },
      { name: 'Incline DB Press', scheme: '3 × 10–12' },
      { name: 'Pull-ups / Lat work', scheme: '3 × 10–12' },
      { name: 'DB Lateral Raise', scheme: '3 × 15–20' },
      { name: 'DB Curl', scheme: '3 × 10–12' },
      { name: 'Overhead Triceps Extension', scheme: '3 × 12–15' },
    ],
  },
  {
    key: 'LA', title: 'Lower A', day: 'Tue', focus: 'Quad emphasis',
    exercises: [
      { name: 'Back Squat', scheme: '4 × 6–8' },
      { name: 'Romanian Deadlift', scheme: '3 × 8–10' },
      { name: 'DB Split Squat / Lunge', scheme: '3 × 10–12 /leg' },
      { name: 'DB Hip Thrust', scheme: '3 × 12' },
      { name: 'Calf Raise', scheme: '4 × 12–15' },
      { name: 'Core (plank / leg raise)', scheme: '3 sets' },
    ],
  },
  {
    key: 'UB', title: 'Upper B', day: 'Thu', focus: 'Vertical / overhead',
    exercises: [
      { name: 'Overhead Press', scheme: '4 × 6–8' },
      { name: 'Pull-ups / Lat work', scheme: '4 × 8–10' },
      { name: 'Incline DB Press', scheme: '3 × 10–12' },
      { name: 'DB Rear Delt Fly', scheme: '3 × 12–15' },
      { name: 'DB Lateral Raise', scheme: '3 × 15–20' },
      { name: 'Hammer Curl', scheme: '3 × 10–12' },
      { name: 'Skullcrusher', scheme: '3 × 12–15' },
    ],
  },
  {
    key: 'LB', title: 'Lower B', day: 'Fri', focus: 'Hip / hamstring',
    exercises: [
      { name: 'Deadlift', scheme: '3 × 5' },
      { name: 'Front Squat', scheme: '3 × 8–10' },
      { name: 'Walking Lunge', scheme: '3 × 12 /leg' },
      { name: 'Romanian Deadlift', scheme: '3 × 10–12' },
      { name: 'Calf Raise', scheme: '4 × 15' },
      { name: 'Core (plank / leg raise)', scheme: '3 sets' },
    ],
  },
]);

const BULK_SCHEDULE = [
  { day: 'Mon', session: 'Upper A (strength)', type: 'lift' },
  { day: 'Tue', session: 'Lower A (strength)', type: 'lift' },
  { day: 'Wed', session: 'Run — easy / Zone 2', type: 'run' },
  { day: 'Thu', session: 'Upper B (strength)', type: 'lift' },
  { day: 'Fri', session: 'Lower B (strength)', type: 'lift' },
  { day: 'Sat', session: 'Run — easy', type: 'run' },
  { day: 'Sun', session: 'Rest / walk', type: 'rest' },
];

export const PHASES = {
  cut: {
    key: 'cut', label: 'Cut', goal: '195 → 175 · recomp',
    targets: CUT_TARGETS,
    note: 'Full Body 3×/week — high frequency, moderate volume. Build/retain muscle in a slight deficit; keep runs easy.',
    strength: CUT_STRENGTH,
    schedule: CUT_SCHEDULE,
  },
  bulk: {
    key: 'bulk', label: 'Bulk', goal: '175 → lean surplus',
    targets: BULK_TARGETS,
    note: 'Upper/Lower 4×/week — cash in the higher volume ceiling on a surplus. Aim +0.25–0.5 lb/week, progressive overload.',
    strength: BULK_STRENGTH,
    schedule: BULK_SCHEDULE,
  },
};

export const RUN_WEEKS = [
  { week: 1, interval: 'Run 0:30 / walk 2:00', note: 'Starting point. ~25 min total. Every step easy.' },
  { week: 2, interval: 'Run 1:00 / walk 2:00', note: 'Same easy pace — you should be able to talk.' },
  { week: 3, interval: 'Run 1:30 / walk 1:30', note: 'Run and walk now even. Keep it conversational.' },
  { week: 4, interval: 'Run 2:00 / walk 1:00', note: 'Running is now the bigger share.' },
  { week: 5, interval: 'Run 3:00 / walk 1:00', note: 'If this feels hard, repeat the week. No rush.' },
  { week: 6, interval: 'Run 5:00 / walk 1:00', note: 'Aerobic base building. Short, quick steps.' },
  { week: 7, interval: 'Run 8:00 / walk 1:00', note: 'Getting close to continuous.' },
  { week: 8, interval: 'Run 10:00 / walk 1:00', note: 'Then attempt 20–30 min continuous.' },
];

export const RUN_COACHING = [
  '5-min brisk walk to warm up, every time.',
  'Never jump more than one week at a time — repeat a week if it feels hard.',
  'Quick, light steps (~170–180/min). Land under your hips, not out front.',
  'Get fitted for real running shoes — cheapest injury prevention there is.',
  "New joint/shin pain that lingers past a session = back off a week, don't push through.",
];

// Protein-first, batch-prep daily template. Day total ≈ 2,274 kcal · 223p · 185c · 75f.
export const MEALS = [
  {
    slot: 'Breakfast', name: 'Savory Egg & Oat Bowl',
    calories: 400, protein: 46, carbs: 21, fat: 14,
    ingredients: ['2 whole eggs', '6 oz (¾ cup) liquid egg whites', '½ cup dry rolled oats', '0.5 oz shredded mozzarella or cheddar', 'salt, pepper, nonstick spray'],
    prep: [
      'Cook oats: ½ cup dry oats + 1 cup water, microwave 2–2.5 min. Salt for savory (or a dash of cinnamon).',
      'Heat a nonstick pan on medium; coat with spray.',
      'Whisk 2 eggs + 6 oz egg whites with salt & pepper; pour in.',
      'Scramble 2–3 min until just set, folding in the cheese the last 30 sec.',
      'Plate the eggs with the oats. Batch: pre-portion oats into jars, buy egg whites by the carton.',
    ],
  },
  {
    slot: 'Lunch', name: 'Chicken, Jasmine Rice & Broccoli Bowl',
    calories: 592, protein: 52, carbs: 53, fat: 20,
    ingredients: ['6 oz cooked chicken breast (~8 oz raw)', '1 cup cooked jasmine rice', '1.5 cups broccoli florets', '1 tbsp olive oil', '1 tbsp low-sodium soy sauce', '½ tsp garlic powder'],
    prep: [
      'Batch: season 2–3 lb raw chicken with garlic powder + salt, bake 425°F 22–25 min (165°F internal). Portion ~6 oz cooked each.',
      'Batch: cook a big pot of jasmine rice (rinsed, 1:1.5 rice:water); portion 1 cup each.',
      'Steam or microwave 1.5 cups broccoli 3–4 min until bright and tender-crisp.',
      'At mealtime: toss chicken + rice + broccoli with 1 tbsp olive oil and 1 tbsp soy sauce; reheat 90 sec.',
      'Optional: hot sauce, black pepper, or a squeeze of lemon.',
    ],
  },
  {
    slot: 'Dinner', name: 'Seared Sirloin, Potato & Green Beans',
    calories: 680, protein: 58, carbs: 48, fat: 28,
    ingredients: ['8 oz top sirloin, trimmed (raw; ~6 oz cooked)', '6 oz russet potato (1 small-medium)', '1.5 cups green beans', '1 tbsp olive oil', '½ tsp garlic powder', 'salt & pepper'],
    prep: [
      'Pat steak dry; season both sides with salt, pepper, garlic powder. Let it sit while the pan heats.',
      'Starch: microwave the whole potato 5–6 min (or bake a tray at 425°F ~40 min), then halve or cube.',
      'Heat 1 tbsp olive oil in a skillet on high. Sear steak 3–4 min/side for medium (135°F). Rest 5 min, slice against the grain.',
      'Steam or microwave green beans 4–5 min; season with salt.',
      'Meal-prep: sear 4 steaks and roast a tray of potatoes at once; reheat portions through the week.',
    ],
  },
  {
    slot: 'Post-Workout', name: 'Whey & Banana Recovery Bowl',
    calories: 296, protein: 34, carbs: 41, fat: 2,
    ingredients: ['¾ scoop (~23g) whey isolate', '1 medium banana', '5 oz non-fat Greek yogurt', '1 tsp honey', '6–8 oz cold water + ice'],
    prep: [
      'Batch: peel & slice ripe bananas, freeze flat in a bag for grab-and-go portions.',
      'Blend ¾ scoop whey, frozen banana, Greek yogurt, honey, water + ice 20–30 sec until smooth.',
      'Drink within ~30 min of finishing your lift.',
      'No blender: stir whey into the yogurt, slice banana on top, drizzle honey — eat as a bowl.',
    ],
  },
  {
    slot: 'Evening', name: 'Greek Yogurt Bowl, Berries & Almonds',
    calories: 306, protein: 33, carbs: 22, fat: 11,
    ingredients: ['10 oz (285g) non-fat Greek yogurt', '⅓ cup mixed berries', '¾ oz almonds (~16), chopped', 'pinch cinnamon (optional)'],
    prep: [
      'Scoop 285g non-fat Greek yogurt into a bowl (weigh once to learn the eyeball amount).',
      'Top with ⅓ cup berries; if frozen, microwave 30 sec so they soften into the yogurt.',
      'Scatter chopped almonds; dust with cinnamon.',
      'Batch: pre-portion 3–4 yogurt bowls Sunday; keep chopped almonds in a jar; add berries + nuts fresh (30 sec).',
    ],
  },
];

// Weekly grocery list (~7 days of the daily template above).
export const SHOPPING_LIST = [
  {
    category: 'Protein', items: [
      'Chicken breast — 3.5–4 lb (7 × 8 oz raw)',
      'Top sirloin steak, trimmed — 3.5–4 lb (7 × 8 oz raw)',
      'Whey protein isolate — ~160 g for the week (5–6 scoops)',
    ],
  },
  {
    category: 'Carbs & grains', items: [
      'Rolled oats — ~280 g dry (one 18 oz canister)',
      'Jasmine rice — ~1 lb dry (a 2 lb bag covers it)',
    ],
  },
  {
    category: 'Produce', items: [
      'Bananas — 7 medium', 'Broccoli florets — 2.5–3 lb (or 4 × 12 oz frozen)',
      'Russet potatoes — ~2.75 lb (5–6 small-medium)', 'Green beans — 2.5 lb (or 3–4 × 12 oz frozen)',
      'Mixed berries — ~1 lb (fresh or frozen)',
    ],
  },
  {
    category: 'Dairy & eggs', items: [
      'Large eggs — 14 (one 18-ct carton)', 'Liquid egg whites — 42 oz (three 16 oz cartons)',
      'Non-fat Greek yogurt — ~6.5 lb total (four 32 oz tubs)', 'Shredded mozzarella or cheddar (8 oz bag)',
    ],
  },
  {
    category: 'Pantry', items: [
      'Almonds (8 oz bag)', 'Olive oil', 'Low-sodium soy sauce', 'Honey (small jar)',
      'Garlic powder', 'Salt & pepper', 'Cinnamon (optional)', 'Nonstick spray',
    ],
  },
];

export const PLAN = {
  phases: PHASES,
  runWeeks: RUN_WEEKS,
  runCoaching: RUN_COACHING,
  meals: MEALS,
  shoppingList: SHOPPING_LIST,
};
