import { rethrow, serializeToBuffer, unserializeFromBuffer } from "@ezez/utils";

import type { TEvents } from "./types";

import { EVENT_AUTH_OK, EVENT_AUTH_REJECTED, EVENT_AUTH } from "./types";

type Options = {
    autoReconnect: boolean;
    auth: string;
    serializerArgs?: Parameters<typeof serializeToBuffer>[1];
    unserializerArgs?: Parameters<typeof unserializeFromBuffer>[1];
};

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
    onMessage?: <T extends keyof Events, R extends keyof Events>(
        // eslint-disable-next-line @typescript-eslint/no-shadow
        event: T, data: Events[T], eventId: number, reply: (eventName: R, ...args: Events[R]) => void
    ) => void;
};

const defaultOptions: Options = {
    autoReconnect: true,
    auth: "",
};

const RECONNECT_TIMEOUT = 1000;
const PROTOCOL_VERSION = 1;

class EZEZWebSocketClient<Events extends TEvents> {
    private readonly _url: ConstructorParameters<typeof WebSocket>[0];

    private readonly _protocols: ConstructorParameters<typeof WebSocket>[1];

    private readonly _options: Options;

    private _client: WebSocket | null = null;

    private _autoReconnect: boolean;

    private _id = 0;

    private readonly _serialize: (...args: unknown[]) => Buffer;

    private readonly _unserialize: (rawData: (Buffer | Uint8Array)) => unknown[];

    private readonly _queue: {
        [K in keyof Events]: [K, Events[K]];
    }[keyof Events][] = [];

    private readonly _callbacks: Callbacks<Events>;

    public constructor(
        url: ConstructorParameters<typeof WebSocket>[0], protocols?: ConstructorParameters<typeof WebSocket>[1],
        options: Partial<Options> = {},
        callbacks?: {
            onAuthOk?: () => void;
            onAuthRejected?: (reason: string) => void;
            onMessage?: <T extends keyof Events, R extends keyof Events>(
                // eslint-disable-next-line @typescript-eslint/no-shadow
                event: T,
                data: Events[T],
                eventId: number,
                reply: (eventName: R, ...args: Events[R]) => void,
            ) => void;
            // TODO events about connection
        },
    ) {
        this._url = url;
        this._protocols = protocols;
        this._options = { ...defaultOptions, ...options };
        this._autoReconnect = this._options.autoReconnect;
        this._callbacks = callbacks ?? {};

        this._serialize = serializeToBuffer.bind(null, Buffer, options.serializerArgs ?? []);
        this._unserialize = unserializeFromBuffer.bind(null, Buffer, options.unserializerArgs ?? []);

        this._connect();
    }

    // TODO handle sending queue
    private _connect() {
        this._client = new WebSocket(this._url, this._protocols);
        this._client.addEventListener("close", this._handleClose);
        this._client.addEventListener("open", this._handleOpen);
        this._client.addEventListener("message", this._handleMessage);
    }

    private readonly _handleClose = () => {
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
        (async () => {
            const message = messageEvent.data as unknown;
            if (!(message instanceof Blob)) {
                // Whatever this is, it's officially not supported
                return;
            }
            const buffer = new Uint8Array(await message.arrayBuffer());
            const data = this._unserialize(buffer);

            if (data[0] === EVENT_AUTH_OK) {
                this._callbacks.onAuthOk?.();
                // TODO send the queue
                return;
            }
            if (data[0] === EVENT_AUTH_REJECTED) {
                this._callbacks.onAuthRejected?.(data[1] as string);
                this._autoReconnect = false;
                return;
            }
            console.log("yay", data);
        })().catch(rethrow);
    };

    public get alive() {
        return this._client?.readyState === WebSocket.OPEN;
    }

    public send<TEvent extends keyof Events>(eventName: TEvent, ...args: Events[TEvent]) {
        const client = this._client!;
        if (!this.alive) {
            console.warn(`Client is not connected, event ${String(eventName)} will be lost`);
            return;
        }
        client.send(this._serialize(eventName, ++this._id, ...args));
    }

    // public sendQueue<TEvent extends keyof Events>(eventName: TEvent, ...args: Events[TEvent]) {
    //     const client = this._client!;
    //     if (!this.alive) {
    //         this._queue.push([eventName, args]);
    //         return;
    //     }
    //     client.send(this._serialize(eventName, ++this._id, ...args));
    // }

    /**
     * Get raw WebSocket client, please note that this is current client and if reconnect happens you need to get it
     * again, or you will just keep the reference to the old one.
     */
    public get client() {
        return this._client;
    }

    /**
     * Close the connection and stop auto reconnecting.
     */
    public close() {
        this._autoReconnect = false;
        this._client!.close();
    }
}

export {
    EZEZWebSocketClient,
};
