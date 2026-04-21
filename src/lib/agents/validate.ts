/**
 * エージェント定義バリデーション
 *
 * prompts/agents/*.md を検証する純粋関数群。
 * CLI スクリプト (scripts/validate-agents.ts) と テストの両方から呼び出せる。
 *
 * 設計書: doc/design/agent-system-design.md §4.6
 *        doc/design/prompt-design.md §9
 */

import { readdir, readFile, stat, access } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { parseAgentDefinition } from "./parser";
import type { AgentDefinition } from "./types";

// ---------------------------------------------------------------------------
// 公開型定義
// ---------------------------------------------------------------------------

export interface ValidationError {
  /** エラーが発生したファイルパス */
  filePath: string;
  /** エラーの種類 */
  type:
    | "schema"
    | "include_missing"
    | "tool_missing"
    | "name_duplicate"
    | "role_duplicate"
    | "name_format"
    | "include_cycle";
  /** エラーメッセージ */
  message: string;
  /** include_cycle の場合のみ: 循環経路に含まれるファイル一覧（相対パス） */
  files?: string[];
}

export interface ValidationWarning {
  /** 警告の種類 */
  type: "tools_dir_missing" | "agents_dir_missing" | "classifier_list_diff" | "prompt_size";
  /** 警告メッセージ */
  message: string;
}

export interface ValidationResult {
  errors: ValidationError[];
  warnings: ValidationWarning[];
  agentCount: number;
}

export interface ValidateAllAgentsOptions {
  /** prompts/ ディレクトリのパス（絶対パス）。未指定時は process.cwd()/prompts */
  promptsDir?: string;
  /**
   * tools 定義の参照先。
   * src/lib/tools/schemas.ts に定義された toolSchemas のキー名と照合する。
   * 未指定時はファイルシステムの prompts/tools/*.md を参照する。
   */
  toolsDir?: string;
}

// ---------------------------------------------------------------------------
// 内部ユーティリティ
// ---------------------------------------------------------------------------

/**
 * ディレクトリが存在するか確認する。
 */
async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const s = await stat(dirPath);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/**
 * ファイルが存在するか確認する。
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * ディレクトリ内の .md ファイル一覧を返す（絶対パス）。
 */
async function listMdFiles(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath);
  return entries.filter((f) => f.endsWith(".md")).map((f) => path.join(dirPath, f));
}

/**
 * src/lib/tools/schemas.ts から ツール名一覧を抽出する。
 * import が難しい環境（tsx 経由 CLI）でもテキスト解析で取得できるようにする。
 */
async function loadToolNamesFromSchemas(schemasPath: string): Promise<Set<string> | null> {
  let source: string;
  try {
    source = await readFile(schemasPath, "utf-8");
  } catch {
    return null;
  }

  // NOTE: toolSchemas のトップレベルキー（2スペースインデントの `key: {` 形式）を抽出する。
  //       ネストされたオブジェクトキーは2スペースよりも深いため誤検知しない。
  const keyPattern = /^\s{2}([\w]+):\s*\{/gm;
  const names = new Set<string>();
  for (const match of source.matchAll(keyPattern)) {
    names.add(match[1]);
  }
  return names.size > 0 ? names : null;
}

/**
 * shared/*.md フロントマターから include 配列を抽出する。
 * gray-matter で YAML のみを解析し、include フィールドが配列であれば返す。
 * フロントマターが存在しない・include が無い場合は空配列を返す。
 */
async function extractSharedIncludes(filePath: string): Promise<string[]> {
  let source: string;
  try {
    source = await readFile(filePath, "utf-8");
  } catch {
    return [];
  }
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(source);
  } catch {
    return [];
  }
  const inc = parsed.data?.include;
  if (Array.isArray(inc)) {
    return inc.filter((v): v is string => typeof v === "string");
  }
  return [];
}

/**
 * include 参照グラフに対して DFS で循環参照を検出し、ValidationError の配列を返す。
 *
 * @param graph - ノード（相対パス）→ 参照先ノード配列のマップ
 * @returns 循環が検出された場合の ValidationError 配列
 */
function detectIncludeCycles(graph: Map<string, string[]>): ValidationError[] {
  const cycleErrors: ValidationError[] = [];
  const visitedGlobal = new Set<string>();

  /**
   * DFS で現在のノードから辿り、循環があれば errors に追加する。
   *
   * @param node    現在処理中のノード（相対パス）
   * @param stack   現在の DFS スタック（循環経路の抽出に使用）
   * @param onStack スタック上にいるノードの集合（O(1) ループ検出用）
   * @returns ループを検出した場合 true
   */
  function dfs(node: string, stack: string[], onStack: Set<string>): boolean {
    if (onStack.has(node)) {
      // 循環発見 — スタックから循環経路を抽出する
      const cycleStart = stack.indexOf(node);
      const cyclePath = stack.slice(cycleStart);
      cyclePath.push(node); // 閉じる（a → b → c → a）

      cycleErrors.push({
        filePath: node,
        type: "include_cycle",
        message: `include の循環参照を検出しました: ${cyclePath.join(" → ")}`,
        files: cyclePath,
      });
      return true;
    }

    if (visitedGlobal.has(node)) {
      // 別の経路で既に探索済み → 循環なし
      return false;
    }

    stack.push(node);
    onStack.add(node);

    const neighbors = graph.get(node) ?? [];
    for (const neighbor of neighbors) {
      dfs(neighbor, stack, onStack);
    }

    stack.pop();
    onStack.delete(node);
    // NOTE: バックトラック後にマークすることで、複数の入口から同じノードに到達できる
    //       グラフでも循環を正しく検出できる（探索開始時のマークでは false negative が生じる）
    visitedGlobal.add(node);
    return false;
  }

  for (const node of graph.keys()) {
    if (!visitedGlobal.has(node)) {
      dfs(node, [], new Set());
    }
  }

  return cycleErrors;
}

