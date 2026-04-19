/**
 * @jest-environment node
 *
 * src/lib/claude/local-cache.ts の単体テスト
 *
 * テスト対象:
 *   - LocalCache<T> クラス: lookup / store / clear / size
 *   - localCache シングルトン
 *
 * タイマー制御:
 *   - jest.useFakeTimers() により Date.now() もフェイク化される
 *   - TTL テストでは jest.advanceTimersByTime() で時間を進める
 */

import { LocalCache, localCache } from "@/lib/claude/local-cache";

// ---------------------------------------------------------------------------
// describe: 基本動作
// ---------------------------------------------------------------------------

describe("LocalCache - 基本動作", () => {
  let cache: LocalCache<string>;

  beforeEach(() => {
    cache = new LocalCache<string>();
  });

  test("1. 基本動作: store した値を lookup で取得できる", () => {
    // Arrange
    cache.store("key1", "value1");

    // Act
    const result = cache.lookup("key1");

    // Assert
    expect(result).toBe("value1");
  });

  test("2. 未知キー: 存在しないキーで lookup すると undefined が返る", () => {
    // Act
    const result = cache.lookup("unknown");

    // Assert
    expect(result).toBeUndefined();
  });

  test("3. 上書き: 同一キーで store を2回呼ぶと後者の値が返る", () => {
    // Arrange
    cache.store("key1", "first");
    cache.store("key1", "second");

    // Act
    const result = cache.lookup("key1");

    // Assert
    expect(result).toBe("second");
  });

  test("4. 複数キー独立: 異なるキーのエントリが独立して動作する", () => {
    // Arrange
    cache.store("keyA", "valueA");
    cache.store("keyB", "valueB");

    // Act & Assert
    expect(cache.lookup("keyA")).toBe("valueA");
    expect(cache.lookup("keyB")).toBe("valueB");
  });

  test("5. ジェネリクス: LocalCache<number> で数値を保存・取得できる", () => {
    // Arrange
    const numCache = new LocalCache<number>();
    numCache.store("num", 42);

    // Act
    const result = numCache.lookup("num");

    // Assert
    expect(result).toBe(42);
  });

  test("6. オブジェクト保存: 参照型を保存すると同一参照が返る", () => {
    // Arrange
    const objCache = new LocalCache<{ id: number; name: string }>();
    const obj = { id: 1, name: "test" };
    objCache.store("obj", obj);

    // Act
    const result = objCache.lookup("obj");

    // Assert
    expect(result).toBe(obj); // 同一参照
  });
});

// ---------------------------------------------------------------------------
// describe: size / clear
// ---------------------------------------------------------------------------

