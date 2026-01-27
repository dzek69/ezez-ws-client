/* eslint-disable max-lines */

import { noop, rethrow, safe, serializeToBuffer, unserializeFromBuffer } from "@ezez/utils";
import EventEmitter from "eventemitter3";

import type { WebSocket as WSocket } from "ws";
import type {
    AwaitingReply, Callbacks, EventsToEventEmitter, Ids, Options, ReplyTupleUnion, TIncomingEvents, TOutgoingEvents,
} from "./types";

import {
    EVENT_AUTH, EVENT_AUTH_OK, EVENT_AUTH_REJECTED, EVENT_UNKNOWN_DATA_TYPE,
    EVENT_UNKNOWN_MESSAGE,
} from "./types";
import { extractMessage } from "./utils";

type DefaultOptions = Required<Pick<
    Options,
    | "sendWhenNotConnected" | "autoReconnect" | "auth"
    | "clearAwaitingRepliesAfterMs" | "unknownMessages" | "unknownDataType" | "WSConstructor"
>>;

const defaultOptions: DefaultOptions = {
    sendWhenNotConnected: "queueAfterAuth",
    autoReconnect: true,
    auth: "",
    // eslint-disable-next-line @typescript-eslint/no-magic-numbers
    clearAwaitingRepliesAfterMs: 5 * 60 * 1000, // 5 minutes
    unknownMessages: "ignore",
    unknownDataType: "ignore",
    WSConstructor: WebSocket,
};

const RECONNECT_TIMEOUT = 1000;
const AWAITING_REPLIES_INTERVAL = 15_000;
const PROTOCOL_VERSION = 1;
const NOT_FOUND = -1;

// TODO messages from the queue are sent after auth ok, but they are not put in the queue if connected but not authenticated

class EZEZWebSocketClient<
    IncomingEvents extends TIncomingEvents,
    OutgoingEvents extends TOutgoingEvents = Extract<IncomingEvents, TOutgoingEvents>,
