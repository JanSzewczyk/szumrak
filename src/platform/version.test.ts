import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SZUMRAK_VERSION } from "~/platform/version";

describe("SZUMRAK_VERSION", () => {
  test("matches the version in package.json", () => {
    const { version } = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")) as {
      version: string;
    };

    expect(SZUMRAK_VERSION).toBe(version);
  });
});
