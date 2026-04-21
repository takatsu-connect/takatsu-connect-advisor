/**
 * インメモリ TTL キャッシュ（LocalCache）
 *
 * 設計書: doc/design/agent-system-design.md §9.3 ローカル完全一致キャッシュ
 *
 * - SHA-256 ハッシュ文字列をキーとして受け取り、CacheStorage で管理する
 * - キー生成（SHA-256 ハッシュ化）は呼び出し元が実施する（34j.2 の責務）
 * - ストレージ層は CacheStorage インタフェースで抽象化（34j.3 の責務）
 * - Node.js は単一スレッドのため排他制御は不要
 * - Vercel Serverless は複数インスタンスに分散するためキャッシュは同一インスタンス内のみ有効
 */

import { MapCacheStorage, type CacheStorage } from "./cache-storage";

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

/**
 * キャッシュエントリ。value と有効期限（epoch ms）を保持する。
 */
export interface LocalCacheEntry<T> {
  value: T;
  /** 有効期限（Unix epoch ミリ秒）。この時刻以降は期限切れとみなす */
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// LocalCache クラス
// ---------------------------------------------------------------------------

/**
 * SHA-256 ハッシュ文字列をキーとする TTL 付きインメモリキャッシュ。
 *
 * TTL の解決順序:
 * 1. コンストラクタ引数 `options.ttlSecs`
 * 2. 環境変数 `LOCAL_CACHE_TTL_SECS`
 * 3. デフォルト値: 30 秒
 *
 * ストレージ層は `options.storage` で DI 可能。
 * 未指定の場合は `MapCacheStorage`（インメモリ Map）を使用する。
 *
 * @template T キャッシュする値の型
 */
export class LocalCache<T = unknown> {
  private readonly storage: CacheStorage<LocalCacheEntry<T>>;
  private readonly ttlMs: number;

  constructor(options?: {
    ttlSecs?: number;
    /** ストレージ実装の DI。未指定時は MapCacheStorage を使用 */
    storage?: CacheStorage<LocalCacheEntry<T>>;
  }) {
    const ttlSecs = options?.ttlSecs ?? Number(process.env.LOCAL_CACHE_TTL_SECS ?? 30);

    // NaN や 0 以下の値はデフォルト 30 秒にフォールバック
    this.ttlMs = (Number.isFinite(ttlSecs) && ttlSecs > 0 ? ttlSecs : 30) * 1000;
    this.storage = options?.storage ?? new MapCacheStorage<LocalCacheEntry<T>>();
  }

  /**
   * キャッシュを検索する。
   *
   * - エントリが存在しない場合は `undefined` を返す
   * - TTL 期限切れの場合はエントリを削除して `undefined` を返す
   *
   * @param key SHA-256 ハッシュ文字列（呼び出し元が生成）
   * @returns キャッシュヒット時は値、それ以外は `undefined`
   */
  lookup(key: string): T | undefined {
    const entry = this.storage.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.storage.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /**
   * キャッシュに値を保存する。
   * 既存エントリがある場合は上書きする。
   *
   * @param key SHA-256 ハッシュ文字列（呼び出し元が生成）
   * @param value 保存する値
   */
  store(key: string, value: T): void {
    this.storage.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  /**
   * すべてのエントリを削除する。
   * テスト・デバッグ用途。
   */
  clear(): void {
    this.storage.clear();
  }

  /**
   * 現在格納されているエントリ数を返す（期限切れ含む）。
   * テスト・デバッグ用途。
   */
  size(): number {
    return this.storage.size();
  }
}

// ---------------------------------------------------------------------------
// デフォルトシングルトンインスタンス
// ---------------------------------------------------------------------------

/**
 * プロセスローカルのシングルトンキャッシュ。
 * `CachedChatResult` 型は pipeline.ts / api/chat で定義される想定。
 * 型パラメータは呼び出し元が `as LocalCache<CachedChatResult>` でキャストする。
 */
export const localCache = new LocalCache();
