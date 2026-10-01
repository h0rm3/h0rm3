import type { CommitRecord, LanguageTotals } from "./types.js";
import { localDateKey } from "./dateUtils.js";

const API = "https://api.github.com";
const GRAPHQL = "https://api.github.com/graphql";

export interface GitHubData {
  languages: LanguageTotals;
  commits: CommitRecord[]; // exact per-commit timestamps, deduped by sha, author-matched
  dailyCommitCounts: Map<string, number>; // YYYY-MM-DD (local) -> pure commit count, from contributionsCollection
}

async function gh(token: string, path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...init?.headers,
    },
  });
  if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
    const reset = new Date(Number(res.headers.get("x-ratelimit-reset")) * 1000);
    throw new Error(`GitHub REST rate limit exhausted. Resets at ${reset.toISOString()}`);
  }
  return res;
}

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

async function paginateRest(token: string, firstPath: string): Promise<any[]> {
  const results: any[] = [];
  let url: string | null = `${API}${firstPath}`;
  while (url) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (res.status === 409 || res.status === 404) break; // empty repo / not found
    if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
      const reset = new Date(Number(res.headers.get("x-ratelimit-reset")) * 1000);
      throw new Error(`GitHub REST rate limit exhausted. Resets at ${reset.toISOString()}`);
    }
    if (!res.ok) break;
    const page = await res.json();
    if (Array.isArray(page)) results.push(...page);
    url = parseNextLink(res.headers.get("link"));
  }
  return results;
}

async function graphql(token: string, query: string, variables: Record<string, unknown>): Promise<any> {
  const res = await fetch(GRAPHQL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(`GitHub GraphQL error: ${JSON.stringify(json.errors)}`);
  return json.data;
}

interface Repo {
  name: string;
  owner: { login: string };
  full_name: string;
}

async function listOwnedRepos(token: string): Promise<Repo[]> {
  return paginateRest(token, "/user/repos?affiliation=owner&per_page=100&visibility=all");
}

async function repoLanguages(token: string, fullName: string): Promise<Record<string, number>> {
  const res = await gh(token, `/repos/${fullName}/languages`);
  if (!res.ok) return {};
  return res.json();
}

async function repoBranches(token: string, fullName: string): Promise<string[]> {
  const branches = await paginateRest(token, `/repos/${fullName}/branches?per_page=100`);
  return branches.map((b: any) => b.name);
}

async function branchCommits(token: string, fullName: string, branch: string, author: string): Promise<CommitRecord[]> {
  const commits = await paginateRest(
    token,
    `/repos/${fullName}/commits?sha=${encodeURIComponent(branch)}&author=${encodeURIComponent(author)}&per_page=100`,
  );
  return commits.map((c: any) => ({
    sha: c.sha as string,
    repo: fullName,
    timestamp: c.commit.author.date as string,
  }));
}

/** Pure per-day commit counts (not mixed with issues/PRs/reviews) via contributionsCollection, looped one calendar year at a time from account creation to now. */
async function dailyCommitCountsFromContributions(token: string, username: string): Promise<Map<string, number>> {
  const userRes = await gh(token, `/users/${username}`);
  const user = await userRes.json();
  const createdYear = new Date(user.created_at).getUTCFullYear();
  const currentYear = new Date().getUTCFullYear();

  const query = `
    query($login: String!, $from: DateTime!, $to: DateTime!, $after: String) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          commitContributionsByRepository(maxRepositories: 100) {
            repository { nameWithOwner }
            contributions(first: 100, after: $after) {
              totalCount
              pageInfo { hasNextPage endCursor }
              nodes { occurredAt commitCount }
            }
          }
        }
      }
    }`;

  const daily = new Map<string, number>();

  for (let year = createdYear; year <= currentYear; year++) {
    const from = `${year}-01-01T00:00:00Z`;
    const to = `${year}-12-31T23:59:59Z`;

    // Per-repo pagination: each repo's `contributions` connection can independently need more pages.
    // Track which repos still have more pages; re-issue the query with a shared cursor is not possible
    // per-repo, so first fetch page 1 for all repos, then follow up individually for any with hasNextPage.
    const data = await graphql(token, query, { login: username, from, to, after: null });
    const byRepo = data.user.contributionsCollection.commitContributionsByRepository as any[];

    for (const repoEntry of byRepo) {
      let nodes = repoEntry.contributions.nodes as { occurredAt: string; commitCount: number }[];
      let pageInfo = repoEntry.contributions.pageInfo as { hasNextPage: boolean; endCursor: string | null };

      for (const node of nodes) {
        const key = localDateKey(node.occurredAt);
        daily.set(key, (daily.get(key) ?? 0) + node.commitCount);
      }

      while (pageInfo.hasNextPage) {
        const repoQuery = `
          query($login: String!, $from: DateTime!, $to: DateTime!, $after: String) {
            user(login: $login) {
              contributionsCollection(from: $from, to: $to) {
                commitContributionsByRepository(maxRepositories: 100) {
                  repository { nameWithOwner }
                  contributions(first: 100, after: $after) {
                    pageInfo { hasNextPage endCursor }
                    nodes { occurredAt commitCount }
                  }
                }
              }
            }
          }`;
        const more = await graphql(token, repoQuery, { login: username, from, to, after: pageInfo.endCursor });
        const repoAgain = (more.user.contributionsCollection.commitContributionsByRepository as any[]).find(
          (r) => r.repository.nameWithOwner === repoEntry.repository.nameWithOwner,
        );
        if (!repoAgain) break;
        for (const node of repoAgain.contributions.nodes as { occurredAt: string; commitCount: number }[]) {
          const key = localDateKey(node.occurredAt);
          daily.set(key, (daily.get(key) ?? 0) + node.commitCount);
        }
        pageInfo = repoAgain.contributions.pageInfo;
      }
    }
  }

  return daily;
}

export async function fetchGitHubData(token: string, username: string): Promise<GitHubData> {
  const repos = await listOwnedRepos(token);

  const languages: LanguageTotals = {};
  const commits: CommitRecord[] = [];
  const seenShas = new Set<string>();

  for (const repo of repos) {
    const fullName = repo.full_name;

    const langs = await repoLanguages(token, fullName);
    for (const [lang, bytes] of Object.entries(langs)) {
      languages[lang] = (languages[lang] ?? 0) + bytes;
    }

    const branches = await repoBranches(token, fullName);
    const perBranch = await Promise.all(branches.map((b) => branchCommits(token, fullName, b, username)));
    for (const list of perBranch) {
      for (const c of list) {
        if (seenShas.has(c.sha)) continue;
        seenShas.add(c.sha);
        commits.push(c);
      }
    }
  }

  const dailyCommitCounts = await dailyCommitCountsFromContributions(token, username);

  return { languages, commits, dailyCommitCounts };
}
