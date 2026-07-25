export interface ContainerChatFailure {
  readonly summary: string;
  readonly detail: string | null;
}

export class ContainerChatFailureError extends Error {
  readonly failure: ContainerChatFailure;

  constructor(failure: ContainerChatFailure, options?: ErrorOptions) {
    super(failure.summary, options);
    this.name = "ContainerChatFailureError";
    this.failure = failure;
  }
}
