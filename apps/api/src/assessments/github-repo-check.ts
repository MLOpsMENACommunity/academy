import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RepoCheck } from '@academy/shared';

/** The fetch used for GitHub checks; tests replace it (no network in CI). */
export const GITHUB_FETCH = Symbol('GITHUB_FETCH');
export type FetchLike = (url: string, init?: RequestInit) => Promise<Pick<Response, 'status' | 'headers' | 'body'>>;

export const GITHUB_CHECK_TIMEOUT_MS = 4_000;

/**
 * Is a GitHub repository public? Asks the GitHub API without any token, exactly
 * as a grader's browser would see it: 200 = public; 404 = private or missing.
 * When GitHub can't answer (timeout, outage, the 60-an-hour anonymous rate limit)
 * the result is UNVERIFIED: the submission is accepted and the grader sees the flag.
 */
@Injectable()
export class GithubRepoChecker {
  private readonly logger = new Logger(GithubRepoChecker.name);

  constructor(@Inject(GITHUB_FETCH) private readonly fetchFn: FetchLike) {}

  async check(owner: string, repo: string): Promise<RepoCheck> {
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    try {
      const res = await this.fetchFn(url, {
        method: 'GET',
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'mlops-mena-academy', 'X-GitHub-Api-Version': '2022-11-28' },
        redirect: 'follow',
        signal: AbortSignal.timeout(GITHUB_CHECK_TIMEOUT_MS),
      });
      // Only the status matters: release the connection.
      await res.body?.cancel().catch(() => undefined);
      if (res.status === 200) return 'PUBLIC';
      // 404: private or missing. 451: blocked for legal reasons. Either way graders can't open it.
      if (res.status === 404 || res.status === 451 || res.status === 410) return 'NOT_PUBLIC';
      // 403/429 (rate limited), 5xx and anything else: GitHub didn't say.
      this.logger.warn(`GitHub repository check inconclusive: HTTP ${res.status}`);
      return 'UNVERIFIED';
    } catch (err) {
      this.logger.warn(`GitHub repository check failed: ${(err as Error).name}`);
      return 'UNVERIFIED';
    }
  }
}
