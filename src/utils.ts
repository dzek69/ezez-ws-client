const isMessageEvent = (obj: unknown): obj is MessageEvent => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any,@typescript-eslint/no-unsafe-member-access
    return (obj as any).constructor.name === "MessageEvent";
};

/**
 * Extracts string or Uint8Array from `onMessage` event from both native WebSocket and `ws`.
 * On native WebSocket we expect MessageEvent with either string (text data) or ArrayBuffer data (binary).
 * On `ws` we expect either Buffer (text data) or ArrayBuffer (binary).
 * @param messageOrEvent
 */
const extractMessage = async (messageOrEvent: unknown) => { // eslint-disable-line @typescript-eslint/require-await
    if (!(isMessageEvent(messageOrEvent))) {
        throw new Error("Unsupported data type");
    }

    const message = messageOrEvent.data as unknown;
    if (typeof message === "string") {
        return message;
    }
    if (message instanceof ArrayBuffer) {
        return new Uint8Array(message);
    }
    throw new Error("Unsupported MessageEvent data type");
};

export {
    extractMessage,
};
