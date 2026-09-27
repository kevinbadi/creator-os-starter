/**
 * Numbers as Jev should say them (Kevin 2026-09-19: "make sure the voice jev
 * agent says bigger numbers correctly"). ElevenLabs reads "279,726" and
 * "1.9M" unreliably (digit runs, dropped groups), so everything numeric is
 * spelled out in words before synthesis. The on-screen text keeps the digits;
 * only the audio path goes through this.
 */

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES: [number, string][] = [
  [1_000_000_000_000, "trillion"],
  [1_000_000_000, "billion"],
  [1_000_000, "million"],
  [1_000, "thousand"],
];

function under1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} hundred`);
    n %= 100;
    if (n) parts.push("and");
  }
  if (n >= 20) {
    const t = TENS[Math.floor(n / 10)];
    parts.push(n % 10 ? `${t} ${ONES[n % 10]}` : t);
  } else if (n > 0 || parts.length === 0) {
    parts.push(ONES[n]);
  }
  return parts.join(" ");
}

/** 279726 -> "two hundred and seventy nine thousand, seven hundred and twenty six" */
export function integerToWords(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (n < 0) return `minus ${integerToWords(-n)}`;
  n = Math.floor(n);
  if (n < 1000) return under1000(n);
  const parts: string[] = [];
  for (const [value, name] of SCALES) {
    if (n >= value) {
      parts.push(`${under1000(Math.floor(n / value) % 1000 || Math.floor(n / value))} ${name}`);
      n %= value;
    }
  }
  if (n) parts.push(n < 100 ? `and ${under1000(n)}` : under1000(n));
  return parts.join(", ").replace(/, and /g, " and ");
}

function digitsToWords(digits: string): string {
  return digits.split("").map((d) => ONES[Number(d)]).join(" ");
}

/** Full-precision decimal: 12.5 -> "twelve point five"; 0.75 -> "zero point seven five" */
function decimalToWords(whole: string, frac: string): string {
  return `${integerToWords(Number(whole.replace(/,/g, "")))} point ${digitsToWords(frac)}`;
}

/** Clock times "2:34 PM" -> "two thirty four PM"; "9:05am" -> "nine oh five am". */
function timeToWords(h: string, m: string, suffix: string): string {
  const hour = integerToWords(Number(h));
  const mins = m === "00" ? "" : m.startsWith("0") ? ` oh ${ONES[Number(m[1])]}` : ` ${under1000(Number(m))}`;
  return `${hour}${mins}${suffix ? ` ${suffix.trim().toUpperCase()}` : ""}`;
}

export function speakNumbers(text: string): string {
  let t = String(text ?? "");
  // 1. clock times first so "2:34 PM" is not split into "two" ":" "thirty four"
  t = t.replace(/\b(\d{1,2}):(\d{2})\s*(am|pm|AM|PM)?\b/g, (_, h, m, s) => timeToWords(h, m, s ?? ""));
  // 2. currency: $1,234.56 / US$12 / CA$9.99
  t = t.replace(/\b(US|CA|C|A)?\$\s?(\d[\d,]*)(?:\.(\d{1,2}))?\b/g, (_, cc, whole, cents) => {
    const dollars = integerToWords(Number(whole.replace(/,/g, "")));
    const unit = cc === "CA" || cc === "C" ? "Canadian dollars" : cc === "US" ? "US dollars" : "dollars";
    const c = cents ? Number(cents.padEnd(2, "0")) : 0;
    return c ? `${dollars} ${unit} and ${integerToWords(c)} cents` : `${dollars} ${unit}`;
  });
  // 3. abbreviated magnitudes: 4.5K, 2.1M, 12B
  t = t.replace(/\b(\d+(?:\.\d+)?)\s?([KkMmBb])\b/g, (_, num, s) => {
    const scale = /k/i.test(s) ? "thousand" : /m/i.test(s) ? "million" : "billion";
    const [w, f] = String(num).split(".");
    return `${f ? decimalToWords(w, f) : integerToWords(Number(w))} ${scale}`;
  });
  // 4. percentages
  t = t.replace(/\b(\d[\d,]*)(?:\.(\d+))?\s?%/g, (_, w, f) => `${f ? decimalToWords(w, f) : integerToWords(Number(w.replace(/,/g, "")))} percent`);
  // 5. signed deltas (+1,234 / -56)
  t = t.replace(/(^|[\s(])([+-])(\d[\d,]*)\b/g, (_, pre, sign, w) => `${pre}${sign === "+" ? "up" : "down"} ${integerToWords(Number(w.replace(/,/g, "")))}`);
  // 6. plain decimals and integers (with or without thousands separators)
  t = t.replace(/\b(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\b/g, (_, w, f) => (f ? decimalToWords(w, f) : integerToWords(Number(w.replace(/,/g, "")))));
  // "1.3/day" -> "one point three per day"
  t = t.replace(/\s*\/\s*(day|week|month|year|hour|post)\b/g, " per $1");
  return t.replace(/\s+/g, " ").trim();
}
