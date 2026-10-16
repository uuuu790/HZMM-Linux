// Minimal declarations for main-process dependencies that ship no types.
// Only the surface HZMM calls is declared — extend as usage grows.

declare module 'node-7z' {
  export interface SevenOptions {
    /** Path to the 7za binary. */
    $bin?: string
    [option: string]: unknown
  }

  /** One `list` entry, as node-7z reports 7za's fields. */
  export interface SevenEntry {
    file?: string
    /** e.g. 'D....' for a directory. */
    attributes?: string
    /** Uncompressed size in bytes. */
    size?: number
    [field: string]: unknown
  }

  /** node-7z's event stream around the spawned 7za process. */
  export interface SevenStream {
    on(event: 'data', listener: (entry: SevenEntry) => void): this
    on(event: 'end', listener: () => void): this
    on(event: 'error', listener: (err: Error) => void): this
  }

  const Seven: {
    list(archive: string, options?: SevenOptions): SevenStream
    extractFull(archive: string, output: string, options?: SevenOptions): SevenStream
  }
  export default Seven
}

declare module 'luaparse' {
  export interface ParseOptions {
    luaVersion?: '5.1' | '5.2' | '5.3' | 'LuaJIT'
    comments?: boolean
    scope?: boolean
    locations?: boolean
    ranges?: boolean
    [option: string]: unknown
  }

  const luaparse: {
    /** Returns the AST; throws a SyntaxError-like error on invalid input. */
    parse(code: string, options?: ParseOptions): unknown
  }
  export default luaparse
}
