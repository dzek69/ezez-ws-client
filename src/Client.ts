import { serializeToBuffer, unserializeFromBuffer } from "@ezez/utils";

import type { TEvents } from "./types";

type Options = {
    autoReconnect: boolean;
    auth: string;
    serializerArgs?: Parameters<typeof serializeToBuffer>[1];
    unserializerArgs?: Parameters<typeof unserializeFromBuffer>[1];
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

    public constructor(
        url: ConstructorParameters<typeof WebSocket>[0], protocols?: ConstructorParameters<typeof WebSocket>[1],
        options: Partial<Options> = {},
    ) {
        this._url = url;
        this._protocols = protocols;
        this._options = { ...defaultOptions, ...options };
        this._autoReconnect = this._options.autoReconnect;

        this._queue = [];
        this._serialize = serializeToBuffer.bind(null, Buffer, options.serializerArgs ?? []);
        this._unserialize = unserializeFromBuffer.bind(null, Buffer, options.unserializerArgs ?? []);

        this._connect();
    }

    // TODO handle sending queue
    private _connect() {
        this._client = new WebSocket(this._url, this._protocols);
        this._client.addEventListener("close", this._handleClose);
        this._client.addEventListener("open", this._handleAuth);
    }

    private readonly _handleClose = () => {
        this._client!.removeEventListener("close", this._handleClose);
        this._client!.removeEventListener("open", this._handleAuth);

        if (this._autoReconnect) {
            setTimeout(() => {
                this._connect();
            }, RECONNECT_TIMEOUT);
        }
    };

    private readonly _handleAuth = () => {
        this._client!.send(this._serialize("auth", this._options.auth, PROTOCOL_VERSION));
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
