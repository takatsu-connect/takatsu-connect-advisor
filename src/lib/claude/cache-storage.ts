/**
 * LocalCache の内部ストレージ層
 *
 * 設計書: doc/design/agent-system-design.md §9.3 ローカル完全一致キャッシュ
 *
 * 現在は Map ベース実装（インメモリ）のみを提供するが、
 * 将来ファイル / Redis / DB 等のストレージに差し替え可能にするための
 * 抽象インタフェースとして定義している。
 */

// ---------------------------------------------------------------------------
// インタフェース
// ---------------------------------------------------------------------------

/**
 * LocalCache の内部ストレージを抽象化するインタフェース。
 *
 * @template T ストアする値の型
 */
export interface CacheStorage<T> {
  /**
   * キーに対応する値を取得する。
   * キーが存在しない場合は `undefined` を返す。
   */
  get(key: string): T | undefined;

  /**
   * キーと値のペアを保存する。
   * 既存のキーがある場合は上書きする。
   */
  set(key: string, value: T): void;

  /**
   * キーに対応するエントリを削除する。
   *
   * @returns 削除した場合は `true`、キーが存在しなかった場合は `false`
   */
  delete(key: string): boolean;

  /**
   * すべてのエントリを削除する。
   */
  clear(): void;

  /**
   * 格納されているエントリ数を返す。
   */
  size(): number;
}

// ---------------------------------------------------------------------------
// Map ベース実装
// ---------------------------------------------------------------------------

/**
 * Map ベースのストレージ実装（インメモリ、単一プロセス内）。
 *
 * Node.js は単一スレッドのため排他制御は不要。
 * Vercel Serverless は複数インスタンスに分散するため、
 * このストレージは同一インスタンス内でのみ有効。
 *
 * @template T ストアする値の型
 */
export class MapCacheStorage<T> implements CacheStorage<T> {
  private readonly map = new Map<string, T>();

  get(key: string): T | undefined {
    return this.map.get(key);
  }

  set(key: string, value: T): void {
    this.map.set(key, value);
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  size(): number {
    return this.map.size;
  }
}