> {
    private readonly _url: ConstructorParameters<typeof WebSocket>[0];

    private readonly _protocols: ConstructorParameters<typeof WebSocket>[1];

    private readonly _options: Options & DefaultOptions;

    private _client!: WebSocket | WSocket;

    private _autoReconnect: boolean;

    private _id = 0;

    /**
     * Did the client close the connection at least once? Used to determine if the message should be queued or ignored
     * when autoReconnect is disabled.
     */
    private _closedOnce = false;

    private readonly _serialize: (...args: unknown[]) => Buffer;

    private readonly _unserialize: (rawData: (Buffer | Uint8Array)) => unknown[];

    /**
     * List of sent messages that are waiting for a reply.
     */
    private readonly _awaitingReplies: Array<AwaitingReply<IncomingEvents, OutgoingEvents>> = [];

    private readonly _queue: Array<{
        [K in keyof OutgoingEvents]: [
            K, OutgoingEvents[K], undefined | (
                <REvent extends ReplyTupleUnion<
                    IncomingEvents, OutgoingEvents, EZEZWebSocketClient<IncomingEvents, OutgoingEvents>
                >>(
                    ...replyArgs: REvent
                ) => void
            ), sendAsJson: boolean,
        ];
    }[keyof OutgoingEvents]> = [];

    private readonly _callbacks: Callbacks<IncomingEvents, OutgoingEvents>;

    public send: <TEvent extends keyof OutgoingEvents>(
        eventName: TEvent,
        args: OutgoingEvents[TEvent],
        onReply?: <REvent extends ReplyTupleUnion<
            IncomingEvents, OutgoingEvents, EZEZWebSocketClient<IncomingEvents, OutgoingEvents>
        >>(
            ...replyArgs: REvent
        ) => void,
    ) => Ids | undefined;

    public sendJson: <TEvent extends keyof OutgoingEvents>(
        eventName: TEvent,
        args: OutgoingEvents[TEvent][0],
    ) => void;

    private readonly _ee: EventEmitter<EventsToEventEmitter<
        IncomingEvents, OutgoingEvents,
        EZEZWebSocketClient<IncomingEvents, OutgoingEvents>
    >>;

    /**
     * Registers an event listener for given event.
     * Please note that if a message is a reply and `onReply` function was given, then this listener will not be called.
     */
    public readonly on: OmitThisParameter<EventEmitter<EventsToEventEmitter<
        IncomingEvents, OutgoingEvents,
        EZEZWebSocketClient<IncomingEvents, OutgoingEvents>
    >>["on"]>;

    /**
     * Unregisters an event listener for given event.
     */
    public readonly off: OmitThisParameter<EventEmitter<EventsToEventEmitter<
        IncomingEvents, OutgoingEvents,
        EZEZWebSocketClient<IncomingEvents, OutgoingEvents>
    >>["off"]>;

    /**
     * Registers an event listener for given event, which will be called only once.
     * Please note that if a message is a reply and `onReply` function was given, then this listener will not be called.
     */
    public readonly once: OmitThisParameter<EventEmitter<EventsToEventEmitter<
        IncomingEvents, OutgoingEvents,
        EZEZWebSocketClient<IncomingEvents, OutgoingEvents>
    >>["once"]>;

    private readonly _awaitingRepliesIntervalId: ReturnType<typeof setInterval>;

    // eslint-disable-next-line max-statements
    public constructor(
        url: ConstructorParameters<typeof WebSocket>[0], protocols?: ConstructorParameters<typeof WebSocket>[1],
        options: Partial<Options> = {},
        callbacks?: Callbacks<IncomingEvents, OutgoingEvents>,
    ) {
        this._url = url;
        this._protocols = protocols;
        this._options = { ...defaultOptions, ...options };
        if (this._options.clearAwaitingRepliesAfterMs <= 0) {
            throw new Error("`clearAwaitingRepliesAfterMs` must be greater than 0");
        }

        this._autoReconnect = this._options.autoReconnect;
        this._callbacks = callbacks ?? {};
        this._ee = new EventEmitter();
        this.on = this._ee.on.bind(this._ee);
        this.off = this._ee.off.bind(this._ee);
        this.once = this._ee.once.bind(this._ee);

        this._serialize = serializeToBuffer.bind(null, Buffer, options.serializerArgs ?? []);
        this._unserialize = unserializeFromBuffer.bind(null, Buffer, options.unserializerArgs ?? []);

        this._awaitingRepliesIntervalId = setInterval(this._checkAwaitingReplies, AWAITING_REPLIES_INTERVAL);

        this.send = (eventName, args, onReply) => {
            return this._send(eventName, args, null, onReply);
        };
        this.sendJson = (eventName, arg) => {
            return this._send(eventName, [arg] as OutgoingEvents[typeof eventName], null, undefined, true); // eslint-disable-line @typescript-eslint/consistent-type-assertions
        };

        this._connect();
    }

    private _connect() {
        this._client = new this._options.WSConstructor(
            this._url, this._protocols, this._options.wsConstructorExtraArg,
        );
        this._client.binaryType = "arraybuffer";
        this._client.addEventListener("close", this._handleClose);
        this._client.addEventListener("open", this._handleOpen);
        this._client.addEventListener("message", this._handleMessage);
    }

    private readonly _handleClose = () => {
        this._closedOnce = true;
        this._client.removeEventListener("close", this._handleClose);
        this._client.removeEventListener("open", this._handleOpen);
        this._client.removeEventListener("message", this._handleMessage);

        if (this._autoReconnect) {
            setTimeout(() => {
                this._connect();
            }, RECONNECT_TIMEOUT);
        }

        this._callbacks.onDisconnect?.();
    };

    private readonly _handleOpen = () => {
        if (this._options.auth !== null) {
            this._client.send(this._serialize(EVENT_AUTH, this._options.auth, PROTOCOL_VERSION));
        }
        this._callbacks.onConnect?.();
    };

    private readonly _handleUnknownDataType = (data: unknown): null => {
        if (this._options.unknownDataType === "ignore") {
            return null;
        }
        if (this._options.unknownDataType === "emit") {
            this._callbacks.onMessage?.(
                EVENT_UNKNOWN_DATA_TYPE as keyof IncomingEvents,
                [data] as any, // eslint-disable-line @typescript-eslint/no-explicit-any
                noop,
                { eventId: -1, replyTo: null },
            );
            return null;
        }

        throw new Error("Unexpected message type");
    };

    // eslint-disable-next-line max-lines-per-function
    private readonly _handleMessage = (messageOrEvent: unknown) => {
        // eslint-disable-next-line max-statements
        (async () => {
            const message = await extractMessage(messageOrEvent)
                .catch(() => this._handleUnknownDataType(messageOrEvent));

            if (message === null) {
                // Error handled gracefully
                return;
            }

            if (typeof message === "string") {
                if (["emit", "emitTryJson"].includes(this._options.unknownMessages)) {
                    const finalMsg = this._options.unknownMessages === "emit"
                        ? message
                        : safe(() => JSON.parse(message) as unknown, message);
                    this._callbacks.onMessage?.(
                        EVENT_UNKNOWN_MESSAGE as keyof IncomingEvents,
                        [finalMsg] as any, // eslint-disable-line @typescript-eslint/no-explicit-any
                        noop,
                        { eventId: -1, replyTo: null },
                    );
                }
                return;
            }

            // TODO nicer handle of messages that cannot be deserialized, not always throwing
            const data = this._unserialize(message);

            const eventName = data[0] as keyof IncomingEvents;
            const [, eventId, replyTo, ...args] = data as [
                keyof IncomingEvents, number, number | null, ...IncomingEvents[typeof eventName],
            ];

            if (eventName === EVENT_AUTH_OK) {
                this._callbacks.onAuthOk?.();
                this._queue.forEach(([queuedEventName, queuedArgs, queuedReply, sendAsJson]) => {
                    this._send(queuedEventName, queuedArgs, null, queuedReply, sendAsJson);
                });
                this._queue.length = 0;
                return;
            }
            if (eventName === EVENT_AUTH_REJECTED) {
                this._cleanUp();
                this._callbacks.onAuthRejected?.(data[1] as string);
                return;
            }

            type ReplyFn = Parameters<NonNullable<Callbacks<IncomingEvents, OutgoingEvents>["onMessage"]>>[2];
            const replyFn: ReplyFn = (_eventName, _args, onReply) => this._send(_eventName, _args, eventId, onReply);

            if (replyTo) {
                const replyIdx = this._awaitingReplies.findIndex((reply) => reply.eventId === replyTo);
                if (replyIdx !== NOT_FOUND) {
                    const reply = this._awaitingReplies[replyIdx]!;
                    this._awaitingReplies.splice(replyIdx, 1);
                    reply.onReply(eventName, args, replyFn, { eventId, replyTo });
                    return;
                }
            }

            this._callbacks.onMessage?.(eventName, args, replyFn, { eventId, replyTo });
            // @ts-expect-error not sure why emit does not like the type, `on` works flawlessly
            this._ee.emit(eventName, args, replyFn, { eventId, replyTo });
        })().catch(rethrow);
    };

    public get alive() {
        return this._client.readyState === WebSocket.OPEN;
    }

    // eslint-disable-next-line max-statements
    private _send<TEvent extends keyof OutgoingEvents>(
        eventName: TEvent, args: OutgoingEvents[TEvent], replyId: number | null = null,
        onReply?: <REvent extends ReplyTupleUnion<
            IncomingEvents, OutgoingEvents, EZEZWebSocketClient<IncomingEvents, OutgoingEvents>
        >>(
            ...replyArgs: REvent
        ) => void,
        sendAsJson = false,
    ): Ids | undefined {
        const client = this._client;
        if (!this.alive) {
            if (this._options.sendWhenNotConnected === "throw") {
                throw new Error("Can't send message - client is disconnected");
            }
            if (this._options.sendWhenNotConnected === "ignore") {
                return;
            }

            if (!this._autoReconnect && this._closedOnce) {
                // If the client was closed at least once and the autoReconnect is disabled, then there will be no
                // opportunity to send the message, so we ignore it
                return;
            }

            // The connection had not been established yet
            this._queue.push([eventName, args, onReply, sendAsJson]);

            return;
        }

        if (sendAsJson) {
            client.send(JSON.stringify(args[0]));
        }
        else {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            const _args = args ? args : [];
            client.send(this._serialize(eventName, ++this._id, replyId, ..._args));
        }

        if (onReply) {
            this._awaitingReplies.push({
                time: Date.now(),
                eventId: this._id,
                onReply,
            });
        }

        return { eventId: this._id, replyTo: replyId };
    }

    private readonly _checkAwaitingReplies = () => {
        const now = Date.now();
        for (let i = this._awaitingReplies.length - 1; i >= 0; i--) {
            const reply = this._awaitingReplies[i];
            if (now - reply!.time > this._options.clearAwaitingRepliesAfterMs) {
                this._awaitingReplies.splice(i, 1);
            }
        }
    };

    /**
     * Get raw WebSocket client, please note that this is current client and if reconnect happens you need to get the
     * new client again or you will just keep the reference to the old one.
     *
     * Additionally be warned that sending messages directly to the WebSocket client is not recommended.
     */
    public get client() {
        return this._client;
    }

    /**
     * Close the connection and stop auto reconnecting.
     */
    public close() {
        this._cleanUp();
        this._client.close();
    }

    private _cleanUp() {
        clearInterval(this._awaitingRepliesIntervalId);
        this._ee.removeAllListeners();
        this._autoReconnect = false;
        this._awaitingReplies.length = 0;
    }

    /**
     * Gets the count of messages that are waiting for a reply.
     */
    public get awaitingRepliesCount(): number {
        return this._awaitingReplies.length;
    }
}

