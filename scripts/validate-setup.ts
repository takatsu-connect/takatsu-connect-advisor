import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
let failures = 0;

function fail(message: string, expected: unknown, actual: unknown): void {
  console.error(`[FAIL] ${message}`);
  console.error(`  expected: ${JSON.stringify(expected)}`);
  console.error(`  actual:   ${JSON.stringify(actual)}`);
  failures++;
}

function pass(message: string): void {
  console.log(`[PASS] ${message}`);
}

function readJson(filePath: string): Record<string, unknown> | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Check 1: package.json required dependencies
function checkPackageJsonDependencies(): void {
  const pkgPath = path.join(ROOT, "package.json");
  const pkg = readJson(pkgPath);

  if (!pkg) {
    fail("package.json exists and is valid JSON", "valid JSON file", "file not found or invalid");
    return;
  }

  const deps = {
    ...(pkg.dependencies as Record<string, string> | undefined ?? {}),
    ...(pkg.devDependencies as Record<string, string> | undefined ?? {}),
  };

  const requiredDeps = [
    "next",
    "react",
    "react-dom",
    "@supabase/ssr",
    "@supabase/supabase-js",
    "@anthropic-ai/sdk",
    "zod",
    "server-only",
  ];

  for (const dep of requiredDeps) {
    if (dep in deps) {
      pass(`package.json dependency: ${dep}`);
    } else {
      fail(`package.json dependency: ${dep}`, dep, "not found");
    }
  }
}

// Check 2: package.json scripts
function checkPackageJsonScripts(): void {
  const pkgPath = path.join(ROOT, "package.json");
  const pkg = readJson(pkgPath);

  if (!pkg) {
    fail("package.json exists for scripts check", "valid JSON file", "file not found or invalid");
    return;
  }

  const scripts = pkg.scripts as Record<string, string> | undefined ?? {};
  const requiredScripts = ["dev", "build", "start", "lint", "typecheck", "test", "test:e2e"];

  for (const script of requiredScripts) {
    if (script in scripts) {
      pass(`package.json script: ${script}`);
    } else {
      fail(`package.json script: ${script}`, script, "not found");
    }
  }
}

// Check 3: tsconfig.json settings
function checkTsConfig(): void {
  const tsconfigPath = path.join(ROOT, "tsconfig.json");
  const tsconfig = readJson(tsconfigPath);

  if (!tsconfig) {
    fail("tsconfig.json exists and is valid JSON", "valid JSON file", "file not found or invalid");
    return;
  }

  const compilerOptions = tsconfig.compilerOptions as Record<string, unknown> | undefined ?? {};

  if (compilerOptions.strict === true) {
    pass('tsconfig.json: strict: true');
  } else {
    fail('tsconfig.json: strict', true, compilerOptions.strict ?? "not set");
  }

  const paths = compilerOptions.paths as Record<string, string[]> | undefined ?? {};
  const atSlashPaths = paths["@/*"];
  const expectedPaths = ["./src/*"];

  if (
    Array.isArray(atSlashPaths) &&
    atSlashPaths.length === expectedPaths.length &&
    atSlashPaths[0] === expectedPaths[0]
  ) {
    pass('tsconfig.json: paths["@/*"] = ["./src/*"]');
  } else {
    fail('tsconfig.json: paths["@/*"]', expectedPaths, atSlashPaths ?? "not set");
  }
}

// Check 4: next.config.ts reactStrictMode
function checkNextConfig(): void {
  const nextConfigPath = path.join(ROOT, "next.config.ts");
  const nextConfigJsPath = path.join(ROOT, "next.config.js");
  const nextConfigMjsPath = path.join(ROOT, "next.config.mjs");

  let content: string | null = null;
  let foundPath: string | null = null;

  for (const configPath of [nextConfigPath, nextConfigJsPath, nextConfigMjsPath]) {
    if (fs.existsSync(configPath)) {
      content = fs.readFileSync(configPath, "utf-8");
      foundPath = configPath;
      break;
    }
  }

  if (!content || !foundPath) {
    fail("next.config.ts exists", "next.config.ts file", "file not found");
    return;
  }

  pass(`next.config found: ${path.basename(foundPath)}`);

  if (content.includes("reactStrictMode: true")) {
    pass("next.config: reactStrictMode: true");
  } else {
    fail("next.config: reactStrictMode", "reactStrictMode: true", "not found in file");
  }
}

// Check 5: required source files exist
function checkSourceFiles(): void {
  const requiredFiles = [
    "src/app/layout.tsx",
    "src/app/page.tsx",
  ];

  for (const relPath of requiredFiles) {
    const fullPath = path.join(ROOT, relPath);
    if (fs.existsSync(fullPath)) {
      pass(`file exists: ${relPath}`);
    } else {
      fail(`file exists: ${relPath}`, relPath, "file not found");
    }
  }
}

// Check 6: required directories exist (per doc/design/app-architecture.md)
function checkRequiredDirectories(): void {
  const requiredDirs = [
    "src/app/(auth)/login",
    "src/app/(auth)/auth/callback",
    "src/app/(main)/chat",
    "src/app/api/chat",
    "src/app/api/sessions",
    "src/app/api/auth/signout",
    "src/lib/agents",
    "src/lib/tools",
    "src/lib/claude",
    "src/lib/db",
    "src/components/chat",
    "src/components/auth",
    "src/hooks",
    "src/styles",
    "src/types",
    "prompts/agents",
    "prompts/shared",
    "prompts/tools",
    "scripts",
    "tests/unit",
    "tests/integration",
    "tests/e2e",
    "supabase/migrations",
    ".github/workflows",
  ];

  for (const relPath of requiredDirs) {
    const fullPath = path.join(ROOT, relPath);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
      pass(`directory exists: ${relPath}`);
    } else {
      fail(`directory exists: ${relPath}`, relPath, "directory not found");
    }
  }
}

// Run all checks
checkPackageJsonDependencies();
checkPackageJsonScripts();
checkTsConfig();
checkNextConfig();
checkSourceFiles();
checkRequiredDirectories();

// Summary
if (failures === 0) {
  console.log("\nAll setup validations passed");
  process.exit(0);
} else {
  console.error(`\n${failures} validation(s) failed`);
  process.exit(1);
}
