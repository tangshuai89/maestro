/**
 * 最小 kuromoji 类型声明——npm 包不带 .d.ts 且无 @types/kuromoji。
 * 只声明我们用到的 builder().build() → tokenizer.tokenize() 那条路径。
 */
declare module 'kuromoji' {
  export interface IpadicFeatures {
    surface_form: string;
    /** 片假名读音（可能是 '*' 表示未知）。 */
    reading?: string;
    pronunciation?: string;
    [key: string]: unknown;
  }
  export interface Tokenizer {
    tokenize(text: string): IpadicFeatures[];
  }
  export interface Builder {
    build(cb: (err: Error | null, tokenizer: Tokenizer) => void): void;
  }
  export function builder(opts: { dicPath: string }): Builder;
}
