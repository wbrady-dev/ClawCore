export class ThreadClawError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = "ThreadClawError";
  }
}

export class ParseError extends ThreadClawError {
  constructor(message: string, public filePath?: string) {
    super(message, "PARSE_ERROR");
    this.name = "ParseError";
  }
}

export class EmbeddingError extends ThreadClawError {
  constructor(message: string) {
    super(message, "EMBEDDING_ERROR");
    this.name = "EmbeddingError";
  }
}
