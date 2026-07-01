// Crisis resources — client+server safe (no server imports), so any surface can render the card.
export const CRISIS_RESOURCES = [
  { label: "988 Suicide & Crisis Lifeline", detail: "Call or text 988", href: "tel:988" },
  { label: "Crisis Text Line", detail: "Text HOME to 741741", href: "sms:741741?&body=HOME" },
  { label: "Emergency", detail: "Call 911 if you're in immediate danger", href: "tel:911" },
  {
    label: "Outside the US",
    detail: "Find a helpline near you",
    href: "https://findahelpline.com",
  },
];
