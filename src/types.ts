import type { serializeToBuffer, unserializeFromBuffer } from "@ezez/utils";
import type { EZEZWebSocketClient } from "./Client";

const EVENT_AUTH = "ezez-ws::auth";
const EVENT_AUTH_OK = "ezez-ws::auth-ok";
const EVENT_AUTH_REJECTED = "ezez-ws::auth-rejected";

type ReservedNames = `ezez-ws::${string}`;
type ReservedEventKeys<T extends string> = {
    [K in T]?: never;
};

/**
 * Generic type representing all events with the data that will come with them.
 * @example
 * ```typescript
 * type IncomingEvents = {
 *     addItem: [item: string, quantity: number],
 *     removeItem: [item: string],
 * }
 * ```
 */
type TEvents = Record<string, unknown[]> & ReservedEventKeys<ReservedNames>;

type Ids = {
    eventId: number;
    replyTo: number | null;
};

type ReplyTupleUnion<
    IncomingEvents extends TEvents, OutgoingEvents extends TEvents,
    Client extends EZEZWebSocketClient<IncomingEvents, OutgoingEvents>,
> = {
    [K in keyof IncomingEvents]: [
        eventName: K, args: IncomingEvents[K], reply: Client["send"], ids: Ids,
    ]
}[keyof IncomingEvents];

type EventsToEventEmitter<
    IncomingEvents extends TEvents, OutgoingEvents extends TEvents,
    Client extends EZEZWebSocketClient<IncomingEvents, OutgoingEvents>,
> = {
    [K in keyof IncomingEvents]: (args: IncomingEvents[K], reply: Client["send"], ids: Ids) => void
};

type Callbacks<IncomingEvents extends TEvents, OutgoingEvents extends TEvents = IncomingEvents> = {
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
};

type AwaitingReply<IncomingEvents extends TEvents, OutgoingEvents extends TEvents = IncomingEvents> = {
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
     */
    auth: string;
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
};

export {
    EVENT_AUTH,
    EVENT_AUTH_OK,
    EVENT_AUTH_REJECTED,
};

export type {
    TEvents,
    ReplyTupleUnion,
    EventsToEventEmitter,
    Callbacks,
    Ids,
    AwaitingReply,
    Options,
};