describe("LocalCache - size / clear", () => {
  let cache: LocalCache<string>;

  beforeEach(() => {
    cache = new LocalCache<string>();
  });

  test("7. size(): 0件→1件→2件→clear後0件", () => {
    // 初期状態
    expect(cache.size()).toBe(0);

    // 1件追加
    cache.store("k1", "v1");
    expect(cache.size()).toBe(1);

    // 2件追加
    cache.store("k2", "v2");
    expect(cache.size()).toBe(2);

    // clear 後
    cache.clear();
    expect(cache.size()).toBe(0);
  });

  test("8. clear(): 全エントリが削除され lookup が undefined を返す", () => {
    // Arrange
    cache.store("k1", "v1");
    cache.store("k2", "v2");

    // Act
    cache.clear();

    // Assert
    expect(cache.lookup("k1")).toBeUndefined();
    expect(cache.lookup("k2")).toBeUndefined();
    expect(cache.size()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// describe: TTL 動作
// ---------------------------------------------------------------------------

describe("LocalCache - TTL 動作", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("9. TTL 内はキャッシュヒット: store 直後の lookup で値が返る", () => {
    // Arrange
    const cache = new LocalCache<string>({ ttlSecs: 30 });
    cache.store("key", "value");

    // Act: TTL より短い時間を進める
    jest.advanceTimersByTime(29_000);

    // Assert
    expect(cache.lookup("key")).toBe("value");
  });

  test("10. TTL 経過後は undefined かつ内部 Map から削除される", () => {
    // Arrange
    const ttlSecs = 30;
    const cache = new LocalCache<string>({ ttlSecs });
    cache.store("key", "value");
    expect(cache.size()).toBe(1);

    // Act: TTL + 1ms 経過させる
    jest.advanceTimersByTime(ttlSecs * 1000 + 1);

    // Assert
    expect(cache.lookup("key")).toBeUndefined();
    // lookup 時に期限切れエントリが削除されるため size は 0
    expect(cache.size()).toBe(0);
  });

  test("11a. 境界値: expiresAt ちょうどの時刻では undefined が返る（Date.now() >= expiresAt）", () => {
    // Arrange
    const ttlSecs = 30;
    const cache = new LocalCache<string>({ ttlSecs });
    cache.store("key", "value");

    // Act: TTL ちょうどの時刻まで進める
    jest.advanceTimersByTime(ttlSecs * 1000);

    // Assert: Date.now() >= entry.expiresAt なので undefined
    expect(cache.lookup("key")).toBeUndefined();
  });

  test("11b. 境界値: expiresAt より 1ms 前は値が返る", () => {
    // Arrange
    const ttlSecs = 30;
    const cache = new LocalCache<string>({ ttlSecs });
    cache.store("key", "value");

    // Act: TTL - 1ms 進める
    jest.advanceTimersByTime(ttlSecs * 1000 - 1);

    // Assert: まだ有効
    expect(cache.lookup("key")).toBe("value");
  });

  test("12. TTL カスタム: new LocalCache({ ttlSecs: 60 }) で 60 秒 TTL が設定される", () => {
    // Arrange
    const cache = new LocalCache<string>({ ttlSecs: 60 });
    cache.store("key", "value");

    // 59 秒後はまだ有効
    jest.advanceTimersByTime(59_000);
    expect(cache.lookup("key")).toBe("value");

    // 60 秒ちょうど → 期限切れ
    jest.advanceTimersByTime(1_000);
    expect(cache.lookup("key")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// describe: 環境変数 TTL
// ---------------------------------------------------------------------------

describe("LocalCache - 環境変数 TTL", () => {
  const ENV_KEY = "LOCAL_CACHE_TTL_SECS";
  let originalValue: string | undefined;

  beforeEach(() => {
    originalValue = process.env[ENV_KEY];
    jest.useFakeTimers();
  });

  afterEach(() => {
    // 環境変数を元の状態に戻す
    if (originalValue === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = originalValue;
    }
    jest.useRealTimers();
  });

  test("13. 環境変数 TTL: LOCAL_CACHE_TTL_SECS=10 でインスタンス作成 → 10 秒 TTL", () => {
    // Arrange
    process.env[ENV_KEY] = "10";
    const cache = new LocalCache<string>();
    cache.store("key", "value");

    // 9 秒後はまだ有効
    jest.advanceTimersByTime(9_000);
    expect(cache.lookup("key")).toBe("value");

    // 10 秒ちょうど → 期限切れ
    jest.advanceTimersByTime(1_000);
    expect(cache.lookup("key")).toBeUndefined();
  });

  test("14. 無効な環境変数: LOCAL_CACHE_TTL_SECS=invalid → デフォルト 30 秒", () => {
    // Arrange
    process.env[ENV_KEY] = "invalid";
    const cache = new LocalCache<string>();
    cache.store("key", "value");

    // 29 秒後はまだ有効
    jest.advanceTimersByTime(29_000);
    expect(cache.lookup("key")).toBe("value");

    // 30 秒ちょうど → 期限切れ（デフォルト TTL）
    jest.advanceTimersByTime(1_000);
    expect(cache.lookup("key")).toBeUndefined();
  });

  test("15a. 負の環境変数: LOCAL_CACHE_TTL_SECS=-5 → デフォルト 30 秒", () => {
    // Arrange
    process.env[ENV_KEY] = "-5";
    const cache = new LocalCache<string>();
    cache.store("key", "value");

    // 29 秒後はまだ有効
    jest.advanceTimersByTime(29_000);
    expect(cache.lookup("key")).toBe("value");

    // 30 秒ちょうど → 期限切れ
    jest.advanceTimersByTime(1_000);
    expect(cache.lookup("key")).toBeUndefined();
  });

  test("15b. ゼロの環境変数: LOCAL_CACHE_TTL_SECS=0 → デフォルト 30 秒", () => {
    // Arrange
    process.env[ENV_KEY] = "0";
    const cache = new LocalCache<string>();
    cache.store("key", "value");

    // 29 秒後はまだ有効
    jest.advanceTimersByTime(29_000);
    expect(cache.lookup("key")).toBe("value");

    // 30 秒ちょうど → 期限切れ
    jest.advanceTimersByTime(1_000);
    expect(cache.lookup("key")).toBeUndefined();
  });

  test("コンストラクタ引数が環境変数より優先される", () => {
    // Arrange: 環境変数は 10 秒だが、コンストラクタ引数で 60 秒を指定
    process.env[ENV_KEY] = "10";
    const cache = new LocalCache<string>({ ttlSecs: 60 });
    cache.store("key", "value");

    // 30 秒後でもまだ有効（環境変数の 10 秒は無視される）
    jest.advanceTimersByTime(30_000);
    expect(cache.lookup("key")).toBe("value");

    // 60 秒ちょうど → 期限切れ
    jest.advanceTimersByTime(30_000);
    expect(cache.lookup("key")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// describe: シングルトン
// ---------------------------------------------------------------------------

describe("localCache シングルトン", () => {
  test("16. localCache は LocalCache のインスタンスである", () => {
    expect(localCache).toBeInstanceOf(LocalCache);
  });

  test("17. localCache は再 import でも同一インスタンスが返る（プロセス内シングルトン）", async () => {
    // Node.js のモジュールキャッシュにより同一インスタンスが返る
    const { localCache: localCache2 } = await import("@/lib/claude/local-cache");
    expect(localCache2).toBe(localCache);
  });

  test("localCache は store/lookup が正常に動作する", () => {
    // Arrange
    localCache.clear();
    localCache.store("singleton-key", "singleton-value");

    // Act
    const result = (localCache as LocalCache<string>).lookup("singleton-key");

    // Assert
    expect(result).toBe("singleton-value");

    // Cleanup
    localCache.clear();
  });
});
