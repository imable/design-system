export interface GithubSyncTarget {
  owner: string;
  repo: string;
  baseBranch: string;
  modeName: string;
}

export interface GithubSyncStep {
  step: number;
  total: number;
  message: string;
}

export class GithubApiError extends Error {}

interface GitRefResponse { object: { sha: string } }
interface ContentResponse { sha: string }
interface PullRequestResponse { html_url: string }

async function githubRequest<T>(pat: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new GithubApiError(`GitHub API responded ${response.status} for ${path}: ${body}`);
  }

  return response.json() as Promise<T>;
}

function toBase64Utf8(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
}

/**
 * Creates a branch off `target.baseBranch`, overwrites `/tokens/{modeName}.json`
 * on it, and opens a Pull Request back to the base branch. Reports its own
 * progress as steps 3 and 4 of the plugin's 4-step sync log (steps 1 and 2
 * cover reading Figma variables and generating tokens, upstream of this call).
 */
export async function syncTokensToGithub(
  pat: string,
  target: GithubSyncTarget,
  tokens: unknown,
  onProgress: (step: GithubSyncStep) => void,
): Promise<string> {
  const total = 4;
  const branchName = `figma-tokens-${target.modeName}-${Date.now()}`;
  const fileName = `${target.modeName}.json`;
  const content = JSON.stringify(tokens, null, 2);

  onProgress({ step: 3, total, message: `Creating branch ${branchName}...` });

  const baseRef = await githubRequest<GitRefResponse>(
    pat,
    `/repos/${target.owner}/${target.repo}/git/ref/heads/${target.baseBranch}`,
  );
  await githubRequest(pat, `/repos/${target.owner}/${target.repo}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseRef.object.sha }),
  });

  onProgress({ step: 4, total, message: `Overwriting /tokens/${fileName} & creating PR...` });

  let existingSha: string | undefined;
  try {
    const existing = await githubRequest<ContentResponse>(
      pat,
      `/repos/${target.owner}/${target.repo}/contents/tokens/${fileName}?ref=${branchName}`,
    );
    existingSha = existing.sha;
  } catch {
    existingSha = undefined; // File does not exist yet on the base branch.
  }

  await githubRequest(pat, `/repos/${target.owner}/${target.repo}/contents/tokens/${fileName}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `Update design tokens for ${target.modeName}`,
      content: toBase64Utf8(content),
      branch: branchName,
      ...(existingSha ? { sha: existingSha } : {}),
    }),
  });

  const pr = await githubRequest<PullRequestResponse>(pat, `/repos/${target.owner}/${target.repo}/pulls`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Updated design tokens',
      head: branchName,
      base: target.baseBranch,
      body: 'Automated design token update generated from Figma via the Tokens Figma Plugin.',
    }),
  });

  return pr.html_url;
}