/**
 * classifier-agents-list.md の期待内容（specialist のみ）を生成する。
 */
function generateClassifierAgentsList(agents: AgentDefinition[]): string {
  const specialists = agents.filter((a) => a.role === "specialist");
  const rows = specialists
    .map((a) => `| ${a.name} | ${a.displayName} | ${a.description} |`)
    .join("\n");

  return `# 利用可能な専門家一覧

| name | displayName | 守備範囲 |
|---|---|---|
${rows}
`;
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/**
 * prompts/agents/*.md をすべて検証し、ValidationResult を返す。
 *
 * 検証項目（prompt-design.md §9）:
 * 1. スキーマ検証 (zod - parseAgentDefinition 経由)
 * 2. include ファイルの実在確認
 * 3. tools が prompts/tools/*.md または src/lib/tools/schemas.ts に存在するか
 * 4. role: classifier / role: orchestrator は各1件のみ
 * 5. name の一意性と ^[a-z0-9-]+$ 形式（parser 側で検証されるが集約）
 * 6. include ファイルの循環参照検出（agents/ + shared/ 全体をスキャン）
 * 7. classifier-agents-list.md との diff 確認
 * 8. プロンプトサイズ警告（20,000 文字超え）
 *
 * @param options バリデーションオプション
 */
export async function validateAllAgents(
  options?: ValidateAllAgentsOptions,
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const cwd = process.cwd();
  const promptsDir = options?.promptsDir
    ? path.resolve(options.promptsDir)
    : path.join(cwd, "prompts");

  const agentsDir = path.join(promptsDir, "agents");
  const sharedDir = path.join(promptsDir, "shared");
  const toolsDir = options?.toolsDir
    ? path.resolve(options.toolsDir)
    : path.join(promptsDir, "tools");

  // agents ディレクトリが存在しない場合はスキップ（warning のみ）
  if (!(await dirExists(agentsDir))) {
    warnings.push({
      type: "agents_dir_missing",
      message: `prompts/agents ディレクトリが見つかりません: ${agentsDir} （検証をスキップ）`,
    });
    return { errors, warnings, agentCount: 0 };
  }

  // shared ディレクトリが存在しない場合は warning
  const sharedExists = await dirExists(sharedDir);
  if (!sharedExists) {
    warnings.push({
      type: "tools_dir_missing",
      message: `prompts/shared ディレクトリが見つかりません: ${sharedDir}`,
    });
  }

  // tools ディレクトリの存在確認
  const toolsDirExists = await dirExists(toolsDir);

  // ツール名の参照先を決定
  // 優先度: src/lib/tools/schemas.ts > prompts/tools/*.md > 存在しない場合は warning
  let knownToolNames: Set<string> | null = null;
  const schemasPath = path.join(cwd, "src", "lib", "tools", "schemas.ts");
  const schemasExists = await fileExists(schemasPath);

  if (schemasExists) {
    knownToolNames = await loadToolNamesFromSchemas(schemasPath);
  } else if (toolsDirExists) {
    // prompts/tools/*.md のファイル名（拡張子除き）をツール名として扱う
    const toolMdFiles = await listMdFiles(toolsDir);
    knownToolNames = new Set(toolMdFiles.map((f) => path.basename(f, ".md")));
  } else {
    warnings.push({
      type: "tools_dir_missing",
      message: `ツール定義が見つかりません（src/lib/tools/schemas.ts も prompts/tools/ も存在しない）。tools 検証をスキップします。`,
    });
  }

  // エージェント定義ファイル一覧取得
  const agentFiles = await listMdFiles(agentsDir);

  if (agentFiles.length === 0) {
    return { errors, warnings, agentCount: 0 };
  }

  // ---------------------------------------------------------------------------
  // 各ファイルをパースしてバリデーション
  // ---------------------------------------------------------------------------

  const loadedAgents: AgentDefinition[] = [];

  for (const filePath of agentFiles) {
    let source: string;
    try {
      source = await readFile(filePath, "utf-8");
    } catch (err) {
      errors.push({
        filePath,
        type: "schema",
        message: `ファイルの読み込みに失敗しました: ${String(err)}`,
      });
      continue;
    }

    // 1. スキーマ検証（parseAgentDefinition が zod でバリデーションを行う）
    let agent: AgentDefinition;
    try {
      agent = parseAgentDefinition({
        filePath,
        source,
        mtimeMs: Date.now(),
      });
    } catch (err) {
      errors.push({
        filePath,
        type: "schema",
        message: String(err),
      });
      continue;
    }

    loadedAgents.push(agent);

    // 2. include ファイルの実在確認
    if (agent.include && agent.include.length > 0 && sharedExists) {
      for (const rel of agent.include) {
        const includePath = path.join(promptsDir, rel);
        const exists = await fileExists(includePath);
        if (!exists) {
          errors.push({
            filePath,
            type: "include_missing",
            message: `include ファイルが見つかりません: "${rel}" (${includePath})`,
          });
        }
      }
    }

    // 3. tools 一致確認
    if (knownToolNames !== null && agent.tools.length > 0) {
      for (const toolName of agent.tools) {
        if (!knownToolNames.has(toolName)) {
          errors.push({
            filePath,
            type: "tool_missing",
            message: `ツール "${toolName}" が定義されていません（既知のツール: ${[...knownToolNames].join(", ")}）`,
          });
        }
      }
    }

    // 8. プロンプトサイズ警告（20,000 文字超え）
    if (agent.systemPrompt.length > 20000) {
      warnings.push({
        type: "prompt_size",
        message: `${path.basename(filePath)}: systemPrompt が 20,000 文字を超えています（${agent.systemPrompt.length} 文字）`,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // ロード済みエージェント全体に対する検証
  // ---------------------------------------------------------------------------

  // 4. role: classifier / role: orchestrator は各1件のみ
  const classifiers = loadedAgents.filter((a) => a.role === "classifier");
  if (classifiers.length > 1) {
    errors.push({
      filePath: agentsDir,
      type: "role_duplicate",
      message: `role: classifier のエージェントが複数存在します（${classifiers.map((a) => a.name).join(", ")}）。1件のみにしてください。`,
    });
  }

  const orchestrators = loadedAgents.filter((a) => a.role === "orchestrator");
  if (orchestrators.length > 1) {
    errors.push({
      filePath: agentsDir,
      type: "role_duplicate",
      message: `role: orchestrator のエージェントが複数存在します（${orchestrators.map((a) => a.name).join(", ")}）。1件のみにしてください。`,
    });
  }

  // 5. name の一意性確認
  const nameCount = new Map<string, string[]>();
  for (const agent of loadedAgents) {
    const existing = nameCount.get(agent.name) ?? [];
    existing.push(agent.filePath);
    nameCount.set(agent.name, existing);
  }
  for (const [name, filePaths] of nameCount.entries()) {
    if (filePaths.length > 1) {
      errors.push({
        filePath: filePaths.join(", "),
        type: "name_duplicate",
        message: `name "${name}" が重複しています: ${filePaths.map((f) => path.basename(f)).join(", ")}`,
      });
    }
  }

  // 6. include ファイルの循環参照検出（prompt-design.md §9 項目6）
  {
    // グラフのノードは prompts/ 配下の相対パスで統一する。
    // 例: "agents/seo-specialist.md", "shared/common.md"
    const includeGraph = new Map<string, string[]>();

    // agent ファイルは既にパース済みなので include フィールドを直接使う
    for (const agent of loadedAgents) {
      const relAgent = path.relative(promptsDir, agent.filePath).replace(/\\/g, "/");
      const deps = (agent.include ?? []).map((r) => r.replace(/\\/g, "/"));
      includeGraph.set(relAgent, deps);
    }

    // shared ファイルはフロントマターの include のみを gray-matter で抽出する
    if (sharedExists) {
      const sharedFiles = await listMdFiles(sharedDir);
      for (const sharedFilePath of sharedFiles) {
        const relShared = path.relative(promptsDir, sharedFilePath).replace(/\\/g, "/");
        if (!includeGraph.has(relShared)) {
          const deps = await extractSharedIncludes(sharedFilePath);
          includeGraph.set(
            relShared,
            deps.map((r) => r.replace(/\\/g, "/")),
          );
        }
      }
    }

    const cycleErrors = detectIncludeCycles(includeGraph);
    for (const cycleError of cycleErrors) {
      errors.push(cycleError);
    }
  }

  // 7. classifier-agents-list.md の diff 確認
  if (sharedExists && loadedAgents.length > 0) {
    const classifierListPath = path.join(sharedDir, "classifier-agents-list.md");
    const classifierListExists = await fileExists(classifierListPath);

    if (classifierListExists) {
      const currentContent = await readFile(classifierListPath, "utf-8");
      const expectedContent = generateClassifierAgentsList(loadedAgents);

      // 改行コードを正規化して比較
      const normalize = (s: string) => s.trim().replace(/\r\n/g, "\n");
      if (normalize(currentContent) !== normalize(expectedContent)) {
        warnings.push({
          type: "classifier_list_diff",
          message: `shared/classifier-agents-list.md の内容が現在のエージェント定義と一致しません。\n  pnpm validate:agents を実行後、差分を確認して更新してください。\n  期待される内容:\n${expectedContent}`,
        });
      }
    }
  }

  return {
    errors,
    warnings,
    agentCount: loadedAgents.length,
  };
}
