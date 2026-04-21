/**
 * .husky/pre-commit ファイルの存在と内容検証
 * タスク: takatsu-connect-advisor-bb6.4
 */
import * as fs from "fs";
import * as path from "path";

const projectRoot = path.resolve(__dirname, "../../..");
const preCommitPath = path.join(projectRoot, ".husky", "pre-commit");

describe(".husky/pre-commit: ファイル存在と内容", () => {
  test(".husky/pre-commit ファイルが存在する", () => {
    expect(fs.existsSync(preCommitPath)).toBe(true);
  });

  test('ファイル内容に "pnpm exec lint-staged" が含まれる', () => {
    const content = fs.readFileSync(preCommitPath, "utf-8");
    // 改行コード（CRLF/LF）を正規化してから検証
    const normalized = content.replace(/\r\n/g, "\n");
    expect(normalized).toContain("pnpm exec lint-staged");
  });

  test("husky v9 スタイルである（旧来の shebang が含まれない）", () => {
    const content = fs.readFileSync(preCommitPath, "utf-8");
    const normalized = content.replace(/\r\n/g, "\n");
    // husky v8 以前の shebang が含まれていないことを確認
    expect(normalized).not.toContain("#!/usr/bin/env sh");
  });

  test("husky v9 スタイルである（旧来の sourcing 行が含まれない）", () => {
    const content = fs.readFileSync(preCommitPath, "utf-8");
    const normalized = content.replace(/\r\n/g, "\n");
    // husky v8 以前の sourcing 行が含まれていないことを確認
    expect(normalized).not.toContain('. "$(dirname -- "$0")/_/husky.sh"');
  });
});
