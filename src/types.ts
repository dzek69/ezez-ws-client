import type { serializeToBuffer, unserializeFromBuffer } from "@ezez/utils";
import type { ClientRequestArgs } from "http";
import type { ClientOptions, WebSocket as WSocket } from "ws";
import type { EZEZWebSocketClient } from "./Client";

const EVENT_AUTH = "ezez-ws::auth";
const EVENT_AUTH_OK = "ezez-ws::auth-ok";
const EVENT_AUTH_REJECTED = "ezez-ws::auth-rejected";
const EVENT_UNKNOWN_MESSAGE = "ezez-ws:incoming:unknown-message";
const EVENT_UNKNOWN_DATA_TYPE = "ezez-ws:incoming:unknown-data-type";

type ReservedNames = `ezez-ws::${string}`;
type ReservedAllowedIncomingNames = `ezez-ws:incoming:${string}`;

type ReservedEventKeys<T extends string> = {
    [K in T]?: never;
};

/**
 * Generic type representing incoming events (events you can listen to) with the data that will come with them.
 * Events starting with `ezez-ws::` are reserved and blocked.
 * Events starting with `ezez-ws:incoming:` are allowed (e.g., `ezez-ws:incoming:unknown-message`).
 * @example
 * ```typescript
 * type IncomingEvents = {
 *     addItem: [item: string, quantity: number],
 *     removeItem: [item: string],
 *     "ezez-ws:incoming:unknown-message": [data: unknown], // optional: type unknown messages
 * }
 * ```
 */
type TIncomingEvents = Record<string, unknown[]> & ReservedEventKeys<ReservedNames>;

/**
 * Generic type representing outgoing events (events you can send) with the data that will come with them.
 * Events starting with `ezez-ws::` and `ezez-ws:incoming:` are reserved and blocked.
 * @example
 * ```typescript
 * type OutgoingEvents = {
 *     sendMessage: [text: string],
 *     updateItem: [id: number, value: string],
 * }
 * ```
 */
type TOutgoingEvents = TIncomingEvents & ReservedEventKeys<ReservedAllowedIncomingNames>;

type Ids = {
    eventId: number;
    replyTo: number | null;
};

type ReplyTupleUnion<
    IncomingEvents extends TIncomingEvents, OutgoingEvents extends TOutgoingEvents,
    Client extends EZEZWebSocketClient<IncomingEvents, OutgoingEvents>,
> = {
    [K in keyof IncomingEvents]: [
        eventName: K, args: IncomingEvents[K], reply: Client["send"], ids: Ids,
    ]
}[keyof IncomingEvents];

type EventsToEventEmitter<
    IncomingEvents extends TIncomingEvents, OutgoingEvents extends TOutgoingEvents,
    Client extends EZEZWebSocketClient<IncomingEvents, OutgoingEvents>,
> = {
    [K in keyof IncomingEvents]: (args: IncomingEvents[K], reply: Client["send"], ids: Ids) => void
};

type Callbacks<IncomingEvents extends TIncomingEvents, OutgoingEvents extends TOutgoingEvents> = {
    /**
     * Called when the client is authenticated successfully.
     *
     * Note: This may be called multiple time if the client reconnects. Avoid adding event listeners in this callback
     * otherwise they will be duplicated after each reconnection.
     */
    onAuthOk?: () => void;
    /**
     * Called when the client got rejected during authentication. Auto reconnect is disabled after this event and you
     * need to create a new instance of the client to try again.
     * @param reason
     */
    onAuthRejected?: (reason: string) => void;
    /**
     * Called when a message (any event) is received from the server.
     * Use {@link EZEZWebSocketClient.on} to listen for specific events.
     * Please note that if a message is a reply and `onReply` function was given, then this listener will not be called.
     */
    onMessage?: <REvent extends ReplyTupleUnion<
        IncomingEvents, OutgoingEvents, EZEZWebSocketClient<IncomingEvents, OutgoingEvents>
    >>(
        ...replyArgs: REvent
    ) => void;
    /**
     * Called when the client is (re)connected. This is called before authentication is performed.
     * For re-subscribing to events after reconnection, use {@link onAuthOk} instead, to ensure your subscriptions will be accepted.
     */
    onConnect?: () => void;
    /**
     * Called when the client is disconnected for whatever reason.
     */
    onDisconnect?: () => void;
};

