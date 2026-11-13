declare module 'word-extractor' {
  export interface ExtractedWordDocument {
    getBody(): string;
    getHeaders(): string;
    getFootnotes(): string;
    getEndnotes(): string;
  }
  export default class WordExtractor {
    extract(filePathOrBuffer: string | Buffer): Promise<ExtractedWordDocument>;
  }
}
