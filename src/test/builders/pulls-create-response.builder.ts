import { faker } from "@faker-js/faker";
import { build } from "mimicry-js";

export interface PullsCreateResponse {
  data: { number: number; html_url: string };
}

/**
 * Builds the minimal shape `github/pull-requests.ts` reads off an
 * `octokit.pulls.create` response (`data.number`, `data.html_url`).
 *
 * @example
 * pullsCreateResponseBuilder.one();
 * pullsCreateResponseBuilder.one({ overrides: { data: { number: 42, html_url: "https://github.com/acme/widgets/pull/42" } } });
 */
export const pullsCreateResponseBuilder = build<PullsCreateResponse>({
  fields: {
    data: () => {
      const number = faker.number.int({ min: 1, max: 9999 });
      return { number, html_url: `https://github.com/acme/widgets/pull/${number}` };
    }
  }
});
