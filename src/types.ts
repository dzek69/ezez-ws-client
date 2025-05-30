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
};