type AwaitingReply<IncomingEvents extends TIncomingEvents, OutgoingEvents extends TOutgoingEvents> = {
    /**
     * Time when registered the need for a reply, used to clean up old listeners that never got the reply
     */
    time: number;
    eventId: number;
    /**
     * The callback that will be called when the reply is received.
     */
    onReply: NonNullable<Callbacks<IncomingEvents, OutgoingEvents>["onMessage"]>;
};

type Options = {
    /**
     * Should the client automatically reconnect when the connection is closed?
     * Notice, if the auth is rejected or `close()` function is called manually, the client will not reconnect.
     */
    autoReconnect: boolean;
    /**
     * Auth key to send to the server.
     * Explicitly set to `null` to disable sending authentication in the @ezez/ws-server format.
     */
    auth: string | null;
    /**
     * Custom data serializer options, see `@ezez/utils - serializeToBuffer`
     * Your custom serializer must be compatible with custom deserializer on the server side
     */
    serializerArgs?: Parameters<typeof serializeToBuffer>[1];
    /**
     * Custom data unserializer options, see `@ezez/utils - unserializeFromBuffer`
     * Your custom unserializer must be compatible with custom serializer on the server side
     */
    unserializerArgs?: Parameters<typeof unserializeFromBuffer>[1];
    /**
     * How to handle messages that client tries to send when not connected to the server.
     * - "ignore": ignore the message
     * - "throw": throw an error
     * - "queueAfterAuth": queue the message until reconnected and authentication is successful (message won't be queued
     * if the connection is closed manually or auth is rejected)
     */
    sendWhenNotConnected?: "ignore" | "throw" | "queueAfterAuth";
    /**
     * The number of milliseconds after which the client will clear the awaiting replies.
     * This prevents memory leaks in case the client is waiting for a reply that will never come.
     * It must be greater than 0, by default it is set to 5 minutes.
     *
     * If clearing occurs and then the awaited reply arrives, it will still be emitted and caught by the `onMessage` and
     * `on(eventName)` listeners. Use the `ids` parameter to check if something was meant to be a reply if that's
     * important.
     *
     * The check occurs every 15 seconds, so the actual clearing time may be longer than specified.
     */
    clearAwaitingRepliesAfterMs?: number;
    /**
     * How to handle messages received from the server that are not recognized as valid @ezez/ws-server messages.
     * - "ignore": ignore the message
     * - "emit": emit an `ezez-ws::unknown-message` event (please use `EVENT_UNKNOWN_MESSAGE` const for comparison) with
     * the raw data as argument
     * - "emitTryJson": emit an `ezez-ws::unknown-message` event with the parsed JSON data as argument, or raw data
     * if parsing fails
     *
     * Unknown messages cannot be replied to (it's no-op), their eventId is always `-1`.
     */
    unknownMessages: "ignore" | "emit" | "emitTryJson";
    /**
     * How to handle data received in the "onMessage" callback of the socket client that is of an unknown type.
     * Currently supported types are MessageEvent with string or ArrayBuffer data.
     * - "ignore": ignore the data (maximum compatibility)
     * - "emit": emit the data as is in an `ezez-ws::unknown-data-type` event (please use `EVENT_UNKNOWN_DATA_TYPE` const for comparison)
     * - "throw": throw an error when such data is received
     */
    unknownDataType: "ignore" | "emit" | "throw";
    /**
     * Custom WebSocket constructor to use instead of the global WebSocket.
     * Useful for Node.js, where native WebSocket cannot do a proper handshake, because server verifies headers, etc.
     * Only native WebSocket and `ws` package are supported.
     */
    WSConstructor?: typeof WebSocket | typeof WSocket;
    /**
     * Extra third argument to pass to the WebSocket constructor when using a custom one (`ws` package).
     * Ignored if native WebSocket is used.
     */
    wsConstructorExtraArg?: ClientOptions | ClientRequestArgs;
};

export {
    EVENT_AUTH,
    EVENT_AUTH_OK,
    EVENT_AUTH_REJECTED,
    EVENT_UNKNOWN_MESSAGE,
    EVENT_UNKNOWN_DATA_TYPE,
};

export type {
    TIncomingEvents,
    TOutgoingEvents,
    ReplyTupleUnion,
    EventsToEventEmitter,
    Callbacks,
    Ids,
    AwaitingReply,
    Options,
};
