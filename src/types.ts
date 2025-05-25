import type { serializeToBuffer, unserializeFromBuffer } from "@ezez/utils";
import type { EZEZWebSocketClient } from "./Client";

const EVENT_AUTH = "ezez-ws::auth";
const EVENT_AUTH_OK = "ezez-ws::auth-ok";
const EVENT_AUTH_REJECTED = "ezez-ws::auth-rejected";

type ReservedNames = typeof EVENT_AUTH | typeof EVENT_AUTH_OK | typeof EVENT_AUTH_REJECTED;
type ReservedEventKeys<T extends string> = {
    [K in T]?: never;
};
type TEvents = Record<string, unknown[]> & ReservedEventKeys<ReservedNames>;

type Ids = {
    eventId: number;
    replyTo: number | null;
};

type ReplyTupleUnion<Events extends TEvents, reply> = {
    [K in keyof Events]: [eventName: K, args: Events[K], reply: reply, ids: Ids]
}[keyof Events];

type Callbacks<Events extends TEvents> = {
    /**
     * Called when the client is authenticated successfully.
     *
     * Note: This may be called multiple time if the client reconnects.
     */
    onAuthOk?: () => void;
    /**
     * Called when the client is rejected. Auto reconnect is disabled after this event.
     * @param reason
     */
    onAuthRejected?: (reason: string) => void;
    onMessage?: <REvent extends ReplyTupleUnion<Events, EZEZWebSocketClient<Events>["send"]>>(
        ...replyArgs: REvent
    ) => void;
};

type AwaitingReply<Events extends TEvents> = {
    /**
     * Time when registered the need for a reply, used to clean up old listeners that never got the reply
     */
    time: number;
    eventId: number;
    /**
     * The callback that will be called when the reply is received.
     */
    onReply: NonNullable<Callbacks<Events>["onMessage"]>;
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
};

export {
    EVENT_AUTH,
    EVENT_AUTH_OK,
    EVENT_AUTH_REJECTED,
};

export type {
    TEvents,
    ReplyTupleUnion,
    Callbacks,
    Ids,
    AwaitingReply,
    Options,
};
