/**
 * @jest-environment node
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "../..");
const CI_YML = resolve(ROOT, ".github/workflows/ci.yml");

describe("CI workflow", () => {
  let content: string;

  beforeAll(() => {
    expect(existsSync(CI_YML)).toBe(true);
    content = readFileSync(CI_YML, "utf-8");
  });

  it("triggers on push to dev/preview/release and on pull_request", () => {
    expect(content).toMatch(/branches:\s*\[dev,\s*preview,\s*release\]/);
    expect(content).toMatch(/pull_request:/);
  });

  it("includes check and e2e jobs", () => {
    expect(content).toMatch(/^\s*check:/m);
    expect(content).toMatch(/^\s*e2e:/m);
  });

  it("runs pnpm lint, typecheck, prettier check, test and build in check job", () => {
    expect(content).toMatch(/pnpm lint/);
    expect(content).toMatch(/pnpm typecheck/);
    expect(content).toMatch(/pnpm prettier --check/);
    expect(content).toMatch(/pnpm test\b/);
    expect(content).toMatch(/pnpm build/);
  });

  it("installs Playwright chromium in e2e job", () => {
    expect(content).toMatch(/pnpm exec playwright install.*chromium/);
    expect(content).toMatch(/pnpm test:e2e/);
  });

  it("uses pnpm cache for node setup", () => {
    expect(content).toMatch(/cache:\s*"pnpm"/);
  });

  it("does not run non-existent pnpm test:unit script", () => {
    expect(content).not.toMatch(/pnpm test:unit/);
  });
});
