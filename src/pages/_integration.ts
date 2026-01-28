import { WebSocket as WS } from "ws";

import type { OnCallback } from "../Client";

import { EVENT_UNKNOWN_MESSAGE, EZEZWebSocketClient } from "../Client";

type OutgoingEvents = {
    ping1: [];
    ping2: [number, number];
    whatever: [object];
    // "ezez-ws:incoming:unknown-message": [data: { custom: string }];
    // "ezez-ws::unknown-message": [data: { custom: string }];
};

type IncomingEvents = {
    "pong1": [string, string];
    "pong2": [];
    // Users can now type allowed incoming-specific events:
    "ezez-ws:incoming:unknown-message": [data: { custom: string }];
};

// const DATA_ADDRESS = "https://ws-live-data.polymarket.com/";
const DATA_ADDRESS = "http://localhost:6565";

const ws = new EZEZWebSocketClient<IncomingEvents, OutgoingEvents>(DATA_ADDRESS, undefined, {
    auth: "some-code",
    clearAwaitingRepliesAfterMs: 5_000,
    unknownDataType: "throw",
    unknownMessages: "emitTryJson",
    WSConstructor: WS,
}, {
    onAuthOk: () => {
        console.info("auth ok");
        // ws.send("ping1", [], (eventName, args, reply, ids) => {
        //     console.info("i got a response", eventName);
        //     const replyId = reply("ping2", [1], (ee) => {
        //         console.info("got a pong 2 hopefully", ee);
        //     });
        //     console.info("replied to", ids.eventId, "with", replyId);
        // });
        ws.send("ping1", []);
        ws.send("ping2", [6, 9]);

        const pong1Handler: OnCallback<typeof ws, "pong1"> = (args, reply, ids) => {
            console.info(args[0].toUpperCase());
            console.info(args[1].toUpperCase());
        };

        ws.on("pong1", pong1Handler);
    },
    onConnect() {
        console.info("connected to ws server");
    },
    onDisconnect() {
        console.info("disconnected from ws server");
    },
    onMessage: (eventName, args, reply, ids) => {
        console.info("got some message", {
            eventName,
            args,
            reply,
            ids,
        });
    },
});

// const int = setInterval(() => {
//     console.info("count", ws.awaitingRepliesCount);
// }, 1000);

ws.on("pong2", () => {
    console.info("got pong2");
});
ws.on("pong1", (args, reply, ids) => {
    console.info("got pong1 reply", args, ids);
    reply("ping2", [1, 1], /* (eventName, args, reply, ids) => {
                    console.info("got a pong2 reply", eventName, args, ids);
                    reply("pong2", []);
                } */);
});

// Listen to allowed incoming-specific events with proper typing
ws.on(EVENT_UNKNOWN_MESSAGE, (args) => {
    // args is properly typed as [data: { custom: string }]
    console.info("Unknown message:", args[0].custom);
});

console.info("ws started");
