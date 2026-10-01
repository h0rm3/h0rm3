import type { CommitRecord, HeatmapDay, LanguageTotals } from "./types.js";
import { addDays, dateKey, weekdayOfKey, zonedTimeToUtc, TZ } from "./tz.js";

const API = "https://api.github.com";

/**
 * GitHub buckets contribution days on its own clock: day-level commit contributions report
 * occurredAt = T07:00:00Z / T08:00:00Z, i.e. midnight US Pacific. Day keys from GitHub use this zone.
 */
export const GITHUB_DAY_TZ = "America/Los_Angeles";

export interface GitHubData {
  languages: LanguageTotals;
  commits: CommitRecord[]; // exact timestamps, owned repos, all branches, deduped by sha
  commitDays: Record<string, number>; // GitHub day -> commit contributions (all repos), all time
  publicRepoDays: Record<string, Record<string, number>>; // public repo -> GitHub day -> commits
  heatmap: { days: HeatmapDay[]; apiTotal: number; startKey: string };
  contributionsThisYear: number;
  profile: {
    createdAt: string;
    prsOpened: number;
    prsMerged: number;
    issuesOpened: number;
    starsReceived: number;
    publicRepos: number;
  };
  privateRepoNames: string[]; // for the privacy scan only, never written anywhere
}

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
}

function rateLimitError(res: Response): Error | null {
  if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
    const reset = new Date(Number(res.headers.get("x-ratelimit-reset")) * 1000);
    return new Error(`GitHub rate limit exhausted, resets at ${reset.toISOString()}`);
  }
  return null;
}

async function restJson(token: string, path: string): Promise<any> {
  const res = await fetch(`${API}${path}`, { headers: headers(token) });
  const rl = rateLimitError(res);
  if (rl) throw rl;
  if (!res.ok) throw new Error(`GitHub REST ${res.status} for ${path.split("?")[0].replace(/\/repos\/[^/]+\/[^/]+/, "/repos/…")}`);
  return res.json();
}

/** Follows Link rel="next". 404/409 (missing or empty repo) yield an empty list. */
async function paginate(token: string, firstPath: string): Promise<any[]> {
  const out: any[] = [];
  let url: string | null = `${API}${firstPath}`;
  while (url) {
    const res: Response = await fetch(url, { headers: headers(token) });
    const rl = rateLimitError(res);
    if (rl) throw rl;
    if (res.status === 404 || res.status === 409) break;
    if (!res.ok) throw new Error(`GitHub REST ${res.status} while paginating`);
    const page = await res.json();
    if (Array.isArray(page)) out.push(...page);
    const next = (res.headers.get("link") ?? "").split(",").find((p) => p.includes('rel="next"'));
    url = next ? next.slice(next.indexOf("<") + 1, next.indexOf(">")) : null;
  }
  return out;
}

async function graphql(token: string, query: string, variables: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${API}/graphql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const rl = rateLimitError(res);
  if (rl) throw rl;
  const json = await res.json();
  if (json.errors) throw new Error(`GitHub GraphQL error: ${JSON.stringify(json.errors.map((e: any) => e.message))}`);
  return json.data;
}

const LEVELS: Record<string, number> = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };

const COMMITS_BY_REPO = `
  query($login: String!, $from: DateTime!, $to: DateTime!, $after: String) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        commitContributionsByRepository(maxRepositories: 100) {
          repository { nameWithOwner isPrivate owner { login } name }
          contributions(first: 100, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes { occurredAt commitCount }
          }
        }
      }
    }
  }`;

async function commitContributions(token: string, username: string, createdAt: string) {
  const commitDays: Record<string, number> = {};
  const publicRepoDays: Record<string, Record<string, number>> = {};
  const add = (repo: any, nodes: { occurredAt: string; commitCount: number }[]) => {
    const label = repo.owner.login.toLowerCase() === username.toLowerCase() ? repo.name : repo.nameWithOwner;
    for (const n of nodes) {
      const key = dateKey(n.occurredAt, GITHUB_DAY_TZ);
      commitDays[key] = (commitDays[key] ?? 0) + n.commitCount;
      if (!repo.isPrivate) {
        const r = (publicRepoDays[label] ??= {});
        r[key] = (r[key] ?? 0) + n.commitCount;
      }
    }
  };

  const firstYear = new Date(createdAt).getUTCFullYear();
  const lastYear = new Date().getUTCFullYear();
  for (let year = firstYear; year <= lastYear; year++) {
    const vars = { login: username, from: `${year}-01-01T00:00:00Z`, to: `${year}-12-31T23:59:59Z` };
    const data = await graphql(token, COMMITS_BY_REPO, { ...vars, after: null });
    for (const entry of data.user.contributionsCollection.commitContributionsByRepository) {
      add(entry.repository, entry.contributions.nodes);
      let page = entry.contributions.pageInfo;
      while (page.hasNextPage) {
        const more = await graphql(token, COMMITS_BY_REPO, { ...vars, after: page.endCursor });
        const same = more.user.contributionsCollection.commitContributionsByRepository.find(
          (e: any) => e.repository.nameWithOwner === entry.repository.nameWithOwner,
        );
        if (!same) break;
        add(same.repository, same.contributions.nodes);
        page = same.contributions.pageInfo;
      }
    }
  }
  return { commitDays, publicRepoDays };
}