type InferInOut<X extends EZEZWebSocketClient<any, any>> // eslint-disable-line @typescript-eslint/no-explicit-any
    = X extends EZEZWebSocketClient<infer In, infer Out> ? [In, Out] : never;

/**
 * Utility type for typing event handler callbacks that can be defined outside of inline `client.on()` calls.
 *
 * @template Srv - The client type (use `typeof yourClientInstance`)
 * @template Ev - The event name (must be a key of IncomingEvents)
 *
 * @example
 * ```typescript
 * const ws = new EZEZWebsocketClient<IncomingEvents, OutgoingEvents>(...);
 *
 * const ping2Handler: OnCallback<typeof ws, "ping2"> = (args, reply, ids) => {
 *   // args, reply, etc. are typed
 * };
 *
 * client.on("ping2", ping2Handler);
 * ```
 */
type OnCallback<
    Cli extends EZEZWebSocketClient<any, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
    Ev extends keyof InferInOut<Cli>[0],
> = EventsToEventEmitter<InferInOut<Cli>[0], InferInOut<Cli>[1], Cli>[Ev];

export type {
    OnCallback,
    TIncomingEvents as IncomingEvents,
    TOutgoingEvents as OutgoingEvents,
};

export {
    EZEZWebSocketClient,
    EVENT_UNKNOWN_MESSAGE,
    EVENT_UNKNOWN_DATA_TYPE,
};
