import type { AiMessage } from "./types.js";
import { dateKey } from "./tz.js";

export interface CensusRow {
  source: string;
  model: string;
  family: string;
  messages: number;
  freshInput: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  first: string;
  last: string;
}

/** Every raw model id seen in the logs (after dedupe), for the local QC report only. */
export function modelCensus(messages: AiMessage[]): CensusRow[] {
  const rows = new Map<string, CensusRow>();
  for (const m of messages) {
    const k = `${m.source}|${m.model}`;
    const day = dateKey(m.timestamp);
    const r = rows.get(k) ?? {
      source: m.source,
      model: m.model,
      family: m.family,
      messages: 0,
      freshInput: 0,
      cacheWrite: 0,
      cacheRead: 0,
      output: 0,
      first: day,
      last: day,
    };
    r.messages++;
    r.freshInput += m.freshInput;
    r.cacheWrite += m.cacheWrite;
    r.cacheRead += m.cacheRead;
    r.output += m.output;
    if (day < r.first) r.first = day;
    if (day > r.last) r.last = day;
    rows.set(k, r);
  }
  return [...rows.values()].sort((a, b) => a.source.localeCompare(b.source) || b.messages - a.messages);
}
