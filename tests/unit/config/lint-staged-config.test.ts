/**
 * lint-staged の glob パターンとコマンド設定検証
 * タスク: takatsu-connect-advisor-bb6.4
 */
import * as fs from "fs";
import * as path from "path";

const projectRoot = path.resolve(__dirname, "../../..");
const packageJsonPath = path.join(projectRoot, "package.json");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lintStaged: Record<string, any>;

beforeAll(() => {
  const raw = fs.readFileSync(packageJsonPath, "utf-8");
  const pkg = JSON.parse(raw);
  lintStaged = pkg["lint-staged"];
});

describe("package.json: lint-staged glob パターンとコマンド", () => {
  const PRETTIER_GLOB = "*.{ts,tsx,js,jsx,mjs,cjs,json,md,yml,yaml}";
  const ESLINT_GLOB = "*.{ts,tsx,js,jsx,mjs,cjs}";

  test(`"${PRETTIER_GLOB}" のコマンドが "prettier --write" である`, () => {
    expect(lintStaged[PRETTIER_GLOB]).toBe("prettier --write");
  });

  test(`"${ESLINT_GLOB}" のコマンドが "eslint --fix" である`, () => {
    expect(lintStaged[ESLINT_GLOB]).toBe("eslint --fix");
  });

  test("glob パターンが上記2つのみで余計なキーが含まれていない", () => {
    const keys = Object.keys(lintStaged);
    expect(keys).toHaveLength(2);
    expect(keys).toContain(PRETTIER_GLOB);
    expect(keys).toContain(ESLINT_GLOB);
  });
});
