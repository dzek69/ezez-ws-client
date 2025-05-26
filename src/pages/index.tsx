import React, { useEffect, useRef } from "react";

import { rethrow, waitFor } from "@ezez/utils";

import { EZEZWebSocketClient } from "../Client";

type OutgoingEvents = {
    ping1: [];
    ping2: [number];
};

type IncomingEvents = {
    pong1: [string];
    pong2: [];
};
// eslint-disable-next-line max-lines-per-function
const Index: React.FC = () => {
    const wsRef = useRef<EZEZWebSocketClient<IncomingEvents, OutgoingEvents>>();

    useEffect(() => {
        const ws = new EZEZWebSocketClient<IncomingEvents, OutgoingEvents>("ws://127.0.0.1:6565", undefined, {
            auth: "some-code",
            clearAwaitingRepliesAfterMs: 5_000,
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

        const int = setInterval(() => {
            // console.info("count", ws.awaitingRepliesCount);
            // eslint-disable-next-line @typescript-eslint/no-magic-numbers
        }, 1000);

        ws.on("pong2", () => {
            console.info("got pong2");
        });
        ws.on("pong1", (args, reply, ids) => {
            console.info("got pong1 reply", args, ids);
            reply("ping2", [1], /* (eventName, args, reply, ids) => {
                        console.info("got a pong2 reply", eventName, args, ids);
                        reply("pong2", []);
                    } */);
        });

        console.info("ws started");

        (async () => {
            await waitFor(() => ws.alive);
            // ws.send("hello", 1);
            // ws.send("hello", "s");
            // ws.send("kaczka", "s");
            // ws.send("this", 1);
            // ws.send("ping");
        })().catch(rethrow);

        wsRef.current = ws;

        return () => {
            clearInterval(int);
            ws.close();
            wsRef.current = undefined;
        };
    }, []);

    const handleButtonClick = () => {
        if (!wsRef.current) {
            console.error("WebSocket client is not initialized");
        }
        // wsRef.current.send("hello", [42]);
    };

    return (
        <h1>
            Check out the console
            {/* eslint-disable-next-line react/jsx-no-bind */}
            <button onClick={handleButtonClick}>Send message</button>
        </h1>
    );
};

export default Index;
