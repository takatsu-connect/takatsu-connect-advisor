/**
 * package.json の husky + lint-staged 設定検証
 * タスク: takatsu-connect-advisor-bb6.4
 */
import * as fs from "fs";
import * as path from "path";

const projectRoot = path.resolve(__dirname, "../../..");
const packageJsonPath = path.join(projectRoot, "package.json");

// require のキャッシュを避けるため JSON.parse + readFileSync で読み込む
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pkg: Record<string, any>;

beforeAll(() => {
  const raw = fs.readFileSync(packageJsonPath, "utf-8");
  pkg = JSON.parse(raw);
});

describe("package.json: husky + lint-staged 設定", () => {
  test('scripts.prepare が "husky" である', () => {
    expect(pkg.scripts).toBeDefined();
    expect(pkg.scripts.prepare).toBe("husky");
  });

  test("トップレベル lint-staged キーが存在し、object 型である", () => {
    expect(pkg["lint-staged"]).toBeDefined();
    expect(typeof pkg["lint-staged"]).toBe("object");
    expect(pkg["lint-staged"]).not.toBeNull();
    expect(Array.isArray(pkg["lint-staged"])).toBe(false);
  });

  test("devDependencies.husky が存在する", () => {
    expect(pkg.devDependencies).toBeDefined();
    expect(pkg.devDependencies["husky"]).toBeDefined();
  });

  test('devDependencies["lint-staged"] が存在する', () => {
    expect(pkg.devDependencies).toBeDefined();
    expect(pkg.devDependencies["lint-staged"]).toBeDefined();
  });
});