/** Last 52 week-columns of GitHub's contribution calendar, ending with the current (partial) week. */
async function heatmap(token: string, username: string, now: Date) {
  const today = dateKey(now, GITHUB_DAY_TZ);
  const sunday = addDays(today, -weekdayOfKey(today));
  const startKey = addDays(sunday, -51 * 7);
  const from = zonedTimeToUtc(startKey, 0, GITHUB_DAY_TZ).toISOString();
  const data = await graphql(
    token,
    `query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) { contributionsCollection(from: $from, to: $to) {
        contributionCalendar { totalContributions weeks { contributionDays { date contributionCount contributionLevel } } }
      } } }`,
    { login: username, from, to: now.toISOString() },
  );
  const cal = data.user.contributionsCollection.contributionCalendar;
  const days: HeatmapDay[] = cal.weeks
    .flatMap((w: any) => w.contributionDays)
    .map((d: any) => ({ date: d.date, count: d.contributionCount, level: LEVELS[d.contributionLevel] ?? 0 }));
  return { days, apiTotal: cal.totalContributions as number, startKey };
}

async function contributionsThisYear(token: string, username: string, now: Date): Promise<number> {
  const year = Number(dateKey(now).slice(0, 4));
  const data = await graphql(
    token,
    `query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) { contributionsCollection(from: $from, to: $to) { contributionCalendar { totalContributions } } } }`,
    { login: username, from: zonedTimeToUtc(`${year}-01-01`, 0, TZ).toISOString(), to: now.toISOString() },
  );
  return data.user.contributionsCollection.contributionCalendar.totalContributions;
}

async function profile(token: string, username: string) {
  const base = await graphql(
    token,
    `query($login: String!) { user(login: $login) {
      createdAt
      pullRequests { totalCount }
      merged: pullRequests(states: MERGED) { totalCount }
      issues { totalCount }
      publicRepos: repositories(privacy: PUBLIC, ownerAffiliations: OWNER) { totalCount }
    } }`,
    { login: username },
  );
  let stars = 0;
  let after: string | null = null;
  do {
    const page: any = await graphql(
      token,
      `query($login: String!, $after: String) { user(login: $login) {
        repositories(privacy: PUBLIC, ownerAffiliations: OWNER, isFork: false, first: 100, after: $after) {
          pageInfo { hasNextPage endCursor } nodes { stargazerCount }
        } } }`,
      { login: username, after },
    );
    const repos = page.user.repositories;
    stars += repos.nodes.reduce((a: number, r: any) => a + r.stargazerCount, 0);
    after = repos.pageInfo.hasNextPage ? repos.pageInfo.endCursor : null;
  } while (after);
  const u = base.user;
  return {
    createdAt: u.createdAt as string,
    prsOpened: u.pullRequests.totalCount as number,
    prsMerged: u.merged.totalCount as number,
    issuesOpened: u.issues.totalCount as number,
    starsReceived: stars,
    publicRepos: u.publicRepos.totalCount as number,
  };
}

export async function fetchGitHubData(token: string, username: string, now: Date): Promise<GitHubData> {
  const repos = await paginate(token, "/user/repos?affiliation=owner&per_page=100&visibility=all");
  const languages: LanguageTotals = {};
  const commits: CommitRecord[] = [];
  const seen = new Set<string>();

  for (const repo of repos) {
    const langs: Record<string, number> = await restJson(token, `/repos/${repo.full_name}/languages`).catch(() => ({}));
    for (const [lang, bytes] of Object.entries(langs)) languages[lang] = (languages[lang] ?? 0) + bytes;

    const branches = await paginate(token, `/repos/${repo.full_name}/branches?per_page=100`);
    for (const b of branches) {
      const list = await paginate(
        token,
        `/repos/${repo.full_name}/commits?sha=${encodeURIComponent(b.name)}&author=${encodeURIComponent(username)}&until=${encodeURIComponent(now.toISOString())}&per_page=100`,
      );
      for (const c of list) {
        if (seen.has(c.sha)) continue;
        seen.add(c.sha);
        commits.push({ sha: c.sha, repo: repo.full_name, timestamp: c.commit.author.date });
      }
    }
  }

  const prof = await profile(token, username);
  const { commitDays, publicRepoDays } = await commitContributions(token, username, prof.createdAt);

  return {
    languages,
    commits,
    commitDays,
    publicRepoDays,
    heatmap: await heatmap(token, username, now),
    contributionsThisYear: await contributionsThisYear(token, username, now),
    profile: prof,
    privateRepoNames: repos.filter((r: any) => r.private).map((r: any) => r.name as string),
  };
}
