/**
 * vercel.json の git.deploymentEnabled 設定検証
 * タスク: takatsu-connect-advisor-bb6.5
 */
import * as fs from "fs";
import * as path from "path";

const projectRoot = path.resolve(__dirname, "../../..");
const vercelJsonPath = path.join(projectRoot, "vercel.json");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let vercelConfig: Record<string, any>;

beforeAll(() => {
  const raw = fs.readFileSync(vercelJsonPath, "utf-8");
  vercelConfig = JSON.parse(raw);
});

describe("vercel.json: ファイル存在とパース可能性", () => {
  it("vercel.json が存在する", () => {
    expect(fs.existsSync(vercelJsonPath)).toBe(true);
  });

  it("JSON としてパース可能である", () => {
    expect(() => {
      const raw = fs.readFileSync(vercelJsonPath, "utf-8");
      JSON.parse(raw);
    }).not.toThrow();
  });
});

describe("vercel.json: git.deploymentEnabled 設定", () => {
  it("git.deploymentEnabled.main が true である", () => {
    expect(vercelConfig.git.deploymentEnabled.main).toBe(true);
  });

  it("git.deploymentEnabled.dev が true である", () => {
    expect(vercelConfig.git.deploymentEnabled.dev).toBe(true);
  });

  it("git.deploymentEnabled.release が定義されていない（undefined）", () => {
    expect(vercelConfig.git.deploymentEnabled.release).toBeUndefined();
  });

  it("git.deploymentEnabled.preview が定義されていない（undefined）", () => {
    expect(vercelConfig.git.deploymentEnabled.preview).toBeUndefined();
  });

  it("git.deploymentEnabled のキーが main と dev の 2 つだけである", () => {
    const keys = Object.keys(vercelConfig.git.deploymentEnabled);
    expect(keys).toHaveLength(2);
    expect(keys).toContain("main");
    expect(keys).toContain("dev");
  });
});
