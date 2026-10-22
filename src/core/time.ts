// Household time zone: stored once, used for every timestamp and every "this week".
const parts = (ts: number, tz: string) => {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' });
  return Object.fromEntries(f.formatToParts(new Date(ts)).map((p) => [p.type, p.value])) as Record<string, string>;
};

export function localDate(ts: number, tz: string): string {
  const p = parts(ts, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

// weeks start Monday, in the household's zone → key is that Monday's date
export function weekKey(ts: number, tz: string): string {
  const p = parts(ts, tz);
  const back = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday);
  const d = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day) - back));
  return d.toISOString().slice(0, 10);
}

export function formatLocal(ts: number, tz: string): string {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit' });
  return f.format(new Date(ts));
}

export function timeOfDay(ts: number, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(ts));
}

// 1 = Monday ... 7 = Sunday, in the house's own zone
export function weekdayOf(ts: number, tz: string): number {
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts(ts, tz).weekday) + 1;
}

export function hourOf(ts: number, tz: string): number {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(new Date(ts));
  return Number(h) % 24; // some engines print midnight as 24
}
