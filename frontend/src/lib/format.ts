const moneyFormats = new Map<string, Intl.NumberFormat>();

/** Formats a price in minor units, for example 129900 INR as ₹1,299. */
export function money(minor: number, currency = "INR"): string {
  const whole = minor % 100 === 0;
  const key = currency + (whole ? ":0" : ":2");
  let format = moneyFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    });
    moneyFormats.set(key, format);
  }
  return format.format(minor / 100);
}

const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const shortDateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

export const dateTime = (iso: string) => dateTimeFormat.format(new Date(iso));
export const shortDate = (iso: string) => shortDateFormat.format(new Date(iso));

export const plural = (count: number, one: string, many = one + "s") => `${count} ${count === 1 ? one : many}`;
