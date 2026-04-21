/**
 * @jest-environment node
 *
 * src/lib/claude/cache-storage.ts の単体テスト
 *
 * テスト対象:
 *   - CacheStorage<T> インタフェース: 型適合チェック
 *   - MapCacheStorage<T> クラス: get / set / delete / clear / size
 */

import { MapCacheStorage, type CacheStorage } from "@/lib/claude/cache-storage";

// ---------------------------------------------------------------------------
// describe: MapCacheStorage 正常系
// ---------------------------------------------------------------------------

describe("MapCacheStorage - 正常系", () => {
  test("1. 空初期化: new MapCacheStorage().size() → 0", () => {
    // Arrange & Act
    const storage = new MapCacheStorage<string>();

    // Assert
    expect(storage.size()).toBe(0);
  });

  test("2. set/get 基本: set した値を get で取得できる", () => {
    // Arrange
    const storage = new MapCacheStorage<string>();

    // Act
    storage.set("key1", "value1");
    const result = storage.get("key1");

    // Assert
    expect(result).toBe("value1");
  });

  test("3. get 未知キー: 存在しないキーは undefined が返る", () => {
    // Arrange
    const storage = new MapCacheStorage<string>();

    // Act
    const result = storage.get("nonexistent");

    // Assert
    expect(result).toBeUndefined();
  });

  test("4. 上書き: 同一キーで 2 回 set すると後者の値が返る", () => {
    // Arrange
    const storage = new MapCacheStorage<string>();
    storage.set("key", "first");

    // Act
    storage.set("key", "second");
    const result = storage.get("key");

    // Assert
    expect(result).toBe("second");
  });

  test("5. delete 存在: set 後 delete すると true が返り、get が undefined になる", () => {
    // Arrange
    const storage = new MapCacheStorage<string>();
    storage.set("key", "value");

    // Act
    const deleted = storage.delete("key");
    const result = storage.get("key");

    // Assert
    expect(deleted).toBe(true);
    expect(result).toBeUndefined();
  });

  test("6. delete 未存在: 存在しないキーの delete は false が返る", () => {
    // Arrange
    const storage = new MapCacheStorage<string>();

    // Act
    const deleted = storage.delete("nonexistent");

    // Assert
    expect(deleted).toBe(false);
  });

  test("7. clear: 複数キーを set 後 clear すると size が 0 になり各キーが undefined になる", () => {
    // Arrange
    const storage = new MapCacheStorage<string>();
    storage.set("k1", "v1");
    storage.set("k2", "v2");
    storage.set("k3", "v3");

    // Act
    storage.clear();

    // Assert
    expect(storage.size()).toBe(0);
    expect(storage.get("k1")).toBeUndefined();
    expect(storage.get("k2")).toBeUndefined();
    expect(storage.get("k3")).toBeUndefined();
  });

  test("8. size 増減: 0 → set 1件 → 1 → set 2件目 → 2 → delete 1件 → 1", () => {
    // Arrange
    const storage = new MapCacheStorage<string>();

    // 初期状態
    expect(storage.size()).toBe(0);

    // 1件追加
    storage.set("k1", "v1");
    expect(storage.size()).toBe(1);

    // 2件追加
    storage.set("k2", "v2");
    expect(storage.size()).toBe(2);

    // 1件削除
    storage.delete("k1");
    expect(storage.size()).toBe(1);
  });

  test("9. ジェネリクス: MapCacheStorage<number> で数値を保存・取得できる", () => {
    // Arrange
    const storage = new MapCacheStorage<number>();

    // Act
    storage.set("num", 42);
    const result = storage.get("num");

    // Assert
    expect(result).toBe(42);
  });

  test("10. 参照型: オブジェクトを保存すると同一参照が返る", () => {
    // Arrange
    const storage = new MapCacheStorage<{ id: number; name: string }>();
    const obj = { id: 1, name: "test" };

    // Act
    storage.set("obj", obj);
    const result = storage.get("obj");

    // Assert
    expect(result).toBe(obj); // 同一参照
  });
});

// ---------------------------------------------------------------------------
// describe: CacheStorage インタフェース適合
// ---------------------------------------------------------------------------

describe("CacheStorage インタフェース適合", () => {
  test("11. MapCacheStorage は CacheStorage<T> 型として代入可能", () => {
    // TypeScript のコンパイル時チェック: 型エラーが起きなければパス
    // 実行時にも代入が成功していることで間接的に確認する
    const storage: CacheStorage<string> = new MapCacheStorage<string>();

    // CacheStorage インタフェースのすべてのメソッドが存在することを確認
    expect(typeof storage.get).toBe("function");
    expect(typeof storage.set).toBe("function");
    expect(typeof storage.delete).toBe("function");
    expect(typeof storage.clear).toBe("function");
    expect(typeof storage.size).toBe("function");
  });

  test("12. type-only import: CacheStorage は型としてのみ import して使用できる", () => {
    // CacheStorage を型注釈として使用し、MapCacheStorage のインスタンスを代入できることを確認
    // `import type { CacheStorage }` の動作確認を実行時テストで代替する
    const createStorage = <T>(): CacheStorage<T> => new MapCacheStorage<T>();
    const storage = createStorage<string>();

    storage.set("key", "value");
    expect(storage.get("key")).toBe("value");
  });
});
