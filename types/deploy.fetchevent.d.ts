export {};

declare global {
  class FetchEvent extends Event {
    request: Request;
    respondWith(response: Response | Promise<Response>): void;
  }

  interface FetchEventListener {
    (evt: FetchEvent): void | Promise<void>;
  }

  interface FetchEventListenerObject {
    handleEvent(evt: FetchEvent): void | Promise<void>;
  }

  type FetchEventListenerOrFetchEventListenerObject =
    | FetchEventListener
    | FetchEventListenerObject;

  function addEventListener(
    type: "fetch",
    callback: FetchEventListenerOrFetchEventListenerObject | null,
    options?: boolean | AddEventListenerOptions | undefined,
  ): void;
}
