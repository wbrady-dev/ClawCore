export class ClawCoreError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = "ClawCoreError";
  }
}

export class ParseError extends ClawCoreError {
  constructor(message: string, public filePath?: string) {
    super(message, "PARSE_ERROR");
    this.name = "ParseError";
  }
}

export class EmbeddingError extends ClawCoreError {
  constructor(message: string) {
    super(message, "EMBEDDING_ERROR");
    this.name = "EmbeddingError";
  }
}

export class StorageError extends ClawCoreError {
  constructor(message: string) {
    super(message, "STORAGE_ERROR");
    this.name = "StorageError";
  }
}

export class CollectionNotFoundError extends ClawCoreError {
  constructor(collectionId: string) {
    super(`Collection not found: ${collectionId}`, "COLLECTION_NOT_FOUND");
    this.name = "CollectionNotFoundError";
  }
}

export class ServiceUnavailableError extends ClawCoreError {
  constructor(service: string) {
    super(`Service unavailable: ${service}`, "SERVICE_UNAVAILABLE");
    this.name = "ServiceUnavailableError";
  }
}
