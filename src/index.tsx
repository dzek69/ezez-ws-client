import React, { useEffect } from "react";

import { rethrow, waitFor } from "@ezez/utils";

import { EZEZWebSocketClient } from "./Client";

import styles from "./index.module.scss";

const Index: React.FC = (props) => {
    useEffect(() => {
        const ws = new EZEZWebSocketClient<{ hello: [number] }>("ws://127.0.0.1:6565", undefined, {
            auth: "some-code",
        });
        console.log("ws started");

        (async () => {
            await waitFor(() => ws.alive);
            ws.send("hello", 1);
        })().catch(rethrow);

        return () => {
            ws.close();
        };
    }, []);

    return (
        <div className={styles.mydiv}>
            <div>div</div>
            <span>span</span>
        </div>
    );
};

export { Index };
