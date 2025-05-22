import React, { useEffect } from "react";

import { rethrow, waitFor } from "@ezez/utils";

import { EZEZWebSocketClient } from "../Client";

const Index: React.FC = (props) => {
    useEffect(() => {
        const ws = new EZEZWebSocketClient<{ this: [number]; hello: [number]; kaczka: [string] }>("ws://127.0.0.1:6565", undefined, {
            auth: "some-code",
        }, {
            onAuthOk: () => {
                console.log("auth ok");
                ws.send("ping1", [], (eventName, args, reply, ids) => {
                    console.log("i got a response", eventName);
                    const replyId = reply("ping2", [1], (ee) => {
                        console.log("got a pong 2 hopefully", ee);
                    });
                    console.log("replied to", ids.eventId, "with", replyId);
                });
            },
            onMessage: (eventName, args, reply, ids) => {
                console.log("got some message", {
                    eventName,
                    args,
                    reply,
                    ids,
                });
            },
        });

        console.log("ws started");

        (async () => {
            await waitFor(() => ws.alive);
            // ws.send("hello", 1);
            // ws.send("hello", "s");
            // ws.send("kaczka", "s");
            // ws.send("this", 1);
            // ws.send("ping");
        })().catch(rethrow);

        return () => {
            ws.close();
        };
    }, []);

    return (
        <h1>
            Check out the console
        </h1>
    );
};

export default Index;
