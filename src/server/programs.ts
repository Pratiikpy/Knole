// Guided journaling programs (#30) — the blank-page killer. Curated, finite arcs a person can start
// when nothing's on their mind. Each day is completable in a few minutes: one framing line, one
// prompt, and an optional deeper nudge. Programs are app content (not user data); a person's place in
// one lives in program_enrollments. Free-write is always one tap away — these are invitations, never
// homework. The Four-Day Write is the actual Pennebaker expressive-writing protocol.

export type ProgramDay = {
  framing: string; // one line of context for the day
  prompt: string; // the writing invitation (fills the page)
  followUp?: string; // an optional deeper nudge, offered after they write
};

export type Program = {
  id: string;
  title: string;
  blurb: string; // one-line pitch for the browse list
  topic: string; // the structured tag entries in this program carry
  days: ProgramDay[];
};

export const PROGRAMS: Program[] = [
  {
    id: "anxiety",
    title: "Working With Anxiety",
    blurb: "Seven days to meet the worry instead of wrestling it.",
    topic: "anxiety",
    days: [
      {
        framing: "Naming it is the first loosening.",
        prompt: "What is the worry actually saying, if you let it speak in plain words?",
        followUp: "Is it warning you about something real, or just keeping you company?",
      },
      {
        framing: "Anxiety loves the future tense.",
        prompt:
          "Write the worst-case story your mind keeps rehearsing — all the way to the end. Then read it back.",
        followUp: "How likely is it, really — and could you survive it if it happened?",
      },
      {
        framing: "The body knows before the mind admits it.",
        prompt: "Where does the anxiety live in your body today, and what is it asking you to do?",
      },
      {
        framing: "Not everything is yours to hold.",
        prompt:
          "Sort today's worries into two piles: what you can act on, and what you can only carry. What's in each?",
        followUp: "What's one small thing in the 'can act on' pile you could do today?",
      },
      {
        framing: "Certainty is not the price of peace.",
        prompt: "Where are you demanding to know for sure before you'll let yourself rest?",
      },
      {
        framing: "You've been here before.",
        prompt:
          "Think of a fear that once felt this big and no longer does. What actually got you through it?",
      },
      {
        framing: "A softer relationship with the worry.",
        prompt:
          "If the anxious part of you were a person, what would it need to hear from you today?",
        followUp: "What would change if you spoke to yourself the way you'd speak to a friend?",
      },
    ],
  },
  {
    id: "decision",
    title: "The Decision Journal",
    blurb: "Five days to think a hard choice all the way through.",
    topic: "decision",
    days: [
      {
        framing: "Name the fork.",
        prompt:
          "What is the decision, stated plainly — and what are the real options in front of you?",
      },
      {
        framing: "Under the decision is a value.",
        prompt: "What does each path quietly cost you, and what does each one protect?",
        followUp: "Which cost would you regret more a year from now?",
      },
      {
        framing: "The story you're telling yourself.",
        prompt: "What are you assuming is true that you haven't actually checked?",
      },
      {
        framing: "Ask the version of you who already chose.",
        prompt:
          "Imagine you've made the choice and it's a year later. Write the letter that version sends back.",
      },
      {
        framing: "The quiet gut read.",
        prompt:
          "Setting logic aside for a moment — which way do you lean when no one's watching, and why?",
        followUp: "What would it take to trust that read?",
      },
    ],
  },
  {
    id: "morning-pages",
    title: "Morning Pages",
    blurb: "Seven mornings of clearing the mind onto the page.",
    topic: "morning-pages",
    days: Array.from({ length: 7 }, (_, i) => ({
      framing: `Morning ${i + 1} — nothing to solve, just to empty.`,
      prompt:
        "Write whatever's at the top of your mind, unedited, until it runs out. No shaping, no audience.",
    })),
  },
  {
    id: "gratitude",
    title: "14 Days of Gratitude",
    blurb: "Two weeks of noticing what's already good.",
    topic: "gratitude",
    days: [
      { framing: "Start close.", prompt: "Name one small thing from today you're glad happened." },
      {
        framing: "A person.",
        prompt: "Who made your life a little easier or warmer lately, and how?",
      },
      { framing: "Your own body.", prompt: "What did your body carry you through today?" },
      {
        framing: "Something ordinary.",
        prompt: "What everyday thing would you miss most if it were gone?",
      },
      {
        framing: "A hard-won thing.",
        prompt: "What are you grateful for that you had to work for?",
      },
      { framing: "A place.", prompt: "Where do you feel most like yourself, and why?" },
      {
        framing: "A past self.",
        prompt: "What's a choice your younger self made that you're thankful for now?",
      },
      {
        framing: "Something you almost missed.",
        prompt: "What good thing nearly slipped past you unnoticed today?",
      },
      {
        framing: "A difficulty in disguise.",
        prompt: "What hard thing turned out to give you something?",
      },
      { framing: "A comfort.", prompt: "What reliably soothes you when the day is heavy?" },
      { framing: "A person, again.", prompt: "Who believes in you — and what do they see?" },
      {
        framing: "The senses.",
        prompt: "What did you see, hear, taste, or touch today that felt good?",
      },
      {
        framing: "Yourself.",
        prompt: "What's one thing about who you are that you're grateful for?",
      },
      {
        framing: "Looking back at two weeks.",
        prompt: "What have you started noticing that you used to walk past?",
        followUp: "Has anything shifted in how the days feel?",
      },
    ],
  },
  {
    id: "grief",
    title: "Carrying a Loss",
    blurb: "Seven days to grieve at your own pace.",
    topic: "grief",
    days: [
      {
        framing: "There's no right way to do this.",
        prompt: "Who or what did you lose, and what does the absence feel like today?",
      },
      {
        framing: "The specifics hold the love.",
        prompt: "What's a small, specific thing you miss?",
      },
      {
        framing: "Grief and gratitude can share a page.",
        prompt: "What did having them, or it, give you that you get to keep?",
      },
      {
        framing: "The things left unsaid.",
        prompt: "Is there something you wish you'd said? Say it here.",
      },
      {
        framing: "Grief moves in waves, not lines.",
        prompt: "When did it hit hardest lately, and what brought the wave in?",
      },
      {
        framing: "Carrying them forward.",
        prompt: "How do you want to keep them with you as you go on?",
      },
      {
        framing: "Gentleness with yourself.",
        prompt: "What do you need to hear today — and can you offer it to yourself?",
        followUp: "What would they want for you now?",
      },
    ],
  },
  {
    id: "new-chapter",
    title: "A New Chapter",
    blurb: "Seven days for a threshold — a move, a breakup, a beginning.",
    topic: "transition",
    days: [
      {
        framing: "Name the threshold.",
        prompt: "What's ending, and what's beginning? Where do you stand between them?",
      },
      {
        framing: "What you're leaving.",
        prompt: "What are you grateful to be closing, and what's harder to let go of?",
      },
      {
        framing: "Who you were.",
        prompt: "Who were you in the chapter that's ending — and what did it teach you?",
      },
      {
        framing: "The fear underneath.",
        prompt: "What are you most afraid this change will cost you?",
      },
      {
        framing: "The hope underneath.",
        prompt: "What are you quietly hoping this makes possible?",
      },
      {
        framing: "Who you're becoming.",
        prompt: "Who do you want to be on the other side of this?",
      },
      {
        framing: "A first step.",
        prompt: "What's one small thing that would help you meet this new chapter well?",
        followUp: "What would 'settling in' actually look like for you?",
      },
    ],
  },
  {
    id: "between-sessions",
    title: "Between Sessions",
    blurb: "Five days to bring your clearest self to therapy.",
    topic: "therapy",
    days: [
      {
        framing: "What's been loud.",
        prompt: "What's taken up the most space in your mind since we last talked about it?",
      },
      {
        framing: "The pattern you keep meeting.",
        prompt: "What situation keeps repeating, and how do you tend to react to it?",
      },
      {
        framing: "A moment worth bringing in.",
        prompt:
          "Describe one moment this week that stirred something up. What happened, and what did you feel?",
      },
      {
        framing: "What you're avoiding.",
        prompt: "What have you been meaning to raise but keep sliding past?",
      },
      {
        framing: "Prep for the session.",
        prompt:
          "If you could only cover one thing next time, what would it be — and what do you want from it?",
        followUp: "What would 'a good session' feel like afterward?",
      },
    ],
  },
  {
    id: "pennebaker",
    title: "The Four-Day Write",
    blurb: "The researched expressive-writing protocol — four days on one hard thing.",
    topic: "expressive-writing",
    days: [
      {
        framing: "Day 1 of 4. Write continuously for 15–20 minutes; don't stop to edit.",
        prompt:
          "Write about the deepest thoughts and feelings around an experience that has affected you most. Let go and explore your very deepest emotions.",
      },
      {
        framing: "Day 2 of 4. Same experience, going deeper.",
        prompt:
          "Return to the same experience. How does it connect to other parts of your life — your relationships, who you are, who you were, who you want to be?",
      },
      {
        framing: "Day 3 of 4. Looking for the shape.",
        prompt:
          "Write about it again. What do you understand now that you didn't? What causes and meanings are becoming clearer?",
      },
      {
        framing: "Day 4 of 4. Stepping back.",
        prompt:
          "One last time. Where are you now with this, and where might you go from here? What do you want to carry forward?",
        followUp: "Reading back over four days — what changed in how you tell this story?",
      },
    ],
  },
];

const BY_ID = new Map(PROGRAMS.map((p) => [p.id, p]));

export function getProgram(id: string): Program | undefined {
  return BY_ID.get(id);
}

/** A canned prompt library — the fallback when a personalized prompt-of-the-day can't be generated. */
export const CANNED_PROMPTS: string[] = [
  "What's true today, even if it's small?",
  "What's taking up the most room in your mind right now?",
  "What are you looking forward to — or dreading?",
  "What did today ask of you?",
  "Where did you feel most like yourself today?",
  "What's one thing you're avoiding thinking about?",
  "What would you tell a friend who had your day?",
  "What's a small win you'd otherwise forget?",
];
