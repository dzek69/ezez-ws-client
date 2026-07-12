import { WebSocket as WS } from "ws";

import { EZEZWebSocketClient } from "../Client";

type OutgoingEvents = {
    ping1: [];
    ping2: [number, number];
};

type IncomingEvents = {
    pong1: [string, string];
    pong2: [];
};

const DATA_ADDRESS = "http://localhost:6565";

// auth format expected by the server's _integration.ts: "<userId>:<nickname>"
// run this script twice (different nicknames) to confirm contexts are isolated per-client
const NICKNAME = process.argv[2] ?? "alice";
const USER_ID = process.argv[3] ?? "42";

const ws = new EZEZWebSocketClient<IncomingEvents, OutgoingEvents>(DATA_ADDRESS, undefined, {
    auth: `${USER_ID}:${NICKNAME}`,
    clearAwaitingRepliesAfterMs: 5_000,
    unknownDataType: "throw",
    unknownMessages: "emitTryJson",
    WSConstructor: WS,
}, {
    onConnect: () => {
        console.info(`[${NICKNAME}] connected`);
    },
    onAuthOk: () => {
        console.info(`[${NICKNAME}] auth ok — sending pings`);

        // each ping1 should bump the server-side pingCount for THIS client only
        ws.send("ping1", []);
        ws.send("ping1", []);
        ws.send("ping2", [1, 2]); // eslint-disable-line @typescript-eslint/no-magic-numbers

        // a couple more on an interval so you can watch the snapshot logs on the server
        let n = 0;
        const MAX = 5;
        const interval = setInterval(() => {
            n++;
            ws.send("ping1", []);
            if (n >= MAX) {
                clearInterval(interval);
                ws.send("ping2", [99, 100]); // eslint-disable-line @typescript-eslint/no-magic-numbers
            }
        // eslint-disable-next-line @typescript-eslint/no-magic-numbers
        }, 1500);
    },
    onDisconnect: () => {
        console.info(`[${NICKNAME}] disconnected`);
    },
    onMessage: (eventName, args, reply, ids) => {
        console.info(`[${NICKNAME}] got`, eventName, args, "ids:", ids);
    },
});

ws.on("pong1", (args) => {
    console.info(`[${NICKNAME}] pong1:`, args);
});
ws.on("pong2", () => {
    console.info(`[${NICKNAME}] pong2`);
});

console.info(`[${NICKNAME}] client started, auth="${USER_ID}:${NICKNAME}"`);
