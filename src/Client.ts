import { rethrow, serializeToBuffer, unserializeFromBuffer } from "@ezez/utils";
import EventEmitter from "eventemitter3";

import type { AwaitingReply, Callbacks, EventsToEventEmitter, Ids, Options, ReplyTupleUnion, TEvents } from "./types";

import { EVENT_AUTH_OK, EVENT_AUTH_REJECTED, EVENT_AUTH } from "./types";

const defaultOptions: Options = {
    sendWhenNotConnected: "queueAfterAuth",
    autoReconnect: true,
    auth: "",
};

const RECONNECT_TIMEOUT = 1000;
const PROTOCOL_VERSION = 1;
const NOT_FOUND = -1;

class EZEZWebSocketClient<IncomingEvents extends TEvents, OutgoingEvents extends TEvents = IncomingEvents> {
    private readonly _url: ConstructorParameters<typeof WebSocket>[0];

    private readonly _protocols: ConstructorParameters<typeof WebSocket>[1];

    private readonly _options: Options;

    private _client: WebSocket | null = null;

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
    private readonly _awaitingReplies: AwaitingReply<IncomingEvents, OutgoingEvents>[] = [];

    private readonly _queue: {
        [K in keyof OutgoingEvents]: [
            K, OutgoingEvents[K], undefined | (
                <REvent extends ReplyTupleUnion<
                    IncomingEvents, OutgoingEvents, EZEZWebSocketClient<IncomingEvents, OutgoingEvents>
                >>(
                    ...replyArgs: REvent
                ) => void
            ),
        ];
    }[keyof OutgoingEvents][] = [];

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

    public constructor(
        url: ConstructorParameters<typeof WebSocket>[0], protocols?: ConstructorParameters<typeof WebSocket>[1],
        options: Partial<Options> = {},
        callbacks?: Callbacks<IncomingEvents>,
    ) {
        this._url = url;
        this._protocols = protocols;
        this._options = { ...defaultOptions, ...options };
        this._autoReconnect = this._options.autoReconnect;
        this._callbacks = callbacks ?? {};
        this._ee = new EventEmitter();
        this.on = this._ee.on.bind(this._ee);
        this.off = this._ee.off.bind(this._ee);
        this.once = this._ee.once.bind(this._ee);

        this._serialize = serializeToBuffer.bind(null, Buffer, options.serializerArgs ?? []);
        this._unserialize = unserializeFromBuffer.bind(null, Buffer, options.unserializerArgs ?? []);

        this.send = (eventName, args, onReply) => {
            return this._send(eventName, args, null, onReply);
        };

        this._connect();
    }

    private _connect() {
        this._client = new WebSocket(this._url, this._protocols);
        this._client.addEventListener("close", this._handleClose);
        this._client.addEventListener("open", this._handleOpen);
        this._client.addEventListener("message", this._handleMessage);
    }

    private readonly _handleClose = () => {
        this._closedOnce = true;
        this._client!.removeEventListener("close", this._handleClose);
        this._client!.removeEventListener("open", this._handleOpen);
        this._client!.removeEventListener("message", this._handleMessage);

        if (this._autoReconnect) {
            setTimeout(() => {
                this._connect();
            }, RECONNECT_TIMEOUT);
        }
    };

    private readonly _handleOpen = () => {
        this._client!.send(this._serialize(EVENT_AUTH, this._options.auth, PROTOCOL_VERSION));
    };

    private readonly _handleMessage = (messageEvent: MessageEvent) => {
        // eslint-disable-next-line max-statements
        (async () => {
            const message = messageEvent.data as unknown;
            if (!(message instanceof Blob)) {
                // Whatever this is, it's officially not supported
                return;
            }
            const buffer = new Uint8Array(await message.arrayBuffer());
            const data = this._unserialize(buffer);

            const eventName = data[0] as keyof IncomingEvents;
            const [, eventId, replyTo, ...args] = data as [
                keyof IncomingEvents, number, number | null, ...IncomingEvents[typeof eventName],
            ];

            if (eventName === EVENT_AUTH_OK) {
                this._callbacks.onAuthOk?.();
                this._queue.forEach(([queuedEventName, queuedArgs, queuedReply]) => {
                    this.send(queuedEventName, queuedArgs, queuedReply);
                });
                this._queue.length = 0;
                return;
            }
            if (eventName === EVENT_AUTH_REJECTED) {
                this._ee.removeAllListeners();
                this._callbacks.onAuthRejected?.(data[1] as string);
                this._autoReconnect = false;
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
        return this._client?.readyState === WebSocket.OPEN;
    }

    private _send<TEvent extends keyof OutgoingEvents>(
        eventName: TEvent, args: OutgoingEvents[TEvent], replyId: number | null = null,
        onReply?: <REvent extends ReplyTupleUnion<
            IncomingEvents, OutgoingEvents, EZEZWebSocketClient<IncomingEvents, OutgoingEvents>
        >>(
            ...replyArgs: REvent
        ) => void,
    ): Ids | undefined {
        const client = this._client!;
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
            this._queue.push([eventName, args, onReply]);

            return;
        }

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        const _args = args ? args : [];
        client.send(this._serialize(eventName, ++this._id, replyId, ..._args));

        if (onReply) {
            this._awaitingReplies.push({
                time: Date.now(),
                eventId: this._id,
                onReply: onReply,
            });
        }

        return { eventId: this._id, replyTo: replyId };
    }

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
        this._ee.removeAllListeners();
        this._autoReconnect = false;
        this._client!.close();
    }
}

export {
    EZEZWebSocketClient,
};
