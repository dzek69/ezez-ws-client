import { serialize } from "./data/serialize";

type Options = {
    autoReconnect: boolean;
    auth: string;
};

const defaultOptions: Options = {
    autoReconnect: true,
    auth: "",
};

const RECONNECT_TIMEOUT = 1000;

type ReservedNames = "this" | "that";
type NotA<T> = T extends ReservedNames ? never : T;

class EZEZWebSocketClient<Events extends Record<NotA<string>, unknown[]>> {
    private readonly _url: ConstructorParameters<typeof WebSocket>[0];

    private readonly _protocols: ConstructorParameters<typeof WebSocket>[1];

    private readonly _options: Options;

    private _client: WebSocket | null = null;

    private _autoReconnect: boolean;

    private _id = 0;

    public constructor(
        url: ConstructorParameters<typeof WebSocket>[0], protocols?: ConstructorParameters<typeof WebSocket>[1],
        options?: Partial<Options>,
    ) {
        this._url = url;
        this._protocols = protocols;
        this._options = { ...defaultOptions, ...options };
        this._autoReconnect = this._options.autoReconnect;

        // this._queue = [];

        this._connect();
    }

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
        this._client!.send(serialize("auth", this._options.auth));
    };

    public get alive() {
        return this._client?.readyState === WebSocket.OPEN;
    }

    public send(eventName: keyof Events, ...args: Events[keyof Events]) {
        const client = this._client!;
        if (!this.alive) {
            // TODO add to the queue
            console.warn("Client is not connected, message will be lost");
            return;
        }
        client.send(serialize([eventName, ++this._id, ...args]));
    }

    public get client() {
        return this._client;
    }

    public close() {
        this._autoReconnect = false;
        this._client!.close();
    }
}

export {
    EZEZWebSocketClient,
};
